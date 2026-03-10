# ── BNBClaw Docker Image ─────────────────────────────────
# Supports both standalone mode (npm start) and OpenClaw plugin mode.
#
# Build:   docker build -t bnbclaw .
# Run:     docker run -d --name bnbclaw --env-file .env --restart unless-stopped bnbclaw
# Plugin:  docker run -d --name bnbclaw --env-file .env bnbclaw openclaw gateway

FROM node:22-slim

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
COPY openclaw.config.json ./
COPY schema.sql ./
RUN npm run build

# Install OpenClaw globally for plugin mode
RUN npm install -g openclaw@latest 2>/dev/null || echo "OpenClaw install skipped — use standalone mode"

# Default: standalone mode
CMD ["node", "dist/index.js"]
