'use strict';

// Load .env file if present (SSO credentials, etc.)
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const session = require('express-session');
const { createProxyMiddleware } = require('http-proxy-middleware');
const axios = require('axios');
const path = require('path');

// ─── Bootstrap DB (runs migrations + seeding on first run) ───────────────────
const { Users, SsoConfig } = require('./lib/db');
const state = require('./server-state');

const app = express();
const PORT = process.env.PORT || 3000;
const N8N_BASE_URL = process.env.N8N_URL || 'http://localhost:5678';
const N8N_USER = {
  email:    process.env.N8N_ADMIN_EMAIL,
  password: process.env.N8N_ADMIN_PASSWORD,
};

if (!N8N_USER.email || !N8N_USER.password) {
  console.error('✗ N8N_ADMIN_EMAIL dan N8N_ADMIN_PASSWORD wajib diisi di .env');
  process.exit(1);
}

/** Server-side n8n session cookie — shared via ./server-state module */

async function loginToN8N() {
  try {
    const res = await axios.post(
      `${N8N_BASE_URL}/rest/login`,
      { emailOrLdapLoginId: N8N_USER.email, password: N8N_USER.password },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const setCookies = res.headers['set-cookie'] || [];
    state.setN8NCookies(setCookies.map((c) => c.split(';')[0]).join('; '));
    console.log('✓ n8n authentication successful');
    return true;
  } catch (err) {
    // Some n8n versions redirect on login — cookies may still be in the error response
    const setCookies = err.response?.headers?.['set-cookie'];
    if (setCookies) {
      state.setN8NCookies(setCookies.map((c) => c.split(';')[0]).join('; '));
      console.log('✓ n8n authentication successful (via redirect)');
      return true;
    }
    console.error('✗ n8n login failed:', err.response?.data?.message || err.message);
    console.error('  Retrying in 10 seconds...');
    setTimeout(loginToN8N, 10_000);
    return false;
  }
}

// ─── Core middleware ──────────────────────────────────────────────────────────
// Only parse body for our own API routes — do NOT apply globally so that
// the n8n proxy receives the raw request stream intact (body-parser consumes
// the stream; if it runs before the proxy, n8n gets an empty body and hangs
// on PATCH/POST requests such as workflow activation).
app.use('/api', express.json());
app.use('/api', express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'n8n-embed-local-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, maxAge: 8 * 60 * 60 * 1000 }, // 8 h
  })
);

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  if (req.path.startsWith('/api/') || req.xhr) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  res.redirect('/app/login');
}

// ─── OIDC / SSO ──────────────────────────────────────────────────────────────
let oidcClient = null;

async function initOIDC() {
  const cfg = SsoConfig.get();
  oidcClient = null; // reset on every call (re-init after settings save)

  if (!cfg.enabled || !cfg.client_id || !cfg.client_secret) {
    console.log('ℹ SSO disabled — configure it in Settings > SSO');
    return;
  }
  try {
    const { Issuer } = require('openid-client');
    let issuerUrl;
    
    // Map provider to issuer URL
    switch (cfg.provider) {
      case 'azure':
        if (!cfg.tenant_id) throw new Error('Tenant ID wajib diisi untuk Azure Entra ID');
        issuerUrl = `https://login.microsoftonline.com/${cfg.tenant_id}/v2.0`;
        break;
      case 'google':
        issuerUrl = 'https://accounts.google.com';
        break;
      case 'github':
        issuerUrl = 'https://github.com';
        break;
      case 'okta':
        if (!cfg.okta_domain) throw new Error('Okta Domain wajib diisi (e.g., dev-12345.okta.com)');
        issuerUrl = `https://${cfg.okta_domain}/oauth2/default`;
        break;
      case 'custom_oidc':
        // Gunakan untuk Keycloak, Authentik, atau OIDC lainnya
        if (!cfg.issuer_url) throw new Error('Issuer URL wajib diisi (e.g., Keycloak, Authentik, atau OIDC provider lain)');
        issuerUrl = cfg.issuer_url;
        break;
      default:
        throw new Error(`Provider tidak dikenali: ${cfg.provider}`);
    }
    
    const issuer = await Issuer.discover(issuerUrl);
    const appUrl = (cfg.app_url || `http://localhost:${PORT}`).replace(/\/$/, '');
    oidcClient = new issuer.Client({
      client_id:      cfg.client_id,
      client_secret:  cfg.client_secret,
      redirect_uris:  [`${appUrl}/auth/sso/callback`],
      response_types: ['code'],
    });
    console.log(`✓ SSO ready (${cfg.provider})`);
  } catch (err) {
    console.error('✗ SSO init failed:', err.message);
  }
}

