'use strict';

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// ─── Connection pool ──────────────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  port:     Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE || 'n8n_custom',
  user:     process.env.PG_USER     || 'postgres',
  password: process.env.PG_PASSWORD || '',
  ssl:      process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// ─── Schema ───────────────────────────────────────────────────────────────────
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      label      TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      username   TEXT NOT NULL UNIQUE,
      password   TEXT NOT NULL,
      full_name  TEXT NOT NULL DEFAULT '',
      email      TEXT NOT NULL DEFAULT '',
      role_id    INTEGER NOT NULL DEFAULT 2,
      is_active  INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      FOREIGN KEY (role_id) REFERENCES roles(id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id                 SERIAL PRIMARY KEY,
      name               TEXT NOT NULL,
      description        TEXT NOT NULL DEFAULT '',
      workflow_url       TEXT NOT NULL DEFAULT '',
      n8n_project_id     TEXT NOT NULL DEFAULT '',
      n8n_login_email    TEXT NOT NULL DEFAULT '',
      n8n_login_password TEXT NOT NULL DEFAULT '',
      is_active          INTEGER NOT NULL DEFAULT 1,
      created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_projects (
      user_id    INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, project_id),
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sso_config (
      id                  INTEGER PRIMARY KEY CHECK (id = 1),
      enabled             INTEGER NOT NULL DEFAULT 0,
      show_login_button   INTEGER NOT NULL DEFAULT 1,
      provider            TEXT NOT NULL DEFAULT 'custom_oidc',
      client_id           TEXT NOT NULL DEFAULT '',
      client_secret       TEXT NOT NULL DEFAULT '',
      tenant_id           TEXT NOT NULL DEFAULT '',
      issuer_url          TEXT NOT NULL DEFAULT '',
      app_url             TEXT NOT NULL DEFAULT '',
      azure_enabled       INTEGER NOT NULL DEFAULT 1,
      google_enabled      INTEGER NOT NULL DEFAULT 1,
      github_enabled      INTEGER NOT NULL DEFAULT 1,
      okta_enabled        INTEGER NOT NULL DEFAULT 1,
      custom_oidc_enabled INTEGER NOT NULL DEFAULT 1,
      updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Runtime migrations — add new columns if upgrading existing DB
  const migrations = [
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS n8n_login_email TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS n8n_login_password TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE sso_config ADD COLUMN IF NOT EXISTS show_login_button INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE sso_config ADD COLUMN IF NOT EXISTS azure_enabled INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE sso_config ADD COLUMN IF NOT EXISTS google_enabled INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE sso_config ADD COLUMN IF NOT EXISTS github_enabled INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE sso_config ADD COLUMN IF NOT EXISTS okta_enabled INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE sso_config ADD COLUMN IF NOT EXISTS custom_oidc_enabled INTEGER NOT NULL DEFAULT 1`,
  ];
  for (const sql of migrations) {
    try { await pool.query(sql); } catch { /* column already exists */ }
  }
}

// ─── Seed default roles ───────────────────────────────────────────────────────
async function seedDefaults() {
  const roles = [
    ['admin',  'Administrator'],
    ['editor', 'Editor'],
    ['viewer', 'Viewer'],
  ];
  for (const [name, label] of roles) {
    await pool.query(
      `INSERT INTO roles (name, label) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
      [name, label]
    );
  }

  // Seed default admin user
  const { rows } = await pool.query(`SELECT id FROM users WHERE username = 'admin'`);
  if (rows.length === 0) {
    const adminRole = await pool.query(`SELECT id FROM roles WHERE name = 'admin'`);
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query(
      `INSERT INTO users (username, password, full_name, email, role_id) VALUES ($1, $2, $3, $4, $5)`,
      ['admin', hash, 'Administrator', 'admin@local', adminRole.rows[0].id]
    );
    console.log('✓ Seeded default admin user (admin / admin123)');
  }

  // Seed default workspaces
  const defaultWorkspaces = [
    ['Build your first AI agent', 'KObZZBvO7UjRlWIA'],
    ['Workflow HgRB1p4cnDcFWcez',  'HgRB1p4cnDcFWcez'],
    ['Workflow ViqHs2Nuopz2ngYw',  'ViqHs2Nuopz2ngYw'],
  ];
  for (const [name, workflow_id] of defaultWorkspaces) {
    await pool.query(
      `INSERT INTO workspaces (name, workflow_id) VALUES ($1, $2) ON CONFLICT (workflow_id) DO NOTHING`,
      [name, workflow_id]
    );
  }
}

// Initialize schema and seeds on module load
const ready = (async () => {
  try {
    await initSchema();
    await seedDefaults();
    console.log('✓ PostgreSQL database ready');
  } catch (err) {
    console.error('✗ PostgreSQL init failed:', err.message);
    process.exit(1);
  }
})();

