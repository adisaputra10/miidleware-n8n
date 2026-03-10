'use strict';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent reads
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Runtime migrations (add new columns if upgrading existing DB) ──────────
try { db.exec(`ALTER TABLE projects ADD COLUMN n8n_login_email TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE projects ADD COLUMN n8n_login_password TEXT NOT NULL DEFAULT ''`); } catch {}

// SSO config migration for show_login_button
try { db.exec(`ALTER TABLE sso_config ADD COLUMN show_login_button INTEGER NOT NULL DEFAULT 1`); } catch {}

// SSO config migration for per-provider enabled flags
try { db.exec(`ALTER TABLE sso_config ADD COLUMN azure_enabled INTEGER NOT NULL DEFAULT 1`); } catch {}
try { db.exec(`ALTER TABLE sso_config ADD COLUMN google_enabled INTEGER NOT NULL DEFAULT 1`); } catch {}
try { db.exec(`ALTER TABLE sso_config ADD COLUMN github_enabled INTEGER NOT NULL DEFAULT 1`); } catch {}
try { db.exec(`ALTER TABLE sso_config ADD COLUMN okta_enabled INTEGER NOT NULL DEFAULT 1`); } catch {}
try { db.exec(`ALTER TABLE sso_config ADD COLUMN custom_oidc_enabled INTEGER NOT NULL DEFAULT 1`); } catch {}
try {
  db.exec(`
    INSERT OR IGNORE INTO user_projects (user_id, project_id)
    SELECT u.id, p.id FROM users u CROSS JOIN projects p
    WHERE u.is_active = 1 AND p.is_active = 1
  `);
} catch {}

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL UNIQUE,
    label     TEXT    NOT NULL,
    created_at TEXT   NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT    NOT NULL UNIQUE,
    password   TEXT    NOT NULL,
    full_name  TEXT    NOT NULL DEFAULT '',
    email      TEXT    NOT NULL DEFAULT '',
    role_id    INTEGER NOT NULL DEFAULT 2,
    is_active  INTEGER NOT NULL DEFAULT 1,
    created_at TEXT   NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT   NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (role_id) REFERENCES roles(id)
  );

  CREATE TABLE IF NOT EXISTS projects (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT    NOT NULL,
    description        TEXT    NOT NULL DEFAULT '',
    workflow_url       TEXT    NOT NULL DEFAULT '',
    n8n_project_id     TEXT    NOT NULL DEFAULT '',
    n8n_login_email    TEXT    NOT NULL DEFAULT '',
    n8n_login_password TEXT    NOT NULL DEFAULT '',
    is_active          INTEGER NOT NULL DEFAULT 1,
    created_at         TEXT   NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT   NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_projects (
    user_id    INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, project_id),
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL DEFAULT '',
    workflow_id  TEXT    NOT NULL UNIQUE,
    description  TEXT    NOT NULL DEFAULT '',
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sso_config (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    enabled             INTEGER NOT NULL DEFAULT 0,
    show_login_button   INTEGER NOT NULL DEFAULT 1,
    provider            TEXT    NOT NULL DEFAULT 'custom_oidc',
    client_id           TEXT    NOT NULL DEFAULT '',
    client_secret       TEXT    NOT NULL DEFAULT '',
    tenant_id           TEXT    NOT NULL DEFAULT '',
    issuer_url          TEXT    NOT NULL DEFAULT '',
    app_url             TEXT    NOT NULL DEFAULT '',
    azure_enabled       INTEGER NOT NULL DEFAULT 1,
    google_enabled      INTEGER NOT NULL DEFAULT 1,
    github_enabled      INTEGER NOT NULL DEFAULT 1,
    okta_enabled        INTEGER NOT NULL DEFAULT 1,
    custom_oidc_enabled INTEGER NOT NULL DEFAULT 1,
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Seed default roles ───────────────────────────────────────────────────────
const seedRoles = db.prepare(
  `INSERT OR IGNORE INTO roles (name, label) VALUES (?, ?)`
);
[
  ['admin',  'Administrator'],
  ['editor', 'Editor'],
  ['viewer', 'Viewer'],
].forEach(([name, label]) => seedRoles.run(name, label));

// ─── Seed default admin user ──────────────────────────────────────────────────
const adminRole = db.prepare(`SELECT id FROM roles WHERE name = 'admin'`).get();
const existingAdmin = db.prepare(`SELECT id FROM users WHERE username = 'admin'`).get();
if (!existingAdmin) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(`
    INSERT INTO users (username, password, full_name, email, role_id)
    VALUES (?, ?, ?, ?, ?)
  `).run('admin', hash, 'Administrator', 'admin@local', adminRole.id);
  console.log('✓ Seeded default admin user (admin / admin123)');
}

// ─── Helpers (all return Promises for unified interface) ──────────────────────
const Users = {
  async getAll() {
    return db.prepare(`
      SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.created_at,
             r.name AS role_name, r.label AS role_label
      FROM users u JOIN roles r ON r.id = u.role_id
      ORDER BY u.id
    `).all();
  },
  async getById(id) {
    return db.prepare(`
      SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.role_id,
             r.name AS role_name, r.label AS role_label
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?
    `).get(id);
  },
  async getByUsername(username) {
    return db.prepare(`
      SELECT u.*, r.name AS role_name
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.username = ?
    `).get(username);
  },
  async getByEmail(email) {
    return db.prepare(`
      SELECT u.*, r.name AS role_name
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE lower(u.email) = lower(?) AND u.is_active = 1
    `).get(email);
  },
  async create({ username, password, full_name, email, role_id }) {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare(`
      INSERT INTO users (username, password, full_name, email, role_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, hash, full_name || '', email || '', role_id);
    return info.lastInsertRowid;
  },
  async update(id, { full_name, email, role_id, is_active, password }) {
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      db.prepare(`
        UPDATE users SET full_name=?, email=?, role_id=?, is_active=?, password=?,
        updated_at=datetime('now') WHERE id=?
      `).run(full_name, email, role_id, is_active, hash, id);
    } else {
      db.prepare(`
        UPDATE users SET full_name=?, email=?, role_id=?, is_active=?,
        updated_at=datetime('now') WHERE id=?
      `).run(full_name, email, role_id, is_active, id);
    }
  },
  async delete(id) {
    db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  },
  async verifyPassword(username, password) {
    const user = db.prepare(`
      SELECT u.*, r.name AS role_name
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.username = ?
    `).get(username);
    if (!user || !user.is_active) return null;
    return bcrypt.compareSync(password, user.password) ? user : null;
  },
  async getProjects(userId) {
    return db.prepare(`
      SELECT p.* FROM projects p
      JOIN user_projects up ON up.project_id = p.id
      WHERE up.user_id = ?
    `).all(userId);
  },
  async setProjects(userId, projectIds) {
    const del = db.prepare(`DELETE FROM user_projects WHERE user_id = ?`);
    const ins = db.prepare(`INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)`);
    const tx = db.transaction((ids) => {
      del.run(userId);
      ids.forEach((pid) => ins.run(userId, pid));
    });
    tx(projectIds);
  },
  async assignToAllProjects(userId) {
    const projects = db.prepare(`SELECT id FROM projects WHERE is_active = 1`).all();
    const ins = db.prepare(`INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)`);
    const tx = db.transaction(() => projects.forEach(p => ins.run(userId, p.id)));
    tx();
  },
};

const Roles = {
  async getAll() {
    return db.prepare(`SELECT * FROM roles ORDER BY id`).all();
  },
};

const Projects = {
  async getAll() {
    return db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM user_projects up WHERE up.project_id = p.id) AS member_count
      FROM projects p ORDER BY p.id
    `).all();
  },
  async getById(id) {
    return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
  },
  async create({ name, description, workflow_url, n8n_project_id }) {
    const info = db.prepare(`
      INSERT INTO projects (name, description, workflow_url, n8n_project_id)
      VALUES (?, ?, ?, ?)
    `).run(name, description || '', workflow_url || '', n8n_project_id || '');
    return info.lastInsertRowid;
  },
  async setN8NProjectId(id, n8n_project_id) {
    db.prepare(`UPDATE projects SET n8n_project_id=?, updated_at=datetime('now') WHERE id=?`)
      .run(n8n_project_id, id);
  },
  async setN8NCredentials(id, email, password) {
    db.prepare(`UPDATE projects SET n8n_login_email=?, n8n_login_password=?, updated_at=datetime('now') WHERE id=?`)
      .run(email, password, id);
  },
  async getByN8NProjectId(n8n_project_id) {
    return db.prepare(`SELECT * FROM projects WHERE n8n_project_id = ?`).get(n8n_project_id);
  },
  async update(id, { name, description, workflow_url, is_active }) {
    db.prepare(`
      UPDATE projects SET name=?, description=?, workflow_url=?, is_active=?,
      updated_at=datetime('now') WHERE id=?
    `).run(name, description || '', workflow_url || '', is_active, id);
  },
  async delete(id) {
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  },
  async getMembers(projectId) {
    return db.prepare(`
      SELECT u.id, u.username, u.full_name, u.email, r.label AS role_label, u.is_active
      FROM users u
      JOIN user_projects up ON up.user_id = u.id
      JOIN roles r ON r.id = u.role_id
      WHERE up.project_id = ?
    `).all(projectId);
  },
  async setMembers(projectId, userIds) {
    const del = db.prepare(`DELETE FROM user_projects WHERE project_id = ? AND user_id IN (SELECT id FROM users WHERE is_active = 1)`);
    const ins = db.prepare(`INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)`);
    const tx = db.transaction(() => {
      del.run(projectId);
      userIds.forEach(uid => ins.run(uid, projectId));
    });
    tx();
  },
  async assignAllUsers(projectId) {
    const users = db.prepare(`SELECT id FROM users WHERE is_active = 1`).all();
    const ins = db.prepare(`INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)`);
    const tx = db.transaction(() => users.forEach(u => ins.run(u.id, projectId)));
    tx();
  },
  async createN8NUser({ username, full_name, email }) {
    const placeholder = Math.random().toString(36);
    try {
      const info = db.prepare(`
        INSERT INTO users (username, password, full_name, email, role_id, is_active)
        VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE name='viewer'), 0)
      `).run(username, placeholder, full_name || '', email || '');
      return info.lastInsertRowid;
    } catch {
      return db.prepare(`SELECT id FROM users WHERE username = ?`).get(username)?.id ?? null;
    }
  },
  async assignUserToProject(userId, projectId) {
    db.prepare(`INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)`).run(userId, projectId);
  },
};

