'use strict';

// Use in-memory SQLite -- must be set before any require of lib/db
process.env.DB_PATH = ':memory:';

let Users, Roles, Projects, Workspaces, SsoConfig;

beforeAll(() => {
  jest.resetModules();
  ({ Users, Roles, Projects, Workspaces, SsoConfig } = require('../lib/db'));
});

// --- Users ------------------------------------------------------------------

describe('Users', () => {
  describe('getAll', () => {
    it('returns array with seeded admin', async () => {
      const users = await Users.getAll();
      expect(Array.isArray(users)).toBe(true);
      const admin = users.find((u) => u.username === 'admin');
      expect(admin).toBeTruthy();
      expect(admin.role_name).toBe('admin');
    });
  });

  describe('getById', () => {
    it('returns user by id', async () => {
      const users = await Users.getAll();
      const admin = users.find((u) => u.username === 'admin');
      const user = await Users.getById(admin.id);
      expect(user).toBeTruthy();
      expect(user.username).toBe('admin');
    });

    it('returns undefined for non-existent id', async () => {
      expect(await Users.getById(99999)).toBeUndefined();
    });
  });

  describe('getByUsername', () => {
    it('returns user by username', async () => {
      const user = await Users.getByUsername('admin');
      expect(user).toBeTruthy();
      expect(user.role_name).toBe('admin');
    });

    it('returns undefined for non-existent username', async () => {
      expect(await Users.getByUsername('no-such-user')).toBeUndefined();
    });
  });

  describe('getByEmail', () => {
    it('returns user by email', async () => {
      const user = await Users.getByEmail('admin@local');
      expect(user).toBeTruthy();
    });

    it('is case-insensitive', async () => {
      expect(await Users.getByEmail('ADMIN@LOCAL')).toBeTruthy();
    });

    it('returns undefined for unknown email', async () => {
      expect(await Users.getByEmail('nope@nope.com')).toBeUndefined();
    });
  });

  describe('create', () => {
    it('creates a user and returns numeric id', async () => {
      const id = await Users.create({ username: 'u_create1', password: 'pass', email: 'c1@test.com', role_id: 2 });
      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
    });

    it('stores empty strings for optional fields', async () => {
      const id = await Users.create({ username: 'u_minimal', password: 'pass', role_id: 2 });
      const user = await Users.getById(id);
      expect(user.full_name).toBe('');
      expect(user.email).toBe('');
    });

    it('throws UNIQUE error on duplicate username', async () => {
      await Users.create({ username: 'u_dup', password: 'pass', role_id: 2 });
      await expect(Users.create({ username: 'u_dup', password: 'pass', role_id: 2 })).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('updates user without changing password', async () => {
      const id = await Users.create({ username: 'u_upd', password: 'oldpass', role_id: 2 });
      await Users.update(id, { full_name: 'Updated Name', email: 'upd@test.com', role_id: 2, is_active: 1 });
      const user = await Users.getById(id);
      expect(user.full_name).toBe('Updated Name');
      expect(user.email).toBe('upd@test.com');
    });

    it('updates password when provided', async () => {
      const id = await Users.create({ username: 'u_pwd', password: 'oldpass', role_id: 2 });
      await Users.update(id, { full_name: '', email: '', role_id: 2, is_active: 1, password: 'newpass' });
      expect(await Users.verifyPassword('u_pwd', 'newpass')).toBeTruthy();
      expect(await Users.verifyPassword('u_pwd', 'oldpass')).toBeNull();
    });

    it('deactivates user', async () => {
      const id = await Users.create({ username: 'u_deact', password: 'pass', role_id: 2 });
      await Users.update(id, { full_name: '', email: '', role_id: 2, is_active: 0 });
      expect(await Users.verifyPassword('u_deact', 'pass')).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes user from db', async () => {
      const id = await Users.create({ username: 'u_del', password: 'pass', role_id: 2 });
      await Users.delete(id);
      expect(await Users.getById(id)).toBeUndefined();
    });
  });

  describe('verifyPassword', () => {
    it('returns user on correct credentials', async () => {
      const result = await Users.verifyPassword('admin', 'admin123');
      expect(result).toBeTruthy();
      expect(result.username).toBe('admin');
    });

    it('returns null on wrong password', async () => {
      expect(await Users.verifyPassword('admin', 'wrongpass')).toBeNull();
    });

    it('returns null for non-existent user', async () => {
      expect(await Users.verifyPassword('nobody', 'pass')).toBeNull();
    });

    it('returns null for inactive user', async () => {
      await Projects.createN8NUser({ username: 'u_inactive', full_name: 'Inactive', email: 'inactive@t.com' });
      expect(await Users.verifyPassword('u_inactive', 'anything')).toBeNull();
    });
  });

  describe('getProjects / setProjects', () => {
    it('assigns and retrieves projects for a user', async () => {
      const uid = await Users.create({ username: 'u_proj', password: 'pass', role_id: 2 });
      const pid = await Projects.create({ name: 'Proj for User', description: '', workflow_url: '' });
      await Users.setProjects(uid, [pid]);
      const projects = await Users.getProjects(uid);
      expect(projects.map((p) => p.id)).toContain(pid);
    });

    it('setProjects replaces full assignment', async () => {
      const uid = await Users.create({ username: 'u_proj2', password: 'pass', role_id: 2 });
      const pid1 = await Projects.create({ name: 'P1', description: '', workflow_url: '' });
      const pid2 = await Projects.create({ name: 'P2', description: '', workflow_url: '' });
      await Users.setProjects(uid, [pid1, pid2]);
      await Users.setProjects(uid, [pid2]);
      const ids = (await Users.getProjects(uid)).map((p) => p.id);
      expect(ids).toContain(pid2);
      expect(ids).not.toContain(pid1);
    });
  });

  describe('assignToAllProjects', () => {
    it('assigns user to every active project', async () => {
      const pid = await Projects.create({ name: 'AllProj', description: '', workflow_url: '' });
      const uid = await Users.create({ username: 'u_allproj', password: 'pass', role_id: 2 });
      await Users.assignToAllProjects(uid);
      const ids = (await Users.getProjects(uid)).map((p) => p.id);
      expect(ids).toContain(pid);
    });
  });
});

// --- Roles ------------------------------------------------------------------

describe('Roles', () => {
  it('getAll returns at least 3 default roles', async () => {
    const roles = await Roles.getAll();
    expect(roles.length).toBeGreaterThanOrEqual(3);
    const names = roles.map((r) => r.name);
    expect(names).toContain('admin');
    expect(names).toContain('editor');
    expect(names).toContain('viewer');
  });
});

// --- Projects ---------------------------------------------------------------

describe('Projects', () => {
  describe('create / getById / getAll', () => {
    it('creates and retrieves a project', async () => {
      const id = await Projects.create({ name: 'My Proj', description: 'Desc', workflow_url: '/workflow/abc' });
      expect(id).toBeGreaterThan(0);
      const p = await Projects.getById(id);
      expect(p.name).toBe('My Proj');
      expect(p.description).toBe('Desc');
    });

    it('getAll returns array including member_count', async () => {
      const all = await Projects.getAll();
      expect(Array.isArray(all)).toBe(true);
      if (all.length > 0) {
        expect('member_count' in all[0]).toBe(true);
      }
    });

    it('getById returns undefined for missing id', async () => {
      expect(await Projects.getById(99999)).toBeUndefined();
    });
  });

  describe('update', () => {
    it('updates project fields', async () => {
      const id = await Projects.create({ name: 'Old', description: '', workflow_url: '' });
      await Projects.update(id, { name: 'New', description: 'New Desc', workflow_url: '/workflow/xyz', is_active: 1 });
      expect((await Projects.getById(id)).name).toBe('New');
    });
  });

  describe('delete', () => {
    it('removes project from db', async () => {
      const id = await Projects.create({ name: 'Del Proj', description: '', workflow_url: '' });
      await Projects.delete(id);
      expect(await Projects.getById(id)).toBeUndefined();
    });
  });

  describe('setN8NProjectId / getByN8NProjectId', () => {
    it('sets and looks up by n8n project id', async () => {
      const id = await Projects.create({ name: 'N8N Proj', description: '', workflow_url: '' });
      await Projects.setN8NProjectId(id, 'uuid-abc-123');
      const p = await Projects.getByN8NProjectId('uuid-abc-123');
      expect(p).toBeTruthy();
      expect(p.id).toBe(id);
    });

    it('returns undefined for unknown n8n project id', async () => {
      expect(await Projects.getByN8NProjectId('no-such-uuid')).toBeUndefined();
    });
  });

  describe('setN8NCredentials', () => {
    it('stores n8n login credentials without throwing', async () => {
      const id = await Projects.create({ name: 'Cred Proj', description: '', workflow_url: '' });
      await expect(Projects.setN8NCredentials(id, 'u@n8n.com', 'secret')).resolves.not.toThrow();
    });
  });

  describe('getMembers / setMembers', () => {
    it('sets and retrieves project members', async () => {
      const pid = await Projects.create({ name: 'Mem Proj', description: '', workflow_url: '' });
      const uid = await Users.create({ username: 'u_mem', password: 'pass', role_id: 2 });
      await Projects.setMembers(pid, [uid]);
      const members = await Projects.getMembers(pid);
      expect(members.find((m) => m.id === uid)).toBeTruthy();
    });

    it('setMembers replaces active user assignments', async () => {
      const pid = await Projects.create({ name: 'Mem Proj2', description: '', workflow_url: '' });
      const uid1 = await Users.create({ username: 'u_mem1', password: 'pass', role_id: 2 });
      const uid2 = await Users.create({ username: 'u_mem2', password: 'pass', role_id: 2 });
      await Projects.setMembers(pid, [uid1, uid2]);
      await Projects.setMembers(pid, [uid2]);
      const ids = (await Projects.getMembers(pid)).map((m) => m.id);
      expect(ids).toContain(uid2);
    });
  });

  describe('assignAllUsers', () => {
    it('assigns every active user to a project', async () => {
      const pid = await Projects.create({ name: 'AllUsers', description: '', workflow_url: '' });
      await Projects.assignAllUsers(pid);
      const members = await Projects.getMembers(pid);
      expect(members.length).toBeGreaterThan(0);
    });
  });

  describe('createN8NUser', () => {
    it('creates an inactive placeholder user', async () => {
      const uid = await Projects.createN8NUser({ username: 'n8nonly1', full_name: 'N8N', email: 'n8nonly1@t.com' });
      expect(uid).toBeGreaterThan(0);
      expect((await Users.getById(uid)).is_active).toBe(0);
    });

    it('returns existing id on duplicate username', async () => {
      await Projects.createN8NUser({ username: 'n8ndup', full_name: 'Dup', email: 'dup@t.com' });
      const uid2 = await Projects.createN8NUser({ username: 'n8ndup', full_name: 'Dup2', email: 'dup2@t.com' });
      expect(uid2).toBeGreaterThan(0);
    });
  });

  describe('assignUserToProject', () => {
    it('creates a user-project link', async () => {
      const pid = await Projects.create({ name: 'Assign Proj', description: '', workflow_url: '' });
      const uid = await Users.create({ username: 'u_assign', password: 'pass', role_id: 2 });
      await Projects.assignUserToProject(uid, pid);
      const members = await Projects.getMembers(pid);
      expect(members.find((m) => m.id === uid)).toBeTruthy();
    });

    it('is idempotent (INSERT OR IGNORE / ON CONFLICT DO NOTHING)', async () => {
      const pid = await Projects.create({ name: 'Idem Proj', description: '', workflow_url: '' });
      const uid = await Users.create({ username: 'u_idem', password: 'pass', role_id: 2 });
      await expect(async () => {
        await Projects.assignUserToProject(uid, pid);
        await Projects.assignUserToProject(uid, pid);
      }).not.toThrow();
    });
  });
});

// --- Workspaces -------------------------------------------------------------

describe('Workspaces', () => {
  describe('create / getById / getAll', () => {
    it('creates and retrieves a workspace', async () => {
      const id = await Workspaces.create({ name: 'WS Test', workflow_id: 'WFTEST001', description: 'desc' });
      expect(id).toBeGreaterThan(0);
      const ws = await Workspaces.getById(id);
      expect(ws.name).toBe('WS Test');
      expect(ws.workflow_id).toBe('WFTEST001');
    });

    it('uses workflow_id as name when name is empty', async () => {
      const id = await Workspaces.create({ name: '', workflow_id: 'WFNONAME', description: '' });
      const ws = await Workspaces.getById(id);
      expect(ws.name).toBe('WFNONAME');
    });

    it('getAll returns array', async () => {
      expect(Array.isArray(await Workspaces.getAll())).toBe(true);
    });

    it('getById returns undefined for unknown id', async () => {
      expect(await Workspaces.getById(99999)).toBeUndefined();
    });
  });

  describe('getByWorkflowId', () => {
    it('retrieves workspace by workflow_id', async () => {
      await Workspaces.create({ name: 'WS2', workflow_id: 'WFUNIQ88', description: '' });
      expect(await Workspaces.getByWorkflowId('WFUNIQ88')).toBeTruthy();
    });

    it('returns undefined for unknown workflow_id', async () => {
      expect(await Workspaces.getByWorkflowId('NONEXISTENT')).toBeUndefined();
    });
  });

  describe('update', () => {
    it('updates workspace fields', async () => {
      const id = await Workspaces.create({ name: 'Old WS', workflow_id: 'WFUPD01', description: '' });
      await Workspaces.update(id, { name: 'New WS', workflow_id: 'WFUPD01', description: 'Updated', is_active: 1 });
      expect((await Workspaces.getById(id)).name).toBe('New WS');
    });
  });

  describe('delete', () => {
    it('removes workspace', async () => {
      const id = await Workspaces.create({ name: 'Del WS', workflow_id: 'WFDEL99', description: '' });
      await Workspaces.delete(id);
      expect(await Workspaces.getById(id)).toBeUndefined();
    });
  });
});

// --- SsoConfig --------------------------------------------------------------

describe('SsoConfig', () => {
  it('get returns default object when no row exists', async () => {
    const cfg = await SsoConfig.get();
    expect(cfg).toMatchObject({ enabled: 0, show_login_button: 1, provider: 'custom_oidc', client_id: '', tenant_id: '' });
  });

  it('save and get round-trip (azure)', async () => {
    await SsoConfig.save({
      enabled: true,
      show_login_button: true,
      provider: 'azure',
      client_id: 'client-1',
      client_secret: 'secret-1',
      tenant_id: 'tenant-1',
      issuer_url: '',
      app_url: 'http://localhost:3000',
    });
    const cfg = await SsoConfig.get();
    expect(cfg.enabled).toBe(1);
    expect(cfg.show_login_button).toBe(1);
    expect(cfg.client_id).toBe('client-1');
    expect(cfg.tenant_id).toBe('tenant-1');
    expect(cfg.app_url).toBe('http://localhost:3000');
  });

  it('save overwrites existing row (okta)', async () => {
    await SsoConfig.save({
      enabled: true,
      show_login_button: false,
      provider: 'okta',
      client_id: 'okta-id',
      client_secret: 'okta-sec',
      tenant_id: '',
      issuer_url: '',
      app_url: '',
    });
    const cfg = await SsoConfig.get();
    expect(cfg.provider).toBe('okta');
    expect(cfg.show_login_button).toBe(0);
  });
});