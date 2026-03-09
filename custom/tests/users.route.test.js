'use strict';

const request = require('supertest');
const express = require('express');

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockInviteN8NUser = jest.fn().mockResolvedValue({ id: 'n8n-user-1' });

jest.mock('../lib/db', () => ({
  Users: {
    getAll: jest.fn().mockReturnValue([
      { id: 1, username: 'admin', role_name: 'admin', is_active: 1 },
      { id: 2, username: 'user1', role_name: 'editor', is_active: 1 },
    ]),
    getById: jest.fn().mockImplementation((id) =>
      id === 1
        ? { id: 1, username: 'admin', role_name: 'admin', is_active: 1 }
        : id === 2
        ? { id: 2, username: 'user1', role_name: 'editor', is_active: 1 }
        : undefined,
    ),
    create: jest.fn().mockReturnValue(99),
    update: jest.fn(),
    delete: jest.fn(),
    getProjects: jest.fn().mockReturnValue([{ id: 10, name: 'Project A' }]),
    setProjects: jest.fn(),
    assignToAllProjects: jest.fn(),
  },
  Roles: {
    getAll: jest.fn().mockReturnValue([
      { id: 1, name: 'admin', label: 'Administrator' },
      { id: 2, name: 'editor', label: 'Editor' },
    ]),
  },
  Projects: {},
  Workspaces: {},
  SsoConfig: {},
}));

jest.mock('../routes/projects', () => {
  const router = require('express').Router();
  router.inviteN8NUser = mockInviteN8NUser;
  return Object.assign(router, { inviteN8NUser: mockInviteN8NUser });
});

jest.mock('../server-state', () => ({
  getN8NCookies: jest.fn().mockReturnValue('session=test'),
  getN8NApiKey: jest.fn().mockReturnValue('api-key'),
  setN8NCookies: jest.fn(),
}));

// ─── App factory ──────────────────────────────────────────────────────────────

function createApp(sessionData = { role: 'admin', userId: 99, authenticated: true }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { ...sessionData };
    next();
  });
  app.use(require('../routes/users'));
  return app;
}

const { Users, Roles } = require('../lib/db');

// ─── GET /api/users ───────────────────────────────────────────────────────────

