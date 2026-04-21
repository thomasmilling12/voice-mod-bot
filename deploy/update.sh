#!/usr/bin/env bash
# ============================================================
# Voice Mod Bot — Update Script for Raspberry Pi 5
# Run after each git pull to rebuild and restart the bot.
# Usage: bash deploy/update.sh
#    or: git pull && bash deploy/update.sh
# ============================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="discord-bot"

echo "==> Pulling latest changes from GitHub..."
cd "$REPO_DIR"
git pull --ff-only

NODE_VERSION=$(node -p "process.versions.node")
NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
NODE_MINOR=$(node -p "Number(process.versions.node.split('.')[1])")
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 12 ]; }; then
  echo ""
  echo "ERROR: This bot now needs Node.js 22.12+ for the current Discord voice library."
  echo "Current Node.js version: v$NODE_VERSION"
  echo ""
  echo "Install Node 22 on the Pi, then rerun:"
  echo "  cd $REPO_DIR && bash deploy/update.sh"
  exit 1
fi

echo "==> Installing / updating npm packages..."
npm install --legacy-peer-deps

echo "==> Rebuilding TypeScript..."
npm run build

echo "==> Pruning dev dependencies..."
npm prune --omit=dev --legacy-peer-deps

echo "==> Restarting $SERVICE_NAME service..."
sudo systemctl restart "$SERVICE_NAME"

# Wait a moment then confirm it's running
sleep 3
STATUS=$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || true)
if [ "$STATUS" = "active" ]; then
  echo ""
  echo "Bot is running. Tail logs with:"
  echo "  sudo journalctl -u $SERVICE_NAME -f"
else
  echo ""
  echo "WARNING: Service may not have started cleanly (status=$STATUS)."
  echo "  sudo journalctl -u $SERVICE_NAME --since '1 min ago'"
fi
