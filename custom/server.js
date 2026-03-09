'use strict';

const express = require('express');
const session = require('express-session');
const { createProxyMiddleware } = require('http-proxy-middleware');
const axios = require('axios');
const path = require('path');

// ─── Bootstrap DB (runs migrations + seeding on first run) ───────────────────
const { Users } = require('./lib/db');
const state = require('./server-state');

const app = express();
const PORT = 3001;
const N8N_BASE_URL = 'http://localhost:5678';
const N8N_USER = { email: 'adisaputra.id@gmail.com', password: '4disaputrA!@#' };

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: 'n8n-embed-local-dev-secret',
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

// ─── N8N Proxy (everything else) ─────────────────────────────────────────────
const n8nProxy = createProxyMiddleware({
  target: N8N_BASE_URL,
  changeOrigin: true,
  ws: true, // proxy WebSocket connections (n8n uses these for real-time features)
  on: {
    proxyReq(proxyReq) {
      // Replace browser cookies with server-side n8n auth cookie
      const cookies = state.getN8NCookies();
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
        proxyRes.headers.location = proxyRes.headers.location.replace(
          /https?:\/\/localhost:5678/g,
          `http://localhost:${PORT}`
        );
      }
    },

    error(err, req, res) {
      console.error('[proxy]', err.message);
      if (!res.headersSent) {
        res.status(502).send(`
          <html>
            <body style="font-family:system-ui;padding:40px;background:#111;color:#f87171">
              <h2>n8n tidak dapat dijangkau</h2>
              <p>Pastikan n8n berjalan di <code>localhost:5678</code> lalu refresh halaman ini.</p>
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
