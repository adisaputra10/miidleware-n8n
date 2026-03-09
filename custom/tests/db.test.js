'use strict';

// Use in-memory SQLite — must be set before any require of lib/db
process.env.DB_PATH = ':memory:';

let Users, Roles, Projects, Workspaces, SsoConfig;

beforeAll(() => {
  jest.resetModules();
  ({ Users, Roles, Projects, Workspaces, SsoConfig } = require('../lib/db'));
});

// ─── Users ──────────────────────────────────────────────────────────────────

describe('Users', () => {
  describe('getAll', () => {
    it('returns array with seeded admin', () => {
      const users = Users.getAll();
      expect(Array.isArray(users)).toBe(true);
      const admin = users.find((u) => u.username === 'admin');
      expect(admin).toBeTruthy();
      expect(admin.role_name).toBe('admin');
    });
  });

  describe('getById', () => {
    it('returns user by id', () => {
      const admin = Users.getAll().find((u) => u.username === 'admin');
      const user = Users.getById(admin.id);
      expect(user).toBeTruthy();
      expect(user.username).toBe('admin');
    });

    it('returns undefined for non-existent id', () => {
      expect(Users.getById(99999)).toBeUndefined();
    });
  });

  describe('getByUsername', () => {
    it('returns user by username', () => {
      const user = Users.getByUsername('admin');
      expect(user).toBeTruthy();
      expect(user.role_name).toBe('admin');
    });

    it('returns undefined for non-existent username', () => {
      expect(Users.getByUsername('no-such-user')).toBeUndefined();
    });
  });

  describe('getByEmail', () => {
    it('returns user by email', () => {
      const user = Users.getByEmail('admin@local');
      expect(user).toBeTruthy();
    });

    it('is case-insensitive', () => {
      expect(Users.getByEmail('ADMIN@LOCAL')).toBeTruthy();
    });

    it('returns undefined for unknown email', () => {
      expect(Users.getByEmail('nope@nope.com')).toBeUndefined();
    });
  });

  describe('create', () => {
    it('creates a user and returns numeric id', () => {
      const id = Users.create({ username: 'u_create1', password: 'pass', email: 'c1@test.com', role_id: 2 });
      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
    });

    it('stores empty strings for optional fields', () => {
      const id = Users.create({ username: 'u_minimal', password: 'pass', role_id: 2 });
      const user = Users.getById(id);
      expect(user.full_name).toBe('');
      expect(user.email).toBe('');
    });

    it('throws UNIQUE error on duplicate username', () => {
      Users.create({ username: 'u_dup', password: 'pass', role_id: 2 });
      expect(() => Users.create({ username: 'u_dup', password: 'pass', role_id: 2 })).toThrow();
    });
  });

  describe('update', () => {
    it('updates user without changing password', () => {
      const id = Users.create({ username: 'u_upd', password: 'oldpass', role_id: 2 });
      Users.update(id, { full_name: 'Updated Name', email: 'upd@test.com', role_id: 2, is_active: 1 });
      const user = Users.getById(id);
      expect(user.full_name).toBe('Updated Name');
      expect(user.email).toBe('upd@test.com');
    });

    it('updates password when provided', () => {
      const id = Users.create({ username: 'u_pwd', password: 'oldpass', role_id: 2 });
      Users.update(id, { full_name: '', email: '', role_id: 2, is_active: 1, password: 'newpass' });
      expect(Users.verifyPassword('u_pwd', 'newpass')).toBeTruthy();
      expect(Users.verifyPassword('u_pwd', 'oldpass')).toBeNull();
    });

    it('deactivates user', () => {
      const id = Users.create({ username: 'u_deact', password: 'pass', role_id: 2 });
      Users.update(id, { full_name: '', email: '', role_id: 2, is_active: 0 });
      expect(Users.verifyPassword('u_deact', 'pass')).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes user from db', () => {
      const id = Users.create({ username: 'u_del', password: 'pass', role_id: 2 });
      Users.delete(id);
      expect(Users.getById(id)).toBeUndefined();
    });
  });

  describe('verifyPassword', () => {
    it('returns user on correct credentials', () => {
      const result = Users.verifyPassword('admin', 'admin123');
      expect(result).toBeTruthy();
      expect(result.username).toBe('admin');
    });

    it('returns null on wrong password', () => {
      expect(Users.verifyPassword('admin', 'wrongpass')).toBeNull();
    });

    it('returns null for non-existent user', () => {
      expect(Users.verifyPassword('nobody', 'pass')).toBeNull();
    });

    it('returns null for inactive user', () => {
      Projects.createN8NUser({ username: 'u_inactive', full_name: 'Inactive', email: 'inactive@t.com' });
      expect(Users.verifyPassword('u_inactive', 'anything')).toBeNull();
    });
  });

  describe('getProjects / setProjects', () => {
    it('assigns and retrieves projects for a user', () => {
      const uid = Users.create({ username: 'u_proj', password: 'pass', role_id: 2 });
      const pid = Projects.create({ name: 'Proj for User', description: '', workflow_url: '' });
      Users.setProjects(uid, [pid]);
      const projects = Users.getProjects(uid);
      expect(projects.map((p) => p.id)).toContain(pid);
    });

    it('setProjects replaces full assignment', () => {
      const uid = Users.create({ username: 'u_proj2', password: 'pass', role_id: 2 });
      const pid1 = Projects.create({ name: 'P1', description: '', workflow_url: '' });
      const pid2 = Projects.create({ name: 'P2', description: '', workflow_url: '' });
      Users.setProjects(uid, [pid1, pid2]);
      Users.setProjects(uid, [pid2]);
      const ids = Users.getProjects(uid).map((p) => p.id);
      expect(ids).toContain(pid2);
      expect(ids).not.toContain(pid1);
    });
  });

  describe('assignToAllProjects', () => {
    it('assigns user to every active project', () => {
      const pid = Projects.create({ name: 'AllProj', description: '', workflow_url: '' });
      const uid = Users.create({ username: 'u_allproj', password: 'pass', role_id: 2 });
      Users.assignToAllProjects(uid);
      const ids = Users.getProjects(uid).map((p) => p.id);
      expect(ids).toContain(pid);
    });
  });
});

