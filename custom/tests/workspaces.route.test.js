'use strict';

const request = require('supertest');
const express = require('express');

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockWorkspaces = {
  getAll: jest.fn().mockReturnValue([
    { id: 1, name: 'WS1', workflow_id: 'ABC123', description: '', is_active: 1 },
    { id: 2, name: 'WS2', workflow_id: 'DEF456', description: '', is_active: 1 },
  ]),
  getById: jest.fn().mockImplementation((id) =>
    id === 1
      ? { id: 1, name: 'WS1', workflow_id: 'ABC123', description: '', is_active: 1 }
      : id === 2
      ? { id: 2, name: 'WS2', workflow_id: 'DEF456', description: '', is_active: 1 }
      : undefined,
  ),
  getByWorkflowId: jest.fn().mockReturnValue(undefined),
  create: jest.fn().mockReturnValue(10),
  update: jest.fn(),
  delete: jest.fn(),
};

jest.mock('../lib/db', () => ({
  Workspaces: mockWorkspaces,
  Users: {},
  Roles: {},
  Projects: {},
  SsoConfig: {},
}));

jest.mock('axios', () => ({
  get: jest.fn().mockResolvedValue({
    data: { data: { name: 'Live WF Name', active: true } },
  }),
}));

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
  app.use(require('../routes/workspaces'));
  return app;
}

// ─── GET /api/workspaces ──────────────────────────────────────────────────────

describe('GET /api/workspaces', () => {
  it('200 returns workspace list', async () => {
    const res = await request(createApp()).get('/api/workspaces');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
  });
});

// ─── GET /api/workspaces/:id ───────────────────────────────────────────────────

