'use strict';

const request = require('supertest');
const express = require('express');

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockProjects = {
  getAll: jest.fn().mockReturnValue([
    { id: 1, name: 'Project A', description: '', workflow_url: '/workflow/WF1', is_active: 1, n8n_project_id: '', n8n_login_email: '', n8n_login_password: '' },
    { id: 2, name: 'Project B', description: '', workflow_url: '', is_active: 1, n8n_project_id: '', n8n_login_email: '', n8n_login_password: '' },
  ]),
  getById: jest.fn().mockImplementation((id) => {
    if (id === 1) return { id: 1, name: 'Project A', workflow_url: '/workflow/WF1', n8n_project_id: 'n8n-proj-1', n8n_login_email: 'user@n8n.com', n8n_login_password: 'pass' };
    if (id === 2) return { id: 2, name: 'Project B', workflow_url: '', n8n_project_id: '', n8n_login_email: '', n8n_login_password: '' };
    return undefined;
  }),
  create: jest.fn().mockReturnValue(99),
  update: jest.fn(),
  delete: jest.fn(),
  getMembers: jest.fn().mockReturnValue([
    { id: 1, username: 'admin', role_label: 'Administrator', is_active: 1 },
  ]),
  setMembers: jest.fn(),
  assignAllUsers: jest.fn(),
  setN8NProjectId: jest.fn(),
  setN8NCredentials: jest.fn(),
  createN8NUser: jest.fn().mockReturnValue(50),
  assignUserToProject: jest.fn(),
  getByN8NProjectId: jest.fn().mockReturnValue(undefined),
};

const mockUsers = {
  getProjects: jest.fn().mockReturnValue([
    { id: 1, name: 'Project A' },
  ]),
};

const mockWorkspaces = {
  create: jest.fn().mockReturnValue(77),
};

jest.mock('../lib/db', () => ({
  Projects: mockProjects,
  Users: mockUsers,
  Roles: {},
  Workspaces: mockWorkspaces,
  SsoConfig: {},
}));

const mockAxios = {
  post: jest.fn().mockResolvedValue({
    status: 200,
    headers: { 'set-cookie': ['n8n-auth=wf-cookie; Path=/'] },
    data: { data: { id: 'n8n-user-1' } },
  }),
  get: jest.fn().mockResolvedValue({ data: { data: { id: 'n8n-proj-99' } } }),
  put: jest.fn().mockResolvedValue({ data: {} }),
  delete: jest.fn().mockResolvedValue({ data: {} }),
};
jest.mock('axios', () => mockAxios);

const mockState = {
  getN8NCookies: jest.fn().mockReturnValue('session=admin-session'),
  getN8NApiKey: jest.fn().mockReturnValue('api-key-test'),
  setN8NCookies: jest.fn(),
};
jest.mock('../server-state', () => mockState);

// ─── App factory ──────────────────────────────────────────────────────────────

function createApp(sessionData = { role: 'admin', userId: 99, authenticated: true }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { ...sessionData };
    next();
  });
  app.use(require('../routes/projects'));
  return app;
}

// ─── GET /api/projects ────────────────────────────────────────────────────────

describe('GET /api/projects', () => {
  it('200 returns all projects for admin', async () => {
    const res = await request(createApp()).get('/api/projects');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(mockProjects.getAll).toHaveBeenCalled();
  });

  it('200 returns only user projects for non-admin', async () => {
    const res = await request(createApp({ role: 'editor', userId: 5 })).get('/api/projects');
    expect(res.status).toBe(200);
    expect(mockUsers.getProjects).toHaveBeenCalledWith(5);
  });
});

// ─── GET /api/projects/:id ────────────────────────────────────────────────────

