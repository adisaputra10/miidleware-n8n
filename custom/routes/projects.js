'use strict';

const { Router } = require('express');
const axios = require('axios');
const { Projects, Users, Workspaces } = require('../lib/db');
const path = require('path');

const router = Router();
exports.router = router; // shared so users.js can import helpers
const N8N_BASE = 'http://localhost:5678';
exports.N8N_BASE = N8N_BASE;

function adminOnly(req, res, next) {
  if (req.session?.role === 'admin') return next();
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(403).json({ message: 'Forbidden — admin only' });
  }
  res.redirect('/app/dashboard');
}

// ── n8n helpers ───────────────────────────────────────────────────────────────

/** GET /rest/users from n8n — returns array of {id, email, ...} */
async function fetchN8NUsers(cookies) {
  try {
    const res = await axios.get(`${N8N_BASE}/rest/users`, {
      headers: { Cookie: cookies },
    });
    return res.data?.data ?? res.data ?? [];
  } catch {
    return [];
  }
}

/** POST /rest/projects — create a new team project in n8n */
async function createN8NProject(name, cookies) {
  const res = await axios.post(
    `${N8N_BASE}/rest/projects`,
    { name },
    { headers: { Cookie: cookies, 'Content-Type': 'application/json' } }
  );
  return res.data?.data ?? res.data; // returns project object with .id
}

/** POST /rest/workflows — create a blank workflow, optionally inside an n8n project */
async function createN8NWorkflow(name, n8nProjectId, cookies) {
  const body = { name, nodes: [], connections: {}, settings: { executionOrder: 'v1' } };
  if (n8nProjectId) body.projectId = n8nProjectId;
  const res = await axios.post(
    `${N8N_BASE}/rest/workflows`,
    body,
    { headers: { Cookie: cookies, 'Content-Type': 'application/json' } }
  );
  const wf = res.data?.data ?? res.data;
  return wf?.id ?? null; // returns the new workflow ID
}

/** POST /rest/users — invite a user to n8n by email */
async function inviteN8NUser(email, firstName, cookies) {
  try {
    const res = await axios.post(
      `${N8N_BASE}/rest/users`,
      [{ email, role: 'global:member', firstName: firstName || email.split('@')[0] }],
      { headers: { Cookie: cookies, 'Content-Type': 'application/json' } }
    );
    const users = res.data?.data ?? res.data ?? [];
    return Array.isArray(users) ? users[0] : users;
  } catch (err) {
    console.warn('[n8n] inviteN8NUser failed:', err.response?.data?.message ?? err.message);
    return null;
  }
}
exports.inviteN8NUser = inviteN8NUser;

/** POST /rest/projects/:id/users — assign users to n8n project */
async function addUsersToN8NProject(n8nProjectId, relations, cookies) {
  try {
    await axios.post(
      `${N8N_BASE}/rest/projects/${n8nProjectId}/users`,
      { relations },
      { headers: { Cookie: cookies, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.warn('[n8n] addUsersToProject failed:', err.response?.data?.message ?? err.message);
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

// ─── API: create project — also creates n8n project + assigns all n8n users + workflow + workspace ─
router.post('/api/projects', adminOnly, async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ message: 'name wajib diisi' });

  // 1. Save to local DB first (workflow_url filled later after n8n workflow is created)
  const localId = Projects.create({ name, description, workflow_url: '' });

  const { getN8NCookies } = require('../server-state');
  const cookies = getN8NCookies();

  let n8nProjectId = null;
  let workspaceId = null;

  // 2. Try to create team project in n8n (optional — requires paid plan)
  try {
    const n8nProject = await createN8NProject(name, cookies);
    n8nProjectId = n8nProject?.id ?? null;
    if (n8nProjectId) {
      Projects.setN8NProjectId(localId, n8nProjectId);
      // Add all n8n users as project members
      const n8nUsers = await fetchN8NUsers(cookies);
      if (n8nUsers.length > 0) {
        const relations = n8nUsers.map(u => ({ userId: u.id, role: 'project:editor' }));
        await addUsersToN8NProject(n8nProjectId, relations, cookies);
      }
    }
  } catch (err) {
    console.warn('[create-project] n8n team project skipped (license?):', err.response?.data?.message ?? err.message);
    // Non-fatal — continue to create workflow without a team project
  }

  // 3. Always create a blank workflow in n8n (goes to personal project if no team project)
  try {
    const n8nWorkflowId = await createN8NWorkflow(name, n8nProjectId, cookies);

    if (n8nWorkflowId) {
      const workflowUrl = `/workflow/${n8nWorkflowId}`;
      Projects.update(localId, { name, description: description || '', workflow_url: workflowUrl, is_active: 1 });
      workspaceId = Workspaces.create({
        name,
        workflow_id: n8nWorkflowId,
        description: `Workspace untuk project "${name}"`,
      });
    } else if (n8nProjectId) {
      // Fallback: link to project page
      const workflowUrl = `/home/projects/${n8nProjectId}/workflow`;
      Projects.update(localId, { name, description: description || '', workflow_url: workflowUrl, is_active: 1 });
    }
  } catch (err) {
    console.error('[create-project] n8n workflow creation error:', err.response?.data ?? err.message);
  }

  res.status(201).json({
    id: localId,
    n8n_project_id: n8nProjectId,
    workspace_id: workspaceId,
    message: n8nProjectId
      ? `Project berhasil dibuat dan disinkronkan ke n8n${workspaceId ? ' dengan 1 workspace' : ''}`
      : 'Project berhasil dibuat (n8n sync gagal, cek log)',
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

// ─── Pages ────────────────────────────────────────────────────────────────────
router.get('/app/projects', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'projects.html'));
});

module.exports = router;
