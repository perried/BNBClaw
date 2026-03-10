#!/bin/bash
# ── BNBClaw VM Deploy Script ─────────────────────────────
# Run this on a fresh Ubuntu 22.04+ Compute Engine VM.
# Usage: bash deploy.sh [standalone|plugin]
#
# Prerequisites:
#   - .env file with your Binance API keys in the project root
#   - Port 3000 open if using TradingView webhooks

set -euo pipefail

MODE="${1:-standalone}"
APP_DIR="$HOME/bnbclaw"

echo "🦞 BNBClaw Deploy — mode: $MODE"
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

# ── 3. Install pm2 for process management ────────────────
if ! command -v pm2 &>/dev/null; then
  echo "Installing pm2..."
  sudo npm install -g pm2
fi

# ── 4. Set up project ────────────────────────────────────
cd "$APP_DIR"

echo "Installing dependencies..."
npm ci

echo "Building..."
npm run build

# ── 5. Run tests ─────────────────────────────────────────
echo "Running tests..."
npx vitest run

# ── 6. Deploy ────────────────────────────────────────────
if [ "$MODE" = "plugin" ]; then
  # Plugin mode: install OpenClaw and start gateway
  echo "Installing OpenClaw..."
  sudo npm install -g openclaw@latest

  # Stop any existing instance
  pm2 delete bnbclaw 2>/dev/null || true

  # Onboard if not done yet
  if [ ! -f "$HOME/.openclaw/config.json" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "First time setup — configure OpenClaw:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    openclaw onboard --install-daemon
  fi

  # Start OpenClaw gateway with pm2
  pm2 start "openclaw gateway --verbose" --name bnbclaw --cwd "$APP_DIR"
  echo "🦞 BNBClaw running in PLUGIN mode via OpenClaw gateway"

else
  # Standalone mode: run with pm2
  pm2 delete bnbclaw 2>/dev/null || true
  pm2 start dist/index.js --name bnbclaw --cwd "$APP_DIR"
  echo "🦞 BNBClaw running in STANDALONE mode"
fi

# ── 7. Auto-restart on reboot ────────────────────────────
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ BNBClaw deployed!"
echo ""
echo "Useful commands:"
echo "  pm2 logs bnbclaw      — view logs"
echo "  pm2 restart bnbclaw   — restart"
echo "  pm2 stop bnbclaw      — stop"
echo "  pm2 monit             — dashboard"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
