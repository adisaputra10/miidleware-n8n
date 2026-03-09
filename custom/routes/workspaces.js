'use strict';

const { Router } = require('express');
const axios = require('axios');
const path = require('path');
const { Workspaces } = require('../lib/db');

const router = Router();
const N8N_BASE = 'http://localhost:5678';

function adminOnly(req, res, next) {
  if (req.session?.role === 'admin') return next();
  return res.status(403).json({ message: 'Forbidden — admin only' });
}

// ─── Fetch workflow name from n8n REST API (server-side) ──────────────────────
async function fetchN8NWorkflowInfo(workflowId, cookies) {
  try {
    const res = await axios.get(`${N8N_BASE}/rest/workflows/${workflowId}`, {
      headers: { Cookie: cookies || '' },
    });
    return { name: res.data?.data?.name || res.data?.name || null, active: res.data?.data?.active ?? res.data?.active ?? false };
  } catch {
    return { name: null, active: false };
  }
}

// ─── GET /api/workspaces — list all ──────────────────────────────────────────
router.get('/api/workspaces', (req, res) => {
  res.json(Workspaces.getAll());
});

// ─── GET /api/workspaces/:id — single entry ───────────────────────────────────
router.get('/api/workspaces/:id', (req, res) => {
  const ws = Workspaces.getById(Number(req.params.id));
  if (!ws) return res.status(404).json({ message: 'Workspace not found' });
  res.json(ws);
});

// ─── GET /api/workspaces/:id/n8n-info — live name + status from n8n ──────────
router.get('/api/workspaces/:id/n8n-info', async (req, res) => {
  const ws = Workspaces.getById(Number(req.params.id));
  if (!ws) return res.status(404).json({ message: 'Workspace not found' });
  // n8nAuthCookies are managed in server.js; pass via a module-level getter
  const { getN8NCookies } = require('../server-state');
  const info = await fetchN8NWorkflowInfo(ws.workflow_id, getN8NCookies());
  res.json({ ...ws, n8n_name: info.name, n8n_active: info.active });
});

// ─── POST /api/workspaces — create ────────────────────────────────────────────
router.post('/api/workspaces', adminOnly, (req, res) => {
  const { name, workflow_id, description } = req.body;
  if (!workflow_id) return res.status(400).json({ message: 'workflow_id wajib diisi' });

  // Extract workflow ID if full URL was pasted
  const extractedId = extractWorkflowId(workflow_id);
  if (!extractedId) return res.status(400).json({ message: 'Format workflow_id tidak valid' });

  if (Workspaces.getByWorkflowId(extractedId)) {
    return res.status(409).json({ message: 'Workflow ID sudah terdaftar' });
  }

  try {
    const id = Workspaces.create({ name, workflow_id: extractedId, description });
    res.status(201).json({ id, message: 'Workspace berhasil ditambahkan' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ message: 'Workflow ID sudah terdaftar' });
    }
    throw err;
  }
});

// ─── PUT /api/workspaces/:id — update ─────────────────────────────────────────
router.put('/api/workspaces/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const { name, workflow_id, description, is_active } = req.body;
  if (!workflow_id) return res.status(400).json({ message: 'workflow_id wajib diisi' });

  const extractedId = extractWorkflowId(workflow_id);
  if (!extractedId) return res.status(400).json({ message: 'Format workflow_id tidak valid' });

  // Conflict check (exclude self)
  const existing = Workspaces.getByWorkflowId(extractedId);
  if (existing && existing.id !== id) {
    return res.status(409).json({ message: 'Workflow ID sudah digunakan oleh workspace lain' });
  }

  Workspaces.update(id, {
    name: name || extractedId,
    workflow_id: extractedId,
    description: description || '',
    is_active: is_active === false || is_active === 0 ? 0 : 1,
  });
  res.json({ message: 'Workspace berhasil diperbarui' });
});

// ─── DELETE /api/workspaces/:id ───────────────────────────────────────────────
router.delete('/api/workspaces/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!Workspaces.getById(id)) return res.status(404).json({ message: 'Workspace not found' });
  Workspaces.delete(id);
  res.json({ message: 'Workspace berhasil dihapus' });
});

// ─── Page ─────────────────────────────────────────────────────────────────────
router.get('/app/workspaces', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'workspaces.html'));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractWorkflowId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  // Full URL: http://localhost:5678/workflow/ABC123
  const urlMatch = trimmed.match(/\/workflow\/([A-Za-z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  // Plain ID: just alphanumeric
  if (/^[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
  return null;
}

module.exports = router;