// ─── Roles ───────────────────────────────────────────────────────────────────

describe('Roles', () => {
  it('getAll returns at least 3 default roles', () => {
    const roles = Roles.getAll();
    expect(roles.length).toBeGreaterThanOrEqual(3);
    const names = roles.map((r) => r.name);
    expect(names).toContain('admin');
    expect(names).toContain('editor');
    expect(names).toContain('viewer');
  });
});

// ─── Projects ────────────────────────────────────────────────────────────────

describe('Projects', () => {
  describe('create / getById / getAll', () => {
    it('creates and retrieves a project', () => {
      const id = Projects.create({ name: 'My Proj', description: 'Desc', workflow_url: '/workflow/abc' });
      expect(id).toBeGreaterThan(0);
      const p = Projects.getById(id);
      expect(p.name).toBe('My Proj');
      expect(p.description).toBe('Desc');
    });

    it('getAll returns array including member_count', () => {
      const all = Projects.getAll();
      expect(Array.isArray(all)).toBe(true);
      if (all.length > 0) {
        expect('member_count' in all[0]).toBe(true);
      }
    });

    it('getById returns undefined for missing id', () => {
      expect(Projects.getById(99999)).toBeUndefined();
    });
  });

  describe('update', () => {
    it('updates project fields', () => {
      const id = Projects.create({ name: 'Old', description: '', workflow_url: '' });
      Projects.update(id, { name: 'New', description: 'New Desc', workflow_url: '/workflow/xyz', is_active: 1 });
      expect(Projects.getById(id).name).toBe('New');
    });
  });

  describe('delete', () => {
    it('removes project from db', () => {
      const id = Projects.create({ name: 'Del Proj', description: '', workflow_url: '' });
      Projects.delete(id);
      expect(Projects.getById(id)).toBeUndefined();
    });
  });

  describe('setN8NProjectId / getByN8NProjectId', () => {
    it('sets and looks up by n8n project id', () => {
      const id = Projects.create({ name: 'N8N Proj', description: '', workflow_url: '' });
      Projects.setN8NProjectId(id, 'uuid-abc-123');
      const p = Projects.getByN8NProjectId('uuid-abc-123');
      expect(p).toBeTruthy();
      expect(p.id).toBe(id);
    });

    it('returns undefined for unknown n8n project id', () => {
      expect(Projects.getByN8NProjectId('no-such-uuid')).toBeUndefined();
    });
  });

  describe('setN8NCredentials', () => {
    it('stores n8n login credentials without throwing', () => {
      const id = Projects.create({ name: 'Cred Proj', description: '', workflow_url: '' });
      expect(() => Projects.setN8NCredentials(id, 'u@n8n.com', 'secret')).not.toThrow();
    });
  });

  describe('getMembers / setMembers', () => {
    it('sets and retrieves project members', () => {
      const pid = Projects.create({ name: 'Mem Proj', description: '', workflow_url: '' });
      const uid = Users.create({ username: 'u_mem', password: 'pass', role_id: 2 });
      Projects.setMembers(pid, [uid]);
      const members = Projects.getMembers(pid);
      expect(members.find((m) => m.id === uid)).toBeTruthy();
    });

    it('setMembers replaces active user assignments', () => {
      const pid = Projects.create({ name: 'Mem Proj2', description: '', workflow_url: '' });
      const uid1 = Users.create({ username: 'u_mem1', password: 'pass', role_id: 2 });
      const uid2 = Users.create({ username: 'u_mem2', password: 'pass', role_id: 2 });
      Projects.setMembers(pid, [uid1, uid2]);
      Projects.setMembers(pid, [uid2]);
      const ids = Projects.getMembers(pid).map((m) => m.id);
      expect(ids).toContain(uid2);
    });
  });

  describe('assignAllUsers', () => {
    it('assigns every active user to a project', () => {
      const pid = Projects.create({ name: 'AllUsers', description: '', workflow_url: '' });
      Projects.assignAllUsers(pid);
      const members = Projects.getMembers(pid);
      expect(members.length).toBeGreaterThan(0);
    });
  });

  describe('createN8NUser', () => {
    it('creates an inactive placeholder user', () => {
      const uid = Projects.createN8NUser({ username: 'n8nonly1', full_name: 'N8N', email: 'n8nonly1@t.com' });
      expect(uid).toBeGreaterThan(0);
      expect(Users.getById(uid).is_active).toBe(0);
    });

    it('returns existing id on duplicate username', () => {
      Projects.createN8NUser({ username: 'n8ndup', full_name: 'Dup', email: 'dup@t.com' });
      const uid2 = Projects.createN8NUser({ username: 'n8ndup', full_name: 'Dup2', email: 'dup2@t.com' });
      expect(uid2).toBeGreaterThan(0);
    });
  });

  describe('assignUserToProject', () => {
    it('creates a user-project link', () => {
      const pid = Projects.create({ name: 'Assign Proj', description: '', workflow_url: '' });
      const uid = Users.create({ username: 'u_assign', password: 'pass', role_id: 2 });
      Projects.assignUserToProject(uid, pid);
      const members = Projects.getMembers(pid);
      expect(members.find((m) => m.id === uid)).toBeTruthy();
    });

    it('is idempotent (INSERT OR IGNORE)', () => {
      const pid = Projects.create({ name: 'Idem Proj', description: '', workflow_url: '' });
      const uid = Users.create({ username: 'u_idem', password: 'pass', role_id: 2 });
      expect(() => {
        Projects.assignUserToProject(uid, pid);
        Projects.assignUserToProject(uid, pid);
      }).not.toThrow();
    });
  });
});

// ─── Workspaces ───────────────────────────────────────────────────────────────

describe('Workspaces', () => {
  describe('create / getById / getAll', () => {
    it('creates and retrieves a workspace', () => {
      const id = Workspaces.create({ name: 'WS Test', workflow_id: 'WFTEST001', description: 'desc' });
      expect(id).toBeGreaterThan(0);
      const ws = Workspaces.getById(id);
      expect(ws.name).toBe('WS Test');
      expect(ws.workflow_id).toBe('WFTEST001');
    });

    it('uses workflow_id as name when name is empty', () => {
      const id = Workspaces.create({ name: '', workflow_id: 'WFNONAME', description: '' });
      const ws = Workspaces.getById(id);
      expect(ws.name).toBe('WFNONAME');
    });

    it('getAll returns array', () => {
      expect(Array.isArray(Workspaces.getAll())).toBe(true);
    });

    it('getById returns undefined for unknown id', () => {
      expect(Workspaces.getById(99999)).toBeUndefined();
    });
  });

  describe('getByWorkflowId', () => {
    it('retrieves workspace by workflow_id', () => {
      Workspaces.create({ name: 'WS2', workflow_id: 'WFUNIQ88', description: '' });
      expect(Workspaces.getByWorkflowId('WFUNIQ88')).toBeTruthy();
    });

    it('returns undefined for unknown workflow_id', () => {
      expect(Workspaces.getByWorkflowId('NONEXISTENT')).toBeUndefined();
    });
  });

  describe('update', () => {
    it('updates workspace fields', () => {
      const id = Workspaces.create({ name: 'Old WS', workflow_id: 'WFUPD01', description: '' });
      Workspaces.update(id, { name: 'New WS', workflow_id: 'WFUPD01', description: 'Updated', is_active: 1 });
      expect(Workspaces.getById(id).name).toBe('New WS');
    });
  });

  describe('delete', () => {
    it('removes workspace', () => {
      const id = Workspaces.create({ name: 'Del WS', workflow_id: 'WFDEL99', description: '' });
      Workspaces.delete(id);
      expect(Workspaces.getById(id)).toBeUndefined();
    });
  });
});

