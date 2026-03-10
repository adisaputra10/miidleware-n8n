'use strict';

const { Router } = require('express');
const axios = require('axios');
const { Projects, Users, Workspaces } = require('../lib/db');
const path = require('path');

const router = Router();
const N8N_BASE = process.env.N8N_URL || 'http://localhost:5678';

function adminOnly(req, res, next) {
  if (req.session?.role === 'admin') return next();
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(403).json({ message: 'Forbidden — admin only' });
  }
  res.redirect('/app/dashboard');
}

// ── n8n helpers ───────────────────────────────────────────────────────────────


/** POST /rest/workflows — create a blank workflow, optionally inside an n8n project */
async function createN8NWorkflow(name, n8nProjectId, cookies) {
  const body = { name, nodes: [], connections: {}, settings: { executionOrder: 'v1' } };
  if (n8nProjectId) body.projectId = n8nProjectId;
  try {
    const res = await axios.post(
      `${N8N_BASE}/rest/workflows`,
      body,
      { headers: { Cookie: cookies, 'Content-Type': 'application/json' } }
    );
    const wf = res.data?.data ?? res.data;
    return wf?.id ?? null;
  } catch (err) {
    // If 401 and we used admin cookie, refresh admin session and retry once
    if (err.response?.status === 401) {
      console.warn('[createN8NWorkflow] 401 — refreshing admin session and retrying...');
      const { setN8NCookies } = require('../server-state');
      try {
        const loginRes = await axios.post(
          `${N8N_BASE}/rest/login`,
          { emailOrLdapLoginId: process.env.N8N_ADMIN_EMAIL, password: process.env.N8N_ADMIN_PASSWORD },
          { headers: { 'Content-Type': 'application/json' } }
        );
        const freshCookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        setN8NCookies(freshCookies);
        const retry = await axios.post(
          `${N8N_BASE}/rest/workflows`,
          body,
          { headers: { Cookie: freshCookies, 'Content-Type': 'application/json' } }
        );
        const wf = retry.data?.data ?? retry.data;
        return wf?.id ?? null;
      } catch (retryErr) {
        throw retryErr;
      }
    }
    throw err;
  }
}