// ─── Seed default workspaces ─────────────────────────────────────────────────
const seedWs = db.prepare(`INSERT OR IGNORE INTO workspaces (name, workflow_id) VALUES (?, ?)`);
[
  ['Build your first AI agent', 'KObZZBvO7UjRlWIA'],
  ['Workflow HgRB1p4cnDcFWcez',  'HgRB1p4cnDcFWcez'],
  ['Workflow ViqHs2Nuopz2ngYw',  'ViqHs2Nuopz2ngYw'],
].forEach(([name, id]) => seedWs.run(name, id));

const Workspaces = {
  async getAll() {
    return db.prepare(`SELECT * FROM workspaces ORDER BY id`).all();
  },
  async getById(id) {
    return db.prepare(`SELECT * FROM workspaces WHERE id = ?`).get(id);
  },
  async getByWorkflowId(workflowId) {
    return db.prepare(`SELECT * FROM workspaces WHERE workflow_id = ?`).get(workflowId);
  },
  async create({ name, workflow_id, description }) {
    const info = db.prepare(
      `INSERT INTO workspaces (name, workflow_id, description) VALUES (?, ?, ?)`
    ).run(name || workflow_id, workflow_id, description || '');
    return info.lastInsertRowid;
  },
  async update(id, { name, workflow_id, description, is_active }) {
    db.prepare(
      `UPDATE workspaces SET name=?, workflow_id=?, description=?, is_active=?,
       updated_at=datetime('now') WHERE id=?`
    ).run(name, workflow_id, description || '', is_active, id);
  },
  async delete(id) {
    db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
  },
};