// ─── SsoConfig ────────────────────────────────────────────────────────────────

describe('SsoConfig', () => {
  it('get returns default object when no row exists', () => {
    const cfg = SsoConfig.get();
    expect(cfg).toMatchObject({ enabled: 0, show_login_button: 1, provider: 'custom_oidc', client_id: '', tenant_id: '' });
  });

  it('save and get round-trip (azure)', () => {
    SsoConfig.save({
      enabled: true,
      show_login_button: true,
      provider: 'azure',
      client_id: 'client-1',
      client_secret: 'secret-1',
      tenant_id: 'tenant-1',
      issuer_url: '',
      app_url: 'http://localhost:3000',
    });
    const cfg = SsoConfig.get();
    expect(cfg.enabled).toBe(1);
    expect(cfg.show_login_button).toBe(1);
    expect(cfg.client_id).toBe('client-1');
    expect(cfg.tenant_id).toBe('tenant-1');
    expect(cfg.app_url).toBe('http://localhost:3000');
  });

  it('save overwrites existing row (okta)', () => {
    SsoConfig.save({
      enabled: true,
      show_login_button: false,
      provider: 'okta',
      client_id: 'okta-id',
      client_secret: 'okta-sec',
      tenant_id: '',
      issuer_url: '',
      app_url: '',
    });
    const cfg = SsoConfig.get();
    expect(cfg.enabled).toBe(1);
    expect(cfg.show_login_button).toBe(0);
    expect(cfg.provider).toBe('okta');
    expect(cfg.client_id).toBe('okta-id');
  });

  it('save custom_oidc config (keycloak, authentik, etc)', () => {
    SsoConfig.save({
      enabled: true,
      show_login_button: true,
      provider: 'custom_oidc',
      client_id: 'custom-client',
      client_secret: 'custom-secret',
      tenant_id: '',
      issuer_url: 'https://keycloak.example.com/realms/master',
      app_url: 'http://localhost:3000',
    });
    const cfg = SsoConfig.get();
    expect(cfg.provider).toBe('custom_oidc');
    expect(cfg.issuer_url).toBe('https://keycloak.example.com/realms/master');
  });
});