describe('GET /api/projects/:id', () => {
  it('200 returns project when found', async () => {
    const res = await request(createApp()).get('/api/projects/1');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Project A');
  });

  it('404 when project not found', async () => {
    const res = await request(createApp()).get('/api/projects/9999');
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/projects/:id/n8n-token ────────────────────────────────────────

describe('POST /api/projects/:id/n8n-token', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 success when credentials present', async () => {
    mockAxios.post.mockResolvedValueOnce({
      headers: { 'set-cookie': ['n8n-auth=tok; Path=/'] },
      data: { data: { id: 'uid1' } },
    });
    const res = await request(createApp()).post('/api/projects/1/n8n-token');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('200 success via cookie in error response', async () => {
    mockAxios.post.mockRejectedValueOnce(
      Object.assign(new Error('redirect'), {
        response: { headers: { 'set-cookie': ['n8n-auth=fallback; Path=/'] } },
      }),
    );
    const res = await request(createApp()).post('/api/projects/1/n8n-token');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('200 failure when no credentials stored', async () => {
    const res = await request(createApp()).post('/api/projects/2/n8n-token');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });

  it('404 when project not found', async () => {
    const res = await request(createApp()).post('/api/projects/9999/n8n-token');
    expect(res.status).toBe(404);
  });

  it('200 failure on axios error without cookies', async () => {
    mockAxios.post.mockRejectedValueOnce(
      Object.assign(new Error('unauthorized'), {
        response: { data: { message: 'Wrong credentials' }, headers: {} },
      }),
    );
    const res = await request(createApp()).post('/api/projects/1/n8n-token');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });

  it('200 with workflow sharing when workflow_url set', async () => {
    mockAxios.post.mockResolvedValueOnce({
      headers: { 'set-cookie': ['n8n-auth=tok; Path=/'] },
      data: { data: { id: 'uid-share' } },
    });
    mockAxios.put.mockResolvedValueOnce({ data: {} });
    const res = await request(createApp()).post('/api/projects/1/n8n-token');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /api/projects ───────────────────────────────────────────────────────

describe('POST /api/projects', () => {
  beforeEach(() => jest.clearAllMocks());

  it('201 creates project without user payload', async () => {
    mockProjects.create.mockReturnValue(100);
    const res = await request(createApp())
      .post('/api/projects')
      .send({ name: 'New Proj', description: 'Desc' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(100);
  });

  it('400 when name missing', async () => {
    const res = await request(createApp())
      .post('/api/projects')
      .send({ description: 'No name' });
    expect(res.status).toBe(400);
  });

  it('403 for non-admin', async () => {
    const res = await request(createApp({ role: 'editor', userId: 2 }))
      .post('/api/projects')
      .send({ name: 'Proj' });
    expect(res.status).toBe(403);
  });
});

// ─── PUT /api/projects/:id ────────────────────────────────────────────────────

describe('PUT /api/projects/:id', () => {
  it('200 updates project', async () => {
    const res = await request(createApp())
      .put('/api/projects/1')
      .send({ name: 'Updated', description: '', workflow_url: '', is_active: 1 });
    expect(res.status).toBe(200);
    expect(mockProjects.update).toHaveBeenCalled();
  });

  it('403 for non-admin', async () => {
    const res = await request(createApp({ role: 'viewer', userId: 3 }))
      .put('/api/projects/1')
      .send({ name: 'X' });
    expect(res.status).toBe(403);
  });
});

// ─── DELETE /api/projects/:id ─────────────────────────────────────────────────

describe('DELETE /api/projects/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 deletes project (calls n8n delete if n8n_project_id set)', async () => {
    mockAxios.delete.mockResolvedValueOnce({ data: {} });
    const res = await request(createApp()).delete('/api/projects/1');
    expect(res.status).toBe(200);
    expect(mockProjects.delete).toHaveBeenCalledWith(1);
  });

  it('200 deletes project even when n8n delete fails', async () => {
    mockAxios.delete.mockRejectedValueOnce(new Error('n8n error'));
    const res = await request(createApp()).delete('/api/projects/1');
    expect(res.status).toBe(200);
    expect(mockProjects.delete).toHaveBeenCalledWith(1);
  });

  it('200 deletes project without n8n_project_id (no n8n call)', async () => {
    const res = await request(createApp()).delete('/api/projects/2');
    expect(res.status).toBe(200);
    expect(mockAxios.delete).not.toHaveBeenCalled();
  });

  it('403 for non-admin', async () => {
    const res = await request(createApp({ role: 'viewer', userId: 3 })).delete('/api/projects/1');
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/projects/:id/members ───────────────────────────────────────────

describe('GET /api/projects/:id/members', () => {
  it('200 returns members list', async () => {
    const res = await request(createApp()).get('/api/projects/1/members');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('403 for non-admin', async () => {
    const res = await request(createApp({ role: 'editor', userId: 2 })).get('/api/projects/1/members');
    expect(res.status).toBe(403);
  });
});

// ─── PUT /api/projects/:id/members ───────────────────────────────────────────

describe('PUT /api/projects/:id/members', () => {
  it('200 sets member assignment', async () => {
    const res = await request(createApp())
      .put('/api/projects/1/members')
      .send({ user_ids: [1, 2, 3] });
    expect(res.status).toBe(200);
    expect(mockProjects.setMembers).toHaveBeenCalledWith(1, [1, 2, 3]);
  });

  it('200 with empty user_ids', async () => {
    const res = await request(createApp())
      .put('/api/projects/1/members')
      .send({});
    expect(res.status).toBe(200);
    expect(mockProjects.setMembers).toHaveBeenCalledWith(1, []);
  });
});