describe('GET /api/workspaces/:id', () => {
  it('200 returns workspace when found', async () => {
    const res = await request(createApp()).get('/api/workspaces/1');
    expect(res.status).toBe(200);
    expect(res.body.workflow_id).toBe('ABC123');
  });

  it('404 when not found', async () => {
    const res = await request(createApp()).get('/api/workspaces/9999');
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/workspaces/:id/n8n-info ─────────────────────────────────────────

describe('GET /api/workspaces/:id/n8n-info', () => {
  it('200 returns workspace merged with live n8n info', async () => {
    const res = await request(createApp()).get('/api/workspaces/1/n8n-info');
    expect(res.status).toBe(200);
    expect(res.body.n8n_name).toBe('Live WF Name');
    expect(res.body.n8n_active).toBe(true);
  });

  it('404 when workspace not found', async () => {
    const res = await request(createApp()).get('/api/workspaces/9999/n8n-info');
    expect(res.status).toBe(404);
  });

  it('200 with null/false defaults when axios fails', async () => {
    const axios = require('axios');
    axios.get.mockRejectedValueOnce(new Error('network error'));
    const res = await request(createApp()).get('/api/workspaces/1/n8n-info');
    expect(res.status).toBe(200);
    expect(res.body.n8n_name).toBeNull();
    expect(res.body.n8n_active).toBe(false);
  });
});

// ─── POST /api/workspaces ─────────────────────────────────────────────────────

describe('POST /api/workspaces', () => {
  beforeEach(() => {
    mockWorkspaces.getByWorkflowId.mockReturnValue(undefined);
    mockWorkspaces.create.mockReturnValue(10);
  });

  it('201 creates workspace with plain workflow_id', async () => {
    const res = await request(createApp())
      .post('/api/workspaces')
      .send({ name: 'New WS', workflow_id: 'NEWWF01', description: 'Test' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(10);
  });

  it('201 extracts workflow_id from full URL', async () => {
    const res = await request(createApp())
      .post('/api/workspaces')
      .send({ name: 'URL WS', workflow_id: 'http://localhost:5678/workflow/WFROMURL', description: '' });
    expect(res.status).toBe(201);
    expect(mockWorkspaces.create).toHaveBeenCalledWith(
      expect.objectContaining({ workflow_id: 'WFROMURL' }),
    );
  });

  it('400 when workflow_id is missing', async () => {
    const res = await request(createApp()).post('/api/workspaces').send({ name: 'No WF' });
    expect(res.status).toBe(400);
  });

  it('400 when workflow_id format is invalid', async () => {
    const res = await request(createApp())
      .post('/api/workspaces')
      .send({ name: 'Bad Format', workflow_id: 'not valid!!' });
    expect(res.status).toBe(400);
  });

  it('409 when workflow_id already registered', async () => {
    mockWorkspaces.getByWorkflowId.mockReturnValueOnce({ id: 5, workflow_id: 'DUP01' });
    const res = await request(createApp())
      .post('/api/workspaces')
      .send({ workflow_id: 'DUP01' });
    expect(res.status).toBe(409);
  });

  it('409 on UNIQUE constraint error from db', async () => {
    mockWorkspaces.create.mockImplementationOnce(() => {
      throw new Error('UNIQUE constraint failed');
    });
    const res = await request(createApp())
      .post('/api/workspaces')
      .send({ workflow_id: 'UNIQ01' });
    expect(res.status).toBe(409);
  });

  it('403 for non-admin', async () => {
    const res = await request(createApp({ role: 'viewer', userId: 3 }))
      .post('/api/workspaces')
      .send({ workflow_id: 'WFTEST' });
    expect(res.status).toBe(403);
  });
});

// ─── PUT /api/workspaces/:id ───────────────────────────────────────────────────

describe('PUT /api/workspaces/:id', () => {
  beforeEach(() => {
    mockWorkspaces.getByWorkflowId.mockReturnValue(undefined);
  });

  it('200 updates workspace', async () => {
    const res = await request(createApp())
      .put('/api/workspaces/1')
      .send({ name: 'Updated WS', workflow_id: 'ABC123', description: 'New desc', is_active: 1 });
    expect(res.status).toBe(200);
    expect(mockWorkspaces.update).toHaveBeenCalled();
  });

  it('400 when workflow_id missing', async () => {
    const res = await request(createApp())
      .put('/api/workspaces/1')
      .send({ name: 'No WF' });
    expect(res.status).toBe(400);
  });

  it('400 when workflow_id has invalid format', async () => {
    const res = await request(createApp())
      .put('/api/workspaces/1')
      .send({ workflow_id: 'bad id!!' });
    expect(res.status).toBe(400);
  });

  it('409 when workflow_id used by another workspace', async () => {
    mockWorkspaces.getByWorkflowId.mockReturnValueOnce({ id: 99, workflow_id: 'CONFLICT' });
    const res = await request(createApp())
      .put('/api/workspaces/1')
      .send({ workflow_id: 'CONFLICT' });
    expect(res.status).toBe(409);
  });

  it('200 when same workspace owns the workflow_id (no conflict)', async () => {
    mockWorkspaces.getByWorkflowId.mockReturnValueOnce({ id: 1, workflow_id: 'ABC123' });
    const res = await request(createApp())
      .put('/api/workspaces/1')
      .send({ name: 'Same WS', workflow_id: 'ABC123', is_active: 1 });
    expect(res.status).toBe(200);
  });

  it('handles is_active: false → 0', async () => {
    const res = await request(createApp())
      .put('/api/workspaces/1')
      .send({ workflow_id: 'ABC123', is_active: false });
    expect(res.status).toBe(200);
    expect(mockWorkspaces.update).toHaveBeenCalledWith(1, expect.objectContaining({ is_active: 0 }));
  });
});

// ─── DELETE /api/workspaces/:id ───────────────────────────────────────────────

describe('DELETE /api/workspaces/:id', () => {
  it('200 deletes workspace', async () => {
    const res = await request(createApp()).delete('/api/workspaces/1');
    expect(res.status).toBe(200);
    expect(mockWorkspaces.delete).toHaveBeenCalledWith(1);
  });

  it('404 when workspace does not exist', async () => {
    const res = await request(createApp()).delete('/api/workspaces/9999');
    expect(res.status).toBe(404);
  });

  it('403 for non-admin', async () => {
    const res = await request(createApp({ role: 'editor', userId: 2 })).delete('/api/workspaces/1');
    expect(res.status).toBe(403);
  });
});