const SsoConfig = {
  async get() {
    return db.prepare(`SELECT * FROM sso_config WHERE id = 1`).get() || {
      id: 1, enabled: 0, show_login_button: 1, provider: 'custom_oidc',
      client_id: '', client_secret: '', tenant_id: '', issuer_url: '', app_url: '',
      azure_enabled: 1, google_enabled: 1, github_enabled: 1, okta_enabled: 1, custom_oidc_enabled: 1,
    };
  },
  async save({ enabled, show_login_button, provider, client_id, client_secret, tenant_id, issuer_url, app_url, azure_enabled, google_enabled, github_enabled, okta_enabled, custom_oidc_enabled }) {
    db.prepare(`
      INSERT INTO sso_config (id, enabled, show_login_button, provider, client_id, client_secret, tenant_id, issuer_url, app_url, azure_enabled, google_enabled, github_enabled, okta_enabled, custom_oidc_enabled, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        enabled=excluded.enabled, show_login_button=excluded.show_login_button, provider=excluded.provider,
        client_id=excluded.client_id, client_secret=excluded.client_secret,
        tenant_id=excluded.tenant_id, issuer_url=excluded.issuer_url, app_url=excluded.app_url,
        azure_enabled=excluded.azure_enabled, google_enabled=excluded.google_enabled,
        github_enabled=excluded.github_enabled, okta_enabled=excluded.okta_enabled,
        custom_oidc_enabled=excluded.custom_oidc_enabled, updated_at=excluded.updated_at
    `).run(enabled ? 1 : 0, show_login_button ? 1 : 0, provider, client_id, client_secret, tenant_id, issuer_url, app_url, azure_enabled ? 1 : 0, google_enabled ? 1 : 0, github_enabled ? 1 : 0, okta_enabled ? 1 : 0, custom_oidc_enabled ? 1 : 0);
  },
};

module.exports = { db, Users, Roles, Projects, Workspaces, SsoConfig };
