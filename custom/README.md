# n8n Embed App (Custom)

A lightweight admin dashboard and workflow management system for embedded n8n instances. Built with Node.js (Express), SQLite, and Vue.js frontend templates.

---

## 📋 Table of Contents

1. [Features](#features)
2. [Project Structure](#project-structure)
3. [Setup & Installation](#setup--installation)
4. [Environment Variables](#environment-variables)
5. [Running the Application](#running-the-application)
6. [Unit Testing](#unit-testing)
7. [API Endpoints](#api-endpoints)
8. [Docker](#docker)

---

## ✨ Features

### 🔐 Authentication & Authorization
- **Local User Management** — Admin-only Create/Update/Delete user accounts
- **SSO Integration** — Azure Entra ID, Google, GitHub, Okta, Custom OIDC (Keycloak, Authentik, etc) with automatic user provisioning
- **Role-Based Access Control** — Admin, Editor, Viewer roles with endpoint protection
- **Session Management** — Secure session cookies, auto-logout on inactivity

### 👥 User Management
- Create users with auto-generated passwords
- Assign users to projects
- Set user roles (admin, editor, viewer)
- Bulk project assignment (assign all users to a project)
- Deactivate/delete users with permission checks

### 📁 Project Management
- Create/Update/Delete projects
- Link projects to n8n workflows
- Store n8n login credentials per project (encrypted in workflow)
- Assign users to projects
- Auto-create n8n users when inviting via email
- Workflow sharing between n8n users

### 🏢 Workspace Management
- Create isolated workspaces per project
- Link workflows to workspaces
- Fetch live n8n workspace info (execution counts, active workflows)
- Track workflow IDs

### 🤖 n8n Integration
- **OAuth2 Login** — Integrated with n8n's `/rest/login` endpoint
- **User Provisioning** — Auto-create + auto-accept n8n user invitations
- **Workflow Management** — Create, share, delete n8n workflows
- **Project Support** — n8n Enterprise project assignment (when available)
- **API Key Support** — Bearer token auth for n8n API calls

### 📱 Admin Dashboard
- Dashboard view with project/user/workspace summaries
- Settings page for SSO configuration
- User management interface
- Project CRUD interface
- Workspace browser with live info

### 🔐 Supported SSO Providers

The app supports multiple authentication providers via OpenID Connect (OIDC):

| Provider | Setup Required | Best For |
|----------|--------------|----------|
| **Azure Entra ID** | Tenant ID | Microsoft 365, Azure environments |
| **Google** | Google Cloud OAuth | Personal accounts, G Suite |
| **GitHub** | GitHub App OAuth | Developer teams |
| **Okta** | Okta Domain | Enterprise identity management |
| **Custom OIDC** | Issuer URL | Keycloak, Authentik, self-hosted providers |

Each provider requires Client ID and Client Secret from the identity provider's developer console. All providers automatically provision users based on email claim.

**Custom OIDC Supported Providers:**
- **Keycloak** — Open-source identity provider (issuer: `https://keycloak.example.com/realms/master`)
- **Authentik** — Open-source, modern identity provider (https://goauthentik.io/ → issuer: `https://authentik.example.com/application/o/oidc/`)
- **Any OIDC-compliant provider** with discovery endpoint support (`.well-known/openid-configuration`)

---

## 📁 Project Structure

```
custom/
├── server.js                  # Express server entry point, auth middleware, SSO setup
├── server-state.js            # Session cookie & API key management helpers
├── package.json               # Dependencies (express, sqlite3, bcryptjs, axios, dotenv, etc.)
├── jest.config.js             # Jest test runner configuration
├── sonar-project.properties   # SonarQube code quality config
├── Dockerfile                 # Docker image for production deployment
├── .dockerignore               # Docker build exclusions
├── .env                        # Environment variables (check-in safe values only)
├── .env.example               # Template for required env vars
│
├── lib/
│   └── db.js                  # SQLite database schema + helper functions
│                                (Users, Projects, Workspaces, Roles, SsoConfig CRUD)
│
├── routes/
│   ├── projects.js            # Project CRUD + n8n integration routes
│   ├── users.js               # User CRUD + role management routes
│   └── workspaces.js          # Workspace CRUD + n8n info routes
│
├── views/                     # HTML templates (server-side rendered)
│   ├── dashboard.html         # Admin dashboard with project/user/workspace counts
│   ├── login.html             # Login form (password or SSO)
│   ├── settings.html          # SSO configuration form (admin only)
│   ├── projects.html          # Project list + CRUD form
│   ├── users.html             # User list + CRUD form
│   └── workspaces.html        # Workspace browser
│
├── tests/                     # Unit tests (Jest + supertest)
│   ├── db.test.js             # Database CRUD tests (50+ tests)
│   ├── server-state.test.js   # Session/API key tests
│   ├── users.route.test.js    # User endpoint tests (30+ tests)
│   ├── workspaces.route.test.js # Workspace endpoint tests (20+ tests)
│   └── projects.route.test.js # Project endpoint tests (28 tests)
│
├── data/                      # SQLite database (created at runtime)
│   └── app.db                 # Production database file
│
├── coverage/                  # Test coverage reports (generated by npm test)
│   ├── lcov.info              # Coverage in LCOV format (for SonarQube)
│   ├── lcov-report/           # HTML coverage report
│   └── ...
│
└── node_modules/              # Dependencies (gitignored)
```

---

## 🚀 Setup & Installation

### Prerequisites
- **Node.js** 18+ (check: `node --version`)
- **npm** (comes with Node.js)

### 1. Install Dependencies

```bash
cd custom
npm install
```

This installs:
- `express` — Web server
- `better-sqlite3` — Lightweight SQLite database
- `bcryptjs` — Password hashing
- `axios` — HTTP client for n8n API calls
- `dotenv` — Environment variable loading
- **DevDeps:** `jest`, `supertest` for testing

### 2. Create `.env` File

Copy [.env.example](.env.example) and fill in the required values:

```bash
cp .env.example .env
# Then edit .env with your values
```

---

## 🔧 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `N8N_URL` | `http://localhost:5678` | Base URL of n8n instance |
| `N8N_ADMIN_EMAIL` | **REQUIRED** | Admin user email for n8n API calls |
| `N8N_ADMIN_PASSWORD` | **REQUIRED** | Admin user password (set via n8n before running) |
| `N8N_API_KEY` | **REQUIRED** | n8n API key for user provisioning (generate in n8n) |
| `SESSION_SECRET` | dev default | Secret for signing session cookies (change in production) |
| `DB_PATH` | `data/app.db` | Path to SQLite database file |
| `PORT` | `3000` | Port to listen on |
| `NODE_ENV` | `development` | Runtime mode (`development`, `production`) |

### Example `.env`

```env
N8N_URL=http://localhost:5678
N8N_ADMIN_EMAIL=admin@n8n.local
N8N_ADMIN_PASSWORD=StrongPassword123!
N8N_API_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SESSION_SECRET=my-secure-session-secret-32-chars-min
PORT=3000
NODE_ENV=production
```

---

## 🎯 Running the Application

### Start Server (Development)

```bash
node server.js
```

Expected output:
```
App listening on port 3000
✓ Seeded default admin user (admin / admin123)
Connected to n8n at http://localhost:5678
SSO disabled (configure via /app/settings)
```

### Start Server (Production with PM2)

```bash
npm install -g pm2
pm2 start server.js --name "n8n-embed" --env production
pm2 logs n8n-embed
```

### Access the App

- **App URL:** `http://localhost:3000`
- **Login:** 
  - Username: `admin`
  - Password: `admin123` (change immediately in production)

---

## 🧪 Unit Testing

### Run All Tests

```bash
npm test
```

Output includes:
- ✅ **122 tests** (all suites)
- 📊 **Coverage report** (LCOV + HTML)
- ⏱️ **Execution time**

### Run Specific Test File

```bash
npm test -- tests/db.test.js
npm test -- tests/users.route.test.js
```

### Run Tests Without Coverage

```bash
npm test -- --no-coverage
```

### View HTML Coverage Report

After running tests:
```bash
open coverage/lcov-report/index.html
# or on Windows
start coverage/lcov-report/index.html
```

### Coverage Thresholds (SonarQube Configuration)

The project enforces these minimum coverage levels:

| Metric | Threshold | Current |
|--------|-----------|---------|
| Statements | 75% | **83.3%** ✅ |
| Branches | 65% | **67.6%** ✅ |
| Functions | 75% | **89.5%** ✅ |
| Lines | 75% | **84.7%** ✅ |

---

## 📡 API Endpoints

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/login` | None | User login (returns session) |
| POST | `/api/logout` | Session | Logout user |
| GET | `/api/me` | Session | Get current user info |
| GET | `/api/sso-status` | None | Check if SSO is enabled |

### Users (Admin Only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List all users |
| GET | `/api/users/:id` | Get user by ID |
| POST | `/api/users` | Create user (with optional n8n invite) |
| PUT | `/api/users/:id` | Update user (email, password, role, status) |
| DELETE | `/api/users/:id` | Delete user |
| GET | `/api/users/:id/projects` | Get user's assigned projects |
| PUT | `/api/users/:id/projects` | Set user's projects |
| GET | `/api/roles` | Get all available roles |

### Projects (Admin Only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List all projects (or user's if non-admin) |
| GET | `/api/projects/:id` | Get project details |
| POST | `/api/projects` | Create project + create n8n workflow |
| PUT | `/api/projects/:id` | Update project (name, description, workflow URL) |
| DELETE | `/api/projects/:id` | Delete project + n8n workflow |
| POST | `/api/projects/:id/n8n-token` | Get login token for project's n8n user |
| GET | `/api/projects/:id/members` | Get project members |
| PUT | `/api/projects/:id/members` | Set project members |

### Workspaces (Admin Only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces` | List all workspaces |
| GET | `/api/workspaces/:id` | Get workspace details |
| GET | `/api/workspaces/:id/n8n-info` | Get live n8n workspace metrics |
| POST | `/api/workspaces` | Create workspace (with URL validation) |
| PUT | `/api/workspaces/:id` | Update workspace |
| DELETE | `/api/workspaces/:id` | Delete workspace |

### Settings (Admin Only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/sso` | Get current SSO config |
| POST | `/api/settings/sso` | Save SSO config (Azure, OIDC) |

### Pages (Server-Side Rendered)

| Path | Auth | Description |
|------|------|-------------|
| `/app/dashboard` | Session | Admin dashboard |
| `/app/login` | None | Login page |
| `/app/settings` | Admin | SSO settings page |
| `/app/projects` | Admin | Project management |
| `/app/users` | Admin | User management |
| `/app/workspaces` | Admin | Workspace browser |

---

## 🐳 Docker

### Build Docker Image

```bash
docker build -t n8n-embed-app:latest .
```

### Run Container

```bash
docker run -d \
  --name n8n-embed \
  -p 3000:3000 \
  -e N8N_URL=http://host.docker.internal:5678 \
  -e N8N_ADMIN_EMAIL=admin@n8n.local \
  -e N8N_ADMIN_PASSWORD=StrongPassword123! \
  -e N8N_API_KEY=... \
  -e SESSION_SECRET=... \
  -v n8n-embed-data:/app/data \
  n8n-embed-app:latest
```

### Docker Compose (with n8n)

```yaml
version: '3.8'
services:
  n8n:
    image: n8n:latest
    ports:
      - '5678:5678'
    environment:
      - N8N_PROTOCOL=http
      - N8N_HOST=localhost:5678
    volumes:
      - n8n-data:/home/node/.n8n

  custom-app:
    build: ./custom
    ports:
      - '3000:3000'
    depends_on:
      - n8n
    environment:
      - N8N_URL=http://n8n:5678
      - N8N_ADMIN_EMAIL=admin@n8n.local
      - N8N_ADMIN_PASSWORD=...
      - N8N_API_KEY=...
      - SESSION_SECRET=...
    volumes:
      - n8n-embed-data:/app/data

volumes:
  n8n-data:
  n8n-embed-data:
```

---

## 📊 Code Quality (SonarQube)

SonarQube configuration is in [`sonar-project.properties`](sonar-project.properties).

**Run SonarQube analysis:**

```bash
npm test  # Generates coverage/lcov.info
sonar-scanner \
  -Dsonar.projectKey=n8n-embed-app \
  -Dsonar.sources=lib,routes,server-state.js \
  -Dsonar.tests=tests \
  -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info \
  -Dsonar.host.url=http://sonarqube:9000 \
  -Dsonar.login=your-token
```

---

## 🔒 Security Guidelines

### Production Checklist

- [ ] Change default admin password (`admin123`)
- [ ] Generate strong `SESSION_SECRET` (32+ chars)
- [ ] Set `NODE_ENV=production`
- [ ] Use HTTPS (reverse proxy with SSL)
- [ ] Set `.env` variables via secrets manager or environment
- [ ] Enable CORS restrictions if needed
- [ ] Rate-limit login endpoint
- [ ] Audit user access logs
- [ ] Backup SQLite database regularly
- [ ] Update dependencies: `npm audit fix`

### Password Requirements

- Admin password: 8+ chars, mixed case, numbers, special chars
- Generated n8n user passwords: Auto-generated (8 chars + uppercase + 2 digits + `!`)

---

## 🆘 Troubleshooting

### Port 3000 Already in Use

```bash
# Kill process using port 3000
lsof -ti:3000 | xargs kill -9
# or on Windows
Get-NetTCPConnection -LocalPort 3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### n8n Login Fails

**Check:**
1. n8n is running on the configured `N8N_URL`
2. Admin credentials (`N8N_ADMIN_EMAIL`, `N8N_ADMIN_PASSWORD`) are correct
3. n8n version supports `/rest/login` endpoint (v0.165+)
4. Firewall allows connection to n8n

### Tests Fail

```bash
# Clear and reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Run with verbose output
npm test -- --verbose
```

### SQLite Database Locked

SQLite uses file locks. If you see "database is locked":
1. Stop all running processes: `npm test -- --testTimeout=5000`
2. Delete `data/app.db` and restart (data will reset)
3. Check for stale processes: `lsof | grep app.db`

---

## 📚 Additional Resources

- [n8n API Documentation](https://docs.n8n.io/api/)
- [Express.js Guide](https://expressjs.com/)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [Jest Testing Framework](https://jestjs.io/)
- [Axios HTTP Client](https://axios-http.com/)

---

## 📝 License

Part of the n8n project. See [LICENSE.md](../LICENSE.md) in the root directory.

---

## 🤝 Contributing

When adding new features:

1. **Database Schema**: Update `lib/db.js`
2. **API Routes**: Create/update files in `routes/`
3. **UI Template**: Add/update files in `views/`
4. **Tests**: Add unit tests in `tests/` (minimum 75% coverage)
5. **Git**: Follow n8n commit conventions

```bash
# Before committing
npm lint    # Check code style
npm test    # Run all tests with coverage
```