/** POST /api/v1/users then auto-accept invitation so user is Active (not Pending) */
async function inviteN8NUser(email, fullName, password) {
  try {
    const { getN8NApiKey } = require('../server-state');
    const apiKey = getN8NApiKey();

    // Step 1: Create/invite the user
    const inviteRes = await axios.post(
      `${N8N_BASE}/api/v1/users`,
      [{ email, role: 'global:member' }],
      { headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' } }
    );
    const inviteList = inviteRes.data ?? [];
    const first = Array.isArray(inviteList) ? inviteList[0] : inviteList;
    const inviteeId = first?.user?.id;
    const inviteAcceptUrl = first?.user?.inviteAcceptUrl ?? '';

    if (!inviteeId) return null;

    // Step 2: Auto-accept the invitation to make user Active
    // Extract inviterId from inviteAcceptUrl query string
    const urlParams = new URLSearchParams(inviteAcceptUrl.split('?')[1] ?? '');
    const inviterId = urlParams.get('inviterId');

    const nameParts = (fullName || email.split('@')[0]).trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || nameParts[0];

    // Step 2: Auto-accept the invitation — response sets a session cookie (user is now Active + logged in)
    const acceptRes = await axios.post(
      `${N8N_BASE}/rest/invitations/${inviteeId}/accept`,
      { inviterId, inviteeId, firstName, lastName, password },
      { headers: { 'Content-Type': 'application/json' } }
    );

    // Extract session cookie from accept response — user is already authenticated
    const acceptCookies = acceptRes.headers['set-cookie'] || [];
    const sessionCookie = acceptCookies.map(c => c.split(';')[0]).join('; ') || null;

    return { id: inviteeId, email, sessionCookie };
  } catch (err) {
    console.warn('[n8n] inviteN8NUser failed:', err.response?.data?.message ?? err.message);
    return null;
  }
}

// ─── API: list projects ───────────────────────────────────────────────────────
router.get('/api/projects', (req, res) => {
  if (req.session?.role !== 'admin') {
    return res.json(Users.getProjects(req.session.userId));
  }
  res.json(Projects.getAll());
});

// ─── API: get single project ──────────────────────────────────────────────────
router.get('/api/projects/:id', (req, res) => {
  const project = Projects.getById(Number(req.params.id));
  if (!project) return res.status(404).json({ message: 'Project not found' });
  res.json(project);
});

// ─── API: login to n8n as the project's user, store cookie in browser session ─
router.post('/api/projects/:id/n8n-token', async (req, res) => {
  const project = Projects.getById(Number(req.params.id));
  if (!project) return res.status(404).json({ message: 'Project not found' });
  if (!project.n8n_login_email || !project.n8n_login_password) {
    return res.json({ success: false, message: 'No n8n credentials stored for this project' });
  }
  try {
    const loginRes = await axios.post(
      `${N8N_BASE}/rest/login`,
      { emailOrLdapLoginId: project.n8n_login_email, password: project.n8n_login_password },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const setCookies = loginRes.headers['set-cookie'] || [];
    const cookie = setCookies.map(c => c.split(';')[0]).join('; ');

    // 1. Dismiss the onboarding survey so it never blocks the workflow editor
    const surveyBody = {
      version: 'v4',
      personalization_survey_submitted_at: new Date().toISOString(),
      personalization_survey_n8n_version: '1.0.0',
      companySize: '<20',
      companyType: 'saas',
      role: 'developer',
      reportedSource: 'other',
    };
    try {
      await axios.post(`${N8N_BASE}/rest/me/survey`, surveyBody,
        { headers: { Cookie: cookie, 'Content-Type': 'application/json' } });
    } catch { /* non-fatal */ }

    // 2. Share the project's workflow with this user using admin credentials
    //    (needed when the workflow was created by admin account)
    if (project.workflow_url) {
      const workflowId = project.workflow_url.replace('/workflow/', '').split('/')[0];
      const projectUserId = loginRes.data?.data?.id;
      if (workflowId && projectUserId) {
        try {
          const { getN8NCookies } = require('../server-state');
          await axios.put(
            `${N8N_BASE}/rest/workflows/${workflowId}/share`,
            { shareWithIds: [projectUserId] },
            { headers: { Cookie: getN8NCookies(), 'Content-Type': 'application/json' } }
          );
        } catch { /* non-fatal — community plan or already owned */ }
      }
    }

    req.session.n8nCookie = cookie;
    return res.json({ success: true });
  } catch (err) {
    // Try extracting cookies from error response (some n8n versions redirect)
    const setCookies = err.response?.headers?.['set-cookie'];
    if (setCookies?.length) {
      req.session.n8nCookie = setCookies.map(c => c.split(';')[0]).join('; ');
      return res.json({ success: true });
    }
    return res.json({ success: false, message: err.response?.data?.message ?? err.message });
  }
});

// ─── API: create project — also creates n8n project + assigns all n8n users + workflow + workspace ─
router.post('/api/projects', adminOnly, async (req, res) => {
  const { name, description, user: userPayload } = req.body;
  if (!name) return res.status(400).json({ message: 'name wajib diisi' });

  // No extra validation needed — username & password are auto-generated server-side

  // 1. Save to local DB first (workflow_url filled later after n8n workflow is created)
  const localId = Projects.create({ name, description, workflow_url: '' });

  // Auto-assign ALL existing users to this project
  Projects.assignAllUsers(localId);

  const { getN8NCookies } = require('../server-state');
  const cookies = getN8NCookies();

  let workspaceId = null;
  let n8nInvited = false;
  let newUserCredentials = null;

  // 1b. If email provided — create n8n-only user (NOT a local app user)
  let projectUserCookie = null; // cookie for the project user — used to create workflow in their space
  if (userPayload?.email) {
    try {
      // Auto-generate strong password: 1 uppercase + 7 lowercase + 2 digits + !
      // Use only letters for rand so toUpperCase() always produces an uppercase letter
      const letters = 'abcdefghijklmnopqrstuvwxyz';
      const rand = Array.from({ length: 8 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
      const autoPassword = `${rand[0].toUpperCase()}${rand.slice(1)}${Math.floor(10 + Math.random() * 90)}!`;

      // Invite to n8n and auto-accept — returns session cookie from accept response
      const n8nUser = await inviteN8NUser(userPayload.email, userPayload.full_name || userPayload.email.split('@')[0], autoPassword);
      n8nInvited = !!n8nUser;
      if (n8nInvited) {
        // Store credentials to return to frontend (only once, plaintext)
        newUserCredentials = { email: userPayload.email, password: autoPassword };
        // Persist n8n login credentials in project for future workflow sessions
        Projects.setN8NCredentials(localId, userPayload.email, autoPassword);

        // Register n8n user locally (inactive — cannot login to custom app) and assign to this project
        const slugUser = userPayload.email.split('@')[0].replace(/[^a-z0-9-]/gi, '-');
        const localUserId = Projects.createN8NUser({
          username: slugUser,
          full_name: userPayload.full_name || slugUser,
          email: userPayload.email,
        });
        if (localUserId) Projects.assignUserToProject(localUserId, localId);

        // Use the session cookie from accept response (user is already active + logged in)
        projectUserCookie = n8nUser.sessionCookie || null;

        // If no cookie from accept, do an explicit login
        if (!projectUserCookie) {
          await new Promise(r => setTimeout(r, 800));
          try {
            const loginRes = await axios.post(
              `${N8N_BASE}/rest/login`,
              { emailOrLdapLoginId: userPayload.email, password: autoPassword },
              { headers: { 'Content-Type': 'application/json' } }
            );
            const sc = loginRes.headers['set-cookie'] || [];
            projectUserCookie = sc.map(c => c.split(';')[0]).join('; ') || null;
          } catch (loginErr) {
            const sc = loginErr.response?.headers?.['set-cookie'];
            if (sc?.length) projectUserCookie = sc.map(c => c.split(';')[0]).join('; ');
            else console.warn('[create-project] login as project user failed:', loginErr.message);
          }
        }

        // Dismiss onboarding survey so user goes directly to workflow editor
        if (projectUserCookie) {
          try {
            await axios.post(
              `${N8N_BASE}/rest/me/survey`,
              {
                version: 'v4',
                personalization_survey_submitted_at: new Date().toISOString(),
                personalization_survey_n8n_version: '1.0.0',
                companySize: '<20',
                companyType: 'saas',
                role: 'developer',
                reportedSource: 'other',
              },
              { headers: { Cookie: projectUserCookie, 'Content-Type': 'application/json' } }
            );
            console.log('[create-project] survey dismissed for:', userPayload.email);
          } catch (surveyErr) {
            console.warn('[create-project] survey dismiss failed:', surveyErr.response?.data?.message ?? surveyErr.message);
          }
        }
      }
    } catch (err) {
      console.warn('[create-project] n8n user creation error:', err.message);
    }
  }


  // 3. Create workflow — use project user's cookie if available so they own it
  const workflowCookie = projectUserCookie || cookies;
  console.log(`[create-project] creating workflow using ${projectUserCookie ? 'project user' : 'admin'} session`);
  try {
    const n8nWorkflowId = await createN8NWorkflow(name, null, workflowCookie);
    console.log(`[create-project] workflow created: ${n8nWorkflowId}`);

    if (n8nWorkflowId) {
      const workflowUrl = `/workflow/${n8nWorkflowId}`;
      Projects.update(localId, { name, description: description || '', workflow_url: workflowUrl, is_active: 1 });
      workspaceId = Workspaces.create({
        name,
        workflow_id: n8nWorkflowId,
        description: `Workspace untuk project "${name}"`,
      });
    }
  } catch (err) {
    console.error('[create-project] n8n workflow creation error:', err.response?.status, JSON.stringify(err.response?.data) ?? err.message);
  }

  const userMsg = newUserCredentials
    ? n8nInvited ? `, user n8n "${newUserCredentials.email}" berhasil dibuat & aktif` : `, user n8n "${userPayload?.email}" gagal dibuat`
    : '';

  res.status(201).json({
    id: localId,
    workspace_id: workspaceId,
    new_user_credentials: newUserCredentials,
    message: `Project berhasil dibuat${workspaceId ? ' dengan 1 workflow' : ''}${userMsg}`,
  });
});

// ─── API: update project ──────────────────────────────────────────────────────
router.put('/api/projects/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const { name, description, workflow_url, is_active } = req.body;
  if (!name) return res.status(400).json({ message: 'name wajib diisi' });
  Projects.update(id, {
    name,
    description: description || '',
    workflow_url: workflow_url || '',
    is_active: is_active === false || is_active === 0 ? 0 : 1,
  });
  res.json({ message: 'Project berhasil diperbarui' });
});

// ─── API: delete project ──────────────────────────────────────────────────────
router.delete('/api/projects/:id', adminOnly, async (req, res) => {
  const project = Projects.getById(Number(req.params.id));
  if (project?.n8n_project_id) {
    try {
      const { getN8NCookies } = require('../server-state');
      await axios.delete(`${N8N_BASE}/rest/projects/${project.n8n_project_id}`, {
        headers: { Cookie: getN8NCookies() },
      });
    } catch (err) {
      console.warn('[delete-project] n8n delete failed:', err.response?.data?.message ?? err.message);
    }
  }
  Projects.delete(Number(req.params.id));
  res.json({ message: 'Project berhasil dihapus' });
});

// ─── API: get members of project ──────────────────────────────────────────────
router.get('/api/projects/:id/members', adminOnly, (req, res) => {
  res.json(Projects.getMembers(Number(req.params.id)));
});

// ─── API: set members of project ─────────────────────────────────────────────
router.put('/api/projects/:id/members', adminOnly, (req, res) => {
  const userIds = (req.body.user_ids || []).map(Number);
  Projects.setMembers(Number(req.params.id), userIds);
  res.json({ message: 'Member assignment berhasil disimpan' });
});

// ─── Pages ────────────────────────────────────────────────────────────────────
router.get('/app/projects', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'projects.html'));
});

module.exports = router;
module.exports.inviteN8NUser = inviteN8NUser;
