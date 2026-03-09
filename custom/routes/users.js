'use strict';

const { Router } = require('express');
const { Users, Roles } = require('../lib/db');
const { inviteN8NUser } = require('./projects');
const { getN8NCookies } = require('../server-state');

const router = Router();

// ─── Auth check: only admin can manage users ──────────────────────────────────
function adminOnly(req, res, next) {
  if (req.session?.role === 'admin') return next();
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(403).json({ message: 'Forbidden — admin only' });
  }
  res.redirect('/app/dashboard');
}

// ─── API: list users ──────────────────────────────────────────────────────────
router.get('/api/users', adminOnly, (req, res) => {
  res.json(Users.getAll());
});

// ─── API: get single user ─────────────────────────────────────────────────────
router.get('/api/users/:id', adminOnly, (req, res) => {
  const user = Users.getById(Number(req.params.id));
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json(user);
});

// ─── API: create user ─────────────────────────────────────────────────────────
router.post('/api/users', adminOnly, async (req, res) => {
  const { username, password, full_name, email, role_id } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'username dan password wajib diisi' });
  }
  let id;
  try {
    id = Users.create({ username, password, full_name, email, role_id: Number(role_id) || 2 });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ message: 'Username sudah digunakan' });
    }
    throw err;
  }

  // Invite user to n8n if email is provided
  let n8nInvited = false;
  if (email) {
    const n8nUser = await inviteN8NUser(email, full_name || username, password);
    n8nInvited = !!n8nUser;
  }

  // Auto-assign new user to all existing active projects
  Users.assignToAllProjects(id);

  res.status(201).json({
    id,
    message: n8nInvited
      ? 'User berhasil dibuat dan diundang ke n8n'
      : email
        ? 'User berhasil dibuat (undangan n8n gagal, cek log)'
        : 'User berhasil dibuat',
  });
});

// ─── API: update user ─────────────────────────────────────────────────────────
router.put('/api/users/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  // Prevent removing the last admin
  if (req.body.role_id && Number(req.body.role_id) !== 1) {
    const admins = Users.getAll().filter((u) => u.role_name === 'admin');
    const target = Users.getById(id);
    if (target?.role_name === 'admin' && admins.length <= 1) {
      return res.status(400).json({ message: 'Tidak dapat mengubah role admin terakhir' });
    }
  }
  Users.update(id, {
    full_name: req.body.full_name || '',
    email: req.body.email || '',
    role_id: Number(req.body.role_id) || 2,
    is_active: req.body.is_active === false || req.body.is_active === 0 ? 0 : 1,
    password: req.body.password || null,
  });
  res.json({ message: 'User berhasil diperbarui' });
});

// ─── API: delete user ─────────────────────────────────────────────────────────
router.delete('/api/users/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (String(req.session.userId) === String(id)) {
    return res.status(400).json({ message: 'Tidak dapat menghapus akun sendiri' });
  }
  Users.delete(id);
  res.json({ message: 'User berhasil dihapus' });
});

// ─── API: get user's projects ─────────────────────────────────────────────────
router.get('/api/users/:id/projects', adminOnly, (req, res) => {
  res.json(Users.getProjects(Number(req.params.id)));
});

// ─── API: set user's projects ─────────────────────────────────────────────────
router.put('/api/users/:id/projects', adminOnly, (req, res) => {
  const projectIds = (req.body.project_ids || []).map(Number);
  Users.setProjects(Number(req.params.id), projectIds);
  res.json({ message: 'Project assignment berhasil disimpan' });
});

// ─── API: roles list ──────────────────────────────────────────────────────────
router.get('/api/roles', (req, res) => {
  res.json(Roles.getAll());
});

// ─── Pages ────────────────────────────────────────────────────────────────────
router.get('/app/users', adminOnly, (req, res) => {
  res.sendFile(require('path').join(__dirname, '..', 'views', 'users.html'));
});

module.exports = router;
