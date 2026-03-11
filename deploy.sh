#!/bin/bash
# ── BNBClaw Deploy Script (OpenClaw Plugin Mode) ─────────
# Run on a fresh Ubuntu 22.04+ Compute Engine VM.
# Usage: bash deploy.sh
#
# Prerequisites:
#   - .env file with Binance API keys in the project root
#   - OpenClaw onboarded (openclaw onboard)

set -euo pipefail

APP_DIR="$HOME/bnbclaw"

echo "🦞 BNBClaw Deploy (OpenClaw Plugin)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Install Node.js 22 ────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node: $(node --version)"

# ── 2. Install build tools for native modules ────────────
sudo apt-get install -y python3 make g++ 2>/dev/null || true

# ── 3. Install pm2 + OpenClaw ────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo "Installing pm2..."
  sudo npm install -g pm2
fi

if ! command -v openclaw &>/dev/null; then
  echo "Installing OpenClaw..."
  sudo npm install -g openclaw@latest
fi

# ── 4. Build project ─────────────────────────────────────
cd "$APP_DIR"

echo "Installing dependencies..."
npm ci

echo "Building..."
npm run build

# ── 5. Run tests ─────────────────────────────────────────
echo "Running tests..."
npx vitest run

# ── 6. Onboard if needed ─────────────────────────────────
if [ ! -f "$HOME/.openclaw/config.json" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "First time setup — run: openclaw onboard"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

# ── 7. Start gateway via pm2 ─────────────────────────────
pm2 delete bnbclaw 2>/dev/null || true
pm2 start "openclaw gateway" --name bnbclaw --cwd "$APP_DIR"

# ── 8. Auto-restart on reboot ────────────────────────────
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ BNBClaw deployed!"
echo ""
echo "Useful commands:"
echo "  pm2 logs bnbclaw        — view logs"
echo "  pm2 restart bnbclaw     — restart after updates"
echo "  pm2 stop bnbclaw        — stop"
echo "  pm2 status              — overview"
echo "  openclaw gateway stop   — stop gateway directly"
echo ""
echo "Update workflow:"
echo "  git pull && npm ci && npm run build && pm2 restart bnbclaw"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