// GET /auth/sso — redirect to identity provider
app.get('/auth/sso', (req, res) => {
  if (!oidcClient) return res.redirect('/app/login?error=sso_not_configured');
  const { generators } = require('openid-client');
  const st = generators.state();
  const nonce = generators.nonce();
  req.session.oidcState = st;
  req.session.oidcNonce = nonce;
  const url = oidcClient.authorizationUrl({ scope: 'openid email profile', state: st, nonce });
  res.redirect(url);
});

// GET /auth/sso/callback
app.get('/auth/sso/callback', async (req, res) => {
  if (!oidcClient) return res.redirect('/app/login?error=sso_not_configured');
  try {
    const cfg = SsoConfig.get();
    const appUrl = (cfg.app_url || `http://localhost:${PORT}`).replace(/\/$/, '');
    const params = oidcClient.callbackParams(req);
    const tokenSet = await oidcClient.callback(
      `${appUrl}/auth/sso/callback`,
      params,
      { state: req.session.oidcState, nonce: req.session.oidcNonce }
    );
    const claims = tokenSet.claims();
    const email = claims.email || claims.preferred_username;
    if (!email) return res.redirect('/app/login?error=no_email');
    const user = Users.getByEmail(email);
    if (!user) return res.redirect('/app/login?error=not_registered');
    req.session.authenticated = true;
    req.session.userId = user.id;
    req.session.user = user.username;
    req.session.role = user.role_name;
    res.redirect('/app/dashboard');
  } catch (err) {
    console.error('[SSO callback]', err.message);
    res.redirect('/app/login?error=sso_failed');
  }
});

// GET /api/sso-status — login page uses this to show/hide SSO button
const providerLabels = {
  azure: 'Microsoft',
  google: 'Google',
  github: 'GitHub',
  okta: 'Okta',
  custom_oidc: 'SSO',
};
app.get('/api/sso-status', (req, res) => {
  const cfg = SsoConfig.get();
  const baseEnabled = !!cfg.enabled && !!cfg.show_login_button;
  
  // Filter available providers based on their enabled status
  const availableProviders = [];
  if (baseEnabled) {
    if (cfg.azure_enabled) availableProviders.push({ provider: 'azure', label: 'Microsoft' });
    if (cfg.google_enabled) availableProviders.push({ provider: 'google', label: 'Google' });
    if (cfg.github_enabled) availableProviders.push({ provider: 'github', label: 'GitHub' });
    if (cfg.okta_enabled) availableProviders.push({ provider: 'okta', label: 'Okta' });
    if (cfg.custom_oidc_enabled) availableProviders.push({ provider: 'custom_oidc', label: 'SSO' });
  }
  
  res.json({
    enabled: baseEnabled,
    availableProviders: availableProviders,
    selectedProvider: cfg.provider,
  });
});

// ─── App routes ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.redirect(req.session?.authenticated ? '/app/dashboard' : '/app/login');
});

