ARG NODE_VERSION=24.13.1
ARG N8N_VERSION=snapshot

# ── Pre-built image: compiled/ must be prepared locally first ────────────────
# Run before docker build:
#   pnpm build
#   pnpm --filter=n8n --prod --legacy deploy --no-optional compiled
# ─────────────────────────────────────────────────────────────────────────────
FROM n8nio/base:${NODE_VERSION}

ARG N8N_VERSION
ARG N8N_RELEASE_TYPE=dev
ENV NODE_ENV=production
ENV N8N_RELEASE_TYPE=${N8N_RELEASE_TYPE}
ENV SHELL=/bin/sh

WORKDIR /home/node

# Copy pre-built production deployment from local compiled/ directory
COPY compiled /usr/local/lib/node_modules/n8n
COPY docker/images/n8n/docker-entrypoint.sh /

RUN chmod +x /docker-entrypoint.sh && \
    cd /usr/local/lib/node_modules/n8n && \
    find bin -type f | xargs sed -i 's/\r//' && \
    # Fix Windows symlinks: pnpm on Windows creates symlinks with absolute Windows
    # paths (C:/repo/n8n/compiled/...) that are broken inside Linux containers.
    # Rewrite all such symlinks to correct Linux absolute paths.
    find node_modules -type l | while read lnk; do \
        tgt=$(readlink "$lnk"); \
        case "$tgt" in \
            [A-Za-z]:/*) \
                newtgt=$(echo "$tgt" | sed 's|.*compiled/node_modules/|/usr/local/lib/node_modules/n8n/node_modules/|'); \
                ln -snf "$newtgt" "$lnk" ;; \
        esac; \
    done && \
    npm rebuild sqlite3 isolated-vm --update-binary 2>/dev/null || true && \
    ln -s /usr/local/lib/node_modules/n8n/bin/n8n /usr/local/bin/n8n && \
    mkdir -p /home/node/.n8n && \
    chown -R node:node /home/node && \
    rm -rf /root/.npm /tmp/*

# ─────────────────────────────────────────────────────────────────────────────
# Security patches — fix HIGH CVEs found by Trivy scan
# Step 1: Download patched versions to /tmp/patches
# ─────────────────────────────────────────────────────────────────────────────
RUN mkdir -p /tmp/patches && cd /tmp/patches && npm init -y && \
    npm install \
      "@hono/node-server@1.19.10" \
      "express-rate-limit@8.2.2"  \
      "hono@4.12.4"               \
      "minimatch@10.2.3"          \
      "multer@2.1.1"              \
      "tar@7.5.10"                \
      "underscore@1.13.8"         \
      --legacy-peer-deps

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Patch npm's own bundled dependencies
#   /opt/nodejs/node-v24.13.1/lib/node_modules/npm/node_modules/
#   Affected: minimatch@10.2.2 (CVE-2026-27903, CVE-2026-27904)
#             tar@7.5.9        (CVE-2026-29786)
# ─────────────────────────────────────────────────────────────────────────────
RUN NPM_MOD="/opt/nodejs/node-v24.13.1/lib/node_modules/npm/node_modules" && \
    SRC="/tmp/patches/node_modules"                                         && \
    rm -rf  "$NPM_MOD/minimatch" && cp -r "$SRC/minimatch" "$NPM_MOD/minimatch" && \
    rm -rf  "$NPM_MOD/tar"       && cp -r "$SRC/tar"       "$NPM_MOD/tar"

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Patch n8n's pnpm virtual store in-place
#   /usr/local/lib/node_modules/n8n/node_modules/.pnpm/
#   Replace file contents only — store dir names (with old version) stay intact
#   so existing symlinks remain valid.
# ─────────────────────────────────────────────────────────────────────────────
RUN STORE="/usr/local/lib/node_modules/n8n/node_modules/.pnpm" \
 && SRC="/tmp/patches/node_modules" \
 && find "$STORE" -maxdepth 1 -name "@hono+node-server@1.19.9*" -type d \
      -exec sh -c 'rm -rf "$1/node_modules/@hono/node-server" && cp -r "$2/@hono/node-server" "$1/node_modules/@hono/node-server" && echo "[PATCHED] $1"' _ {} "$SRC" \; \
 && find "$STORE" -maxdepth 1 -name "express-rate-limit@8.2.1*" -type d \
      -exec sh -c 'rm -rf "$1/node_modules/express-rate-limit" && cp -r "$2/express-rate-limit" "$1/node_modules/express-rate-limit" && echo "[PATCHED] $1"' _ {} "$SRC" \; \
 && find "$STORE" -maxdepth 1 -name "hono@4.11.10*" -type d \
      -exec sh -c 'rm -rf "$1/node_modules/hono" && cp -r "$2/hono" "$1/node_modules/hono" && echo "[PATCHED] $1"' _ {} "$SRC" \; \
 && find "$STORE" -maxdepth 1 -name "minimatch@10.2.1*" -type d \
      -exec sh -c 'rm -rf "$1/node_modules/minimatch" && cp -r "$2/minimatch" "$1/node_modules/minimatch" && echo "[PATCHED] $1"' _ {} "$SRC" \; \
 && find "$STORE" -maxdepth 1 -name "multer@2.0.2*" -type d \
      -exec sh -c 'rm -rf "$1/node_modules/multer" && cp -r "$2/multer" "$1/node_modules/multer" && echo "[PATCHED] $1"' _ {} "$SRC" \; \
 && find "$STORE" -maxdepth 1 -name "tar@7.5.9*" -type d \
      -exec sh -c 'rm -rf "$1/node_modules/tar" && cp -r "$2/tar" "$1/node_modules/tar" && echo "[PATCHED] $1"' _ {} "$SRC" \; \
 && find "$STORE" -maxdepth 1 -name "underscore@1.13.6*" -type d \
      -exec sh -c 'rm -rf "$1/node_modules/underscore" && cp -r "$2/underscore" "$1/node_modules/underscore" && echo "[PATCHED] $1"' _ {} "$SRC" \;

# ─────────────────────────────────────────────────────────────────────────────
# Cleanup temporary patching workspace
# ─────────────────────────────────────────────────────────────────────────────
RUN rm -rf /tmp/patches

EXPOSE 5678/tcp
USER node
ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]

LABEL org.opencontainers.image.title="n8n" \
      org.opencontainers.image.description="Workflow Automation Tool" \
      org.opencontainers.image.source="https://github.com/n8n-io/n8n" \
      org.opencontainers.image.url="https://n8n.io" \
      org.opencontainers.image.version=${N8N_VERSION}