describe('GET /api/users', () => {
  it('200 returns user list for admin', async () => {
    const res = await request(createApp()).get('/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
  });

  it('403 for non-admin role', async () => {
    const res = await request(createApp({ role: 'viewer', userId: 2 })).get('/api/users');
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/users/:id ───────────────────────────────────────────────────────

describe('GET /api/users/:id', () => {
  it('200 returns user when found', async () => {
    const res = await request(createApp()).get('/api/users/1');
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('admin');
  });

  it('404 when user not found', async () => {
    const res = await request(createApp()).get('/api/users/9999');
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/users ──────────────────────────────────────────────────────────

describe('POST /api/users', () => {
  beforeEach(() => jest.clearAllMocks());

  it('201 creates user without email', async () => {
    Users.create.mockReturnValue(55);
    const res = await request(createApp())
      .post('/api/users')
      .send({ username: 'newuser', password: 'pass123', role_id: 2 });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(55);
    expect(res.body.message).toContain('berhasil');
  });

  it('201 invites user to n8n when email provided', async () => {
    Users.create.mockReturnValue(56);
    mockInviteN8NUser.mockResolvedValueOnce({ id: 'n8n-56' });
    const res = await request(createApp())
      .post('/api/users')
      .send({ username: 'emailuser', password: 'pass123', email: 'test@example.com', role_id: 2 });
    expect(res.status).toBe(201);
    expect(res.body.message).toContain('n8n');
  });

  it('201 with n8n invite fallback message when invite fails', async () => {
    Users.create.mockReturnValue(57);
    mockInviteN8NUser.mockResolvedValueOnce(null);
    const res = await request(createApp())
      .post('/api/users')
      .send({ username: 'failinvite', password: 'pass', email: 'fail@example.com', role_id: 2 });
    expect(res.status).toBe(201);
    expect(res.body.message).toContain('gagal');
  });

  it('400 when username missing', async () => {
    const res = await request(createApp())
      .post('/api/users')
      .send({ password: 'pass' });
    expect(res.status).toBe(400);
  });

  it('400 when password missing', async () => {
    const res = await request(createApp())
      .post('/api/users')
      .send({ username: 'nopass' });
    expect(res.status).toBe(400);
  });

  it('409 on duplicate username', async () => {
    Users.create.mockImplementationOnce(() => {
      const err = new Error('UNIQUE constraint failed');
      throw err;
    });
    const res = await request(createApp())
      .post('/api/users')
      .send({ username: 'dupuser', password: 'pass', role_id: 2 });
    expect(res.status).toBe(409);
  });

  it('403 for non-admin', async () => {
    const res = await request(createApp({ role: 'editor', userId: 2 }))
      .post('/api/users')
      .send({ username: 'x', password: 'y' });
    expect(res.status).toBe(403);
  });
});

// ─── PUT /api/users/:id ───────────────────────────────────────────────────────

describe('PUT /api/users/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 updates user', async () => {
    const res = await request(createApp())
      .put('/api/users/2')
      .send({ full_name: 'Updated', email: 'u@test.com', role_id: 2, is_active: 1 });
    expect(res.status).toBe(200);
    expect(Users.update).toHaveBeenCalledWith(2, expect.objectContaining({ full_name: 'Updated' }));
  });

  it('400 when trying to downgrade last admin', async () => {
    // Only one admin in the list
    Users.getAll.mockReturnValueOnce([
      { id: 1, username: 'admin', role_name: 'admin', is_active: 1 },
    ]);
    Users.getById.mockReturnValueOnce({ id: 1, username: 'admin', role_name: 'admin' });
    const res = await request(createApp())
      .put('/api/users/1')
      .send({ role_id: 2, full_name: '', email: '', is_active: 1 });
    expect(res.status).toBe(400);
  });

  it('200 when changing role of non-last admin', async () => {
    Users.getAll.mockReturnValueOnce([
      { id: 1, username: 'admin', role_name: 'admin' },
      { id: 3, username: 'admin2', role_name: 'admin' },
    ]);
    Users.getById.mockReturnValueOnce({ id: 1, username: 'admin', role_name: 'admin' });
    const res = await request(createApp())
      .put('/api/users/1')
      .send({ role_id: 2, full_name: '', email: '', is_active: 1 });
    expect(res.status).toBe(200);
  });

  it('passes null password when not provided', async () => {
    const res = await request(createApp())
      .put('/api/users/2')
      .send({ full_name: '', email: '', role_id: 2 });
    expect(res.status).toBe(200);
    expect(Users.update).toHaveBeenCalledWith(2, expect.objectContaining({ password: null }));
  });

  it('handles is_active: false → 0', async () => {
    const res = await request(createApp())
      .put('/api/users/2')
      .send({ full_name: '', email: '', role_id: 2, is_active: false });
    expect(res.status).toBe(200);
    expect(Users.update).toHaveBeenCalledWith(2, expect.objectContaining({ is_active: 0 }));
  });
});

// ─── DELETE /api/users/:id ────────────────────────────────────────────────────

describe('DELETE /api/users/:id', () => {
  it('200 deletes user', async () => {
    const res = await request(createApp({ role: 'admin', userId: 99 })).delete('/api/users/2');
    expect(res.status).toBe(200);
    expect(Users.delete).toHaveBeenCalledWith(2);
  });

  it('400 when trying to delete own account', async () => {
    const res = await request(createApp({ role: 'admin', userId: 2 })).delete('/api/users/2');
    expect(res.status).toBe(400);
  });

  it('403 for non-admin', async () => {
    const res = await request(createApp({ role: 'viewer', userId: 3 })).delete('/api/users/2');
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/users/:id/projects ──────────────────────────────────────────────

describe('GET /api/users/:id/projects', () => {
  it('200 returns projects list', async () => {
    const res = await request(createApp()).get('/api/users/1/projects');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── PUT /api/users/:id/projects ─────────────────────────────────────────────

describe('PUT /api/users/:id/projects', () => {
  it('200 sets project assignments', async () => {
    const res = await request(createApp())
      .put('/api/users/1/projects')
      .send({ project_ids: [1, 2, 3] });
    expect(res.status).toBe(200);
    expect(Users.setProjects).toHaveBeenCalledWith(1, [1, 2, 3]);
  });

  it('200 with empty array', async () => {
    const res = await request(createApp())
      .put('/api/users/1/projects')
      .send({});
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/roles ───────────────────────────────────────────────────────────

describe('GET /api/roles', () => {
  it('200 returns roles', async () => {
    const res = await request(createApp()).get('/api/roles');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