app.get('/app/login', (req, res) => {
  if (req.session?.authenticated) return res.redirect('/app/dashboard');
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/app/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// Admin-only pages — redirect non-admin to dashboard
function adminPage(req, res, next) {
  if (!req.session?.authenticated) return res.redirect('/app/login');
  if (req.session.role !== 'admin') return res.redirect('/app/dashboard');
  next();
}
app.get('/app/workspaces', adminPage, (req, res) => res.sendFile(path.join(__dirname, 'views', 'workspaces.html')));
app.get('/app/projects',   adminPage, (req, res) => res.sendFile(path.join(__dirname, 'views', 'projects.html')));
app.get('/app/users',      adminPage, (req, res) => res.sendFile(path.join(__dirname, 'views', 'users.html')));
app.get('/app/settings',   adminPage, (req, res) => res.sendFile(path.join(__dirname, 'views', 'settings.html')));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });
  }
  const user = Users.verifyPassword(username, password);
  if (user) {
    req.session.authenticated = true;
    req.session.userId = user.id;
    req.session.user = user.username;
    req.session.role = user.role_name;
    return res.json({ success: true, redirect: '/app/dashboard', role: user.role_name });
  }
  res.status(401).json({ success: false, message: 'Username atau password salah.' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ─── Session info ─────────────────────────────────────────────────────────────
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ id: req.session.userId, username: req.session.user, role: req.session.role });
});

// ─── Feature routes ───────────────────────────────────────────────────────────
app.use(requireAuth, require('./routes/users'));
app.use(requireAuth, require('./routes/projects'));
app.use(requireAuth, require('./routes/workspaces'));

// ─── Settings: SSO ───────────────────────────────────────────────────────────
function adminOnly(req, res, next) {
  if (req.session?.role === 'admin') return next();
  res.status(403).json({ message: 'Forbidden' });
}

app.get('/api/settings/sso', requireAuth, adminOnly, (req, res) => {
  const cfg = SsoConfig.get();
  // Never expose client_secret in GET response
  res.json({
    enabled:           !!cfg.enabled,
    show_login_button: !!cfg.show_login_button,
    provider:          cfg.provider,
    client_id:         cfg.client_id,
    tenant_id:         cfg.tenant_id,
    issuer_url:        cfg.issuer_url,
    app_url:           cfg.app_url,
    has_secret:        !!cfg.client_secret,
    azure_enabled:     !!cfg.azure_enabled,
    google_enabled:    !!cfg.google_enabled,
    github_enabled:    !!cfg.github_enabled,
    okta_enabled:      !!cfg.okta_enabled,
    custom_oidc_enabled: !!cfg.custom_oidc_enabled,
  });
});

app.put('/api/settings/sso', requireAuth, adminOnly, async (req, res) => {
  const { enabled, show_login_button, provider, client_id, client_secret, tenant_id, issuer_url, app_url, azure_enabled, google_enabled, github_enabled, okta_enabled, custom_oidc_enabled } = req.body;
  // If client_secret left blank, keep existing secret
  const existing = SsoConfig.get();
  SsoConfig.save({
    enabled:           !!enabled,
    show_login_button: !!show_login_button,
    provider:          provider || 'custom_oidc',
    client_id:         client_id     || '',
    client_secret:     client_secret || existing.client_secret,
    tenant_id:         tenant_id     || '',
    issuer_url:        issuer_url    || '',
    app_url:           app_url       || '',
    azure_enabled:     azure_enabled !== undefined ? !!azure_enabled : !!existing.azure_enabled,
    google_enabled:    google_enabled !== undefined ? !!google_enabled : !!existing.google_enabled,
    github_enabled:    github_enabled !== undefined ? !!github_enabled : !!existing.github_enabled,
    okta_enabled:      okta_enabled !== undefined ? !!okta_enabled : !!existing.okta_enabled,
    custom_oidc_enabled: custom_oidc_enabled !== undefined ? !!custom_oidc_enabled : !!existing.custom_oidc_enabled,
  });
  // Re-initialize OIDC with new settings
  await initOIDC();
  res.json({ message: 'SSO settings disimpan', active: !!oidcClient });
});

