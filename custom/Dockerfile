FROM playcourt/nodejs:22-alpine AS builder
USER root

# Install build tools needed for better-sqlite3 native addon
RUN apk add --no-cache python3 make g++
USER user
WORKDIR /usr/src/app

# Install dependencies first (layer cache)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Final production image ────────────────────────────────────────────────────
FROM playcourt/nodejs:22-alpine
USER root

WORKDIR /usr/src/app

# Copy installed node_modules from builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy application code
COPY server.js server-state.js ./
COPY lib/ ./lib/
COPY routes/ ./routes/
COPY views/ ./views/

# Data directory for SQLite DB (mount a volume here for persistence)
RUN mkdir -p /usr/src/app/data && chown -R 100:65533 /usr/src/app

# Remove npm since runtime only needs node — eliminates npm's bundled
# vulnerable transitive deps (minimatch, tar) from the production image
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /root/.npm
USER user
EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server.js"]
