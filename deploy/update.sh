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

echo "==> Installing / updating npm packages..."
npm install

echo "==> Rebuilding TypeScript..."
npm run build

echo "==> Pruning dev dependencies..."
npm prune --omit=dev

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