// ─── Block PostHog / telemetry requests (avoids 504 timeouts in the iframe) ──
app.all('/rest/ph/*', (req, res) => res.status(204).end());
app.all('/rest/ph', (req, res) => res.status(204).end());

// ─── SSE proxy for n8n push notifications (Connection lost fix) ──────────────
// n8n uses Server-Sent Events at /rest/push — must not be buffered
app.use('/rest/push', requireAuth, createProxyMiddleware({
  target: N8N_BASE_URL,
  changeOrigin: true,
  selfHandleResponse: false,
  on: {
    proxyReq(proxyReq, req) {
      const cookies = req.session?.n8nCookie || state.getN8NCookies();
      if (cookies) proxyReq.setHeader('Cookie', cookies);
      // Required for SSE: tell proxy not to buffer
      proxyReq.setHeader('Accept', 'text/event-stream');
    },
    proxyRes(proxyRes, req, res) {
      // Pass through SSE headers without modification
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
    },
    error(err, req, res) {
      console.error('[push proxy]', err.message);
    },
  },
}));

// ─── N8N Proxy (everything else) ─────────────────────────────────────────────
const n8nProxy = createProxyMiddleware({
  target: N8N_BASE_URL,
  changeOrigin: true,
  ws: true, // proxy WebSocket connections (n8n uses these for real-time features)
  on: {
    proxyReq(proxyReq, req) {
      // Use per-session project user cookie if set, else fall back to admin cookie
      const cookies = req.session?.n8nCookie || state.getN8NCookies();
      if (cookies) {
        proxyReq.setHeader('Cookie', cookies);
      }
    },

    async proxyRes(proxyRes) {
      // If n8n rejects auth, refresh our session and warn
      if (proxyRes.statusCode === 401) {
        console.warn('n8n returned 401 — re-authenticating...');
        state.setN8NCookies('');
        loginToN8N();
      }

      // ── Strip headers that block iframe embedding ──
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['X-Frame-Options'];
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['Content-Security-Policy'];
      delete proxyRes.headers['content-security-policy-report-only'];

      // ── Rewrite absolute redirects so they stay on our server ──
      if (proxyRes.headers.location) {
        const n8nHost = N8N_BASE_URL.replace(/^https?:\/\//, '');
        proxyRes.headers.location = proxyRes.headers.location.replace(
          new RegExp(`https?://${n8nHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
          `http://localhost:${PORT}`
        );
      }
    },

    error(err, req, res) {
      console.error('[proxy]', err.message);
      // When called from a WebSocket upgrade, res is a net.Socket — not an HTTP response
      if (typeof res?.status !== 'function') return;
      if (!res.headersSent) {
        res.status(502).send(`
          <html>
            <body style="font-family:system-ui;padding:40px;background:#111;color:#f87171">
              <h2>n8n tidak dapat dijangkau</h2>
              <p>Pastikan n8n berjalan di <code>${N8N_BASE_URL}</code> lalu refresh halaman ini.</p>
            </body>
          </html>
        `);
      }
    },
  },
});

// All unmatched routes → require app login → proxy to n8n
app.use('/', requireAuth, n8nProxy);

// ─── Start server ─────────────────────────────────────────────────────────────
const server = app.listen(PORT, async () => {
  console.log(`\n🚀  App berjalan di http://localhost:${PORT}`);
  console.log(`    ► Login    : http://localhost:${PORT}/app/login`);
  console.log(`    ► Users    : http://localhost:${PORT}/app/users`);
  console.log(`    ► Projects   : http://localhost:${PORT}/app/projects`);
  console.log(`    ► Workspaces : http://localhost:${PORT}/app/workspaces\n`);

  await loginToN8N();
  await initOIDC();
});

// Forward WebSocket upgrades to n8n
server.on('upgrade', (req, socket, head) => {
  const wsCookies = state.getN8NCookies();
  if (wsCookies) {
    req.headers.cookie = wsCookies;
  }
  n8nProxy.upgrade(req, socket, head);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} sudah digunakan. Ubah PORT di server.js`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
