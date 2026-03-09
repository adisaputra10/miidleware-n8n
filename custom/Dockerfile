FROM node:22-alpine

# Install build tools needed for better-sqlite3 native addon
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy application code
COPY server.js server-state.js ./
COPY lib/ ./lib/
COPY routes/ ./routes/
COPY views/ ./views/

# Data directory for SQLite DB (mount a volume here for persistence)
RUN mkdir -p /app/data

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server.js"]