// ─── Users ────────────────────────────────────────────────────────────────────
const Users = {
  async getAll() {
    await ready;
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.created_at,
             r.name AS role_name, r.label AS role_label
      FROM users u JOIN roles r ON r.id = u.role_id
      ORDER BY u.id
    `);
    return rows;
  },
  async getById(id) {
    await ready;
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.role_id,
             r.name AS role_name, r.label AS role_label
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1
    `, [id]);
    return rows[0];
  },
  async getByUsername(username) {
    await ready;
    const { rows } = await pool.query(`
      SELECT u.*, r.name AS role_name
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.username = $1
    `, [username]);
    return rows[0];
  },
  async getByEmail(email) {
    await ready;
    const { rows } = await pool.query(`
      SELECT u.*, r.name AS role_name
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE lower(u.email) = lower($1) AND u.is_active = 1
    `, [email]);
    return rows[0];
  },
  async create({ username, password, full_name, email, role_id }) {
    await ready;
    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await pool.query(`
      INSERT INTO users (username, password, full_name, email, role_id)
      VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [username, hash, full_name || '', email || '', role_id]);
    return rows[0].id;
  },
  async update(id, { full_name, email, role_id, is_active, password }) {
    await ready;
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      await pool.query(`
        UPDATE users SET full_name=$1, email=$2, role_id=$3, is_active=$4, password=$5,
        updated_at=NOW() WHERE id=$6
      `, [full_name, email, role_id, is_active, hash, id]);
    } else {
      await pool.query(`
        UPDATE users SET full_name=$1, email=$2, role_id=$3, is_active=$4,
        updated_at=NOW() WHERE id=$5
      `, [full_name, email, role_id, is_active, id]);
    }
  },
  async delete(id) {
    await ready;
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
  },
  async verifyPassword(username, password) {
    await ready;
    const { rows } = await pool.query(`
      SELECT u.*, r.name AS role_name
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.username = $1
    `, [username]);
    const user = rows[0];
    if (!user || !user.is_active) return null;
    return bcrypt.compareSync(password, user.password) ? user : null;
  },
  async getProjects(userId) {
    await ready;
    const { rows } = await pool.query(`
      SELECT p.* FROM projects p
      JOIN user_projects up ON up.project_id = p.id
      WHERE up.user_id = $1
    `, [userId]);
    return rows;
  },
  async setProjects(userId, projectIds) {
    await ready;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM user_projects WHERE user_id = $1`, [userId]);
      for (const pid of projectIds) {
        await client.query(
          `INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [userId, pid]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
  async assignToAllProjects(userId) {
    await ready;
    const { rows } = await pool.query(`SELECT id FROM projects WHERE is_active = 1`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const p of rows) {
        await client.query(
          `INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [userId, p.id]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

// ─── Roles ────────────────────────────────────────────────────────────────────
const Roles = {
  async getAll() {
    await ready;
    const { rows } = await pool.query(`SELECT * FROM roles ORDER BY id`);
    return rows;
  },
};

// ─── Projects ─────────────────────────────────────────────────────────────────
const Projects = {
  async getAll() {
    await ready;
    const { rows } = await pool.query(`
      SELECT p.*,
        (SELECT COUNT(*) FROM user_projects up WHERE up.project_id = p.id) AS member_count
      FROM projects p ORDER BY p.id
    `);
    return rows;
  },
  async getById(id) {
    await ready;
    const { rows } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [id]);
    return rows[0];
  },
  async create({ name, description, workflow_url, n8n_project_id }) {
    await ready;
    const { rows } = await pool.query(`
      INSERT INTO projects (name, description, workflow_url, n8n_project_id)
      VALUES ($1, $2, $3, $4) RETURNING id
    `, [name, description || '', workflow_url || '', n8n_project_id || '']);
    return rows[0].id;
  },
  async setN8NProjectId(id, n8n_project_id) {
    await ready;
    await pool.query(
      `UPDATE projects SET n8n_project_id=$1, updated_at=NOW() WHERE id=$2`,
      [n8n_project_id, id]
    );
  },
  async setN8NCredentials(id, email, password) {
    await ready;
    await pool.query(
      `UPDATE projects SET n8n_login_email=$1, n8n_login_password=$2, updated_at=NOW() WHERE id=$3`,
      [email, password, id]
    );
  },
  async getByN8NProjectId(n8n_project_id) {
    await ready;
    const { rows } = await pool.query(
      `SELECT * FROM projects WHERE n8n_project_id = $1`,
      [n8n_project_id]
    );
    return rows[0];
  },
  async update(id, { name, description, workflow_url, is_active }) {
    await ready;
    await pool.query(`
      UPDATE projects SET name=$1, description=$2, workflow_url=$3, is_active=$4,
      updated_at=NOW() WHERE id=$5
    `, [name, description || '', workflow_url || '', is_active, id]);
  },
  async delete(id) {
    await ready;
    await pool.query(`DELETE FROM projects WHERE id = $1`, [id]);
  },
  async getMembers(projectId) {
    await ready;
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.full_name, u.email, r.label AS role_label, u.is_active
      FROM users u
      JOIN user_projects up ON up.user_id = u.id
      JOIN roles r ON r.id = u.role_id
      WHERE up.project_id = $1
    `, [projectId]);
    return rows;
  },
  async setMembers(projectId, userIds) {
    await ready;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Delete only active users from project (keep n8n-only users with is_active=0)
      await client.query(`
        DELETE FROM user_projects WHERE project_id = $1
        AND user_id IN (SELECT id FROM users WHERE is_active = 1)
      `, [projectId]);
      for (const uid of userIds) {
        await client.query(
          `INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [uid, projectId]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
  async assignAllUsers(projectId) {
    await ready;
    const { rows } = await pool.query(`SELECT id FROM users WHERE is_active = 1`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const u of rows) {
        await client.query(
          `INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [u.id, projectId]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
  async createN8NUser({ username, full_name, email }) {
    await ready;
    const placeholder = Math.random().toString(36);
    try {
      const viewerRole = await pool.query(`SELECT id FROM roles WHERE name = 'viewer'`);
      const { rows } = await pool.query(`
        INSERT INTO users (username, password, full_name, email, role_id, is_active)
        VALUES ($1, $2, $3, $4, $5, 0) RETURNING id
      `, [username, placeholder, full_name || '', email || '', viewerRole.rows[0].id]);
      return rows[0].id;
    } catch {
      const { rows } = await pool.query(`SELECT id FROM users WHERE username = $1`, [username]);
      return rows[0]?.id ?? null;
    }
  },
  async assignUserToProject(userId, projectId) {
    await ready;
    await pool.query(
      `INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, projectId]
    );
  },
};

// ─── Workspaces ───────────────────────────────────────────────────────────────
const Workspaces = {
  async getAll() {
    await ready;
    const { rows } = await pool.query(`SELECT * FROM workspaces ORDER BY id`);
    return rows;
  },
  async getById(id) {
    await ready;
    const { rows } = await pool.query(`SELECT * FROM workspaces WHERE id = $1`, [id]);
    return rows[0];
  },
  async getByWorkflowId(workflowId) {
    await ready;
    const { rows } = await pool.query(
      `SELECT * FROM workspaces WHERE workflow_id = $1`,
      [workflowId]
    );
    return rows[0];
  },
  async create({ name, workflow_id, description }) {
    await ready;
    const { rows } = await pool.query(
      `INSERT INTO workspaces (name, workflow_id, description) VALUES ($1, $2, $3) RETURNING id`,
      [name || workflow_id, workflow_id, description || '']
    );
    return rows[0].id;
  },
  async update(id, { name, workflow_id, description, is_active }) {
    await ready;
    await pool.query(
      `UPDATE workspaces SET name=$1, workflow_id=$2, description=$3, is_active=$4,
       updated_at=NOW() WHERE id=$5`,
      [name, workflow_id, description || '', is_active, id]
    );
  },
  async delete(id) {
    await ready;
    await pool.query(`DELETE FROM workspaces WHERE id = $1`, [id]);
  },
};

// ─── SsoConfig ────────────────────────────────────────────────────────────────
const SsoConfig = {
  async get() {
    await ready;
    const { rows } = await pool.query(`SELECT * FROM sso_config WHERE id = 1`);
    return rows[0] || {
      id: 1, enabled: 0, show_login_button: 1, provider: 'custom_oidc',
      client_id: '', client_secret: '', tenant_id: '', issuer_url: '', app_url: '',
      azure_enabled: 1, google_enabled: 1, github_enabled: 1, okta_enabled: 1, custom_oidc_enabled: 1,
    };
  },
  async save({ enabled, show_login_button, provider, client_id, client_secret, tenant_id, issuer_url, app_url, azure_enabled, google_enabled, github_enabled, okta_enabled, custom_oidc_enabled }) {
    await ready;
    await pool.query(`
      INSERT INTO sso_config (id, enabled, show_login_button, provider, client_id, client_secret,
        tenant_id, issuer_url, app_url, azure_enabled, google_enabled, github_enabled,
        okta_enabled, custom_oidc_enabled, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      ON CONFLICT (id) DO UPDATE SET
        enabled=$1, show_login_button=$2, provider=$3, client_id=$4, client_secret=$5,
        tenant_id=$6, issuer_url=$7, app_url=$8, azure_enabled=$9, google_enabled=$10,
        github_enabled=$11, okta_enabled=$12, custom_oidc_enabled=$13, updated_at=NOW()
    `, [
      enabled ? 1 : 0, show_login_button ? 1 : 0, provider, client_id, client_secret,
      tenant_id, issuer_url, app_url, azure_enabled ? 1 : 0, google_enabled ? 1 : 0,
      github_enabled ? 1 : 0, okta_enabled ? 1 : 0, custom_oidc_enabled ? 1 : 0,
    ]);
  },
};

module.exports = { pool, Users, Roles, Projects, Workspaces, SsoConfig };
