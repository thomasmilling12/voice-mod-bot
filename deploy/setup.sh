#!/usr/bin/env bash
# ============================================================
# Voice Mod Bot — Initial Setup for Raspberry Pi 5
# Run once after cloning the repo.
# Usage: bash deploy/setup.sh
# ============================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOT_USER="${SUDO_USER:-pi}"
SERVICE_NAME="discord-bot"
SERVICE_FILE="$REPO_DIR/deploy/discord-bot.service"
INSTALL_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

echo "==> Bot directory: $REPO_DIR"
echo "==> Running as user: $BOT_USER"

# ---- 1. Check Node.js ----
if ! command -v node &>/dev/null; then
  echo "Node.js not found. Installing via NodeSource (Node 20 LTS)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node.js: $(node --version)"

# ---- 2. Check ffmpeg ----
if ! command -v ffmpeg &>/dev/null; then
  echo "Installing ffmpeg..."
  apt-get install -y ffmpeg
fi
echo "ffmpeg: $(ffmpeg -version 2>&1 | head -1)"

# ---- 3. Install npm dependencies ----
echo "==> Installing npm packages..."
cd "$REPO_DIR"
npm install --legacy-peer-deps

# ---- 4. Build TypeScript ----
echo "==> Building TypeScript..."
npm run build
npm prune --omit=dev --legacy-peer-deps

# ---- 5. Create .env if missing ----
if [ ! -f "$REPO_DIR/.env" ]; then
  echo "==> Creating .env from template..."
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
  echo ""
  echo "  ACTION REQUIRED: Edit .env and set your DISCORD_BOT_TOKEN"
  echo "  Run: nano $REPO_DIR/.env"
  echo ""
fi

# ---- 6. Create recordings directory ----
mkdir -p "$REPO_DIR/recordings"
chown -R "$BOT_USER":"$BOT_USER" "$REPO_DIR/recordings"

# ---- 7. Patch service file with actual path and user, install it ----
echo "==> Installing systemd service..."
sed \
  -e "s|/home/pi/voice-mod-bot|$REPO_DIR|g" \
  -e "s|User=pi|User=$BOT_USER|g" \
  "$SERVICE_FILE" > "$INSTALL_PATH"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo ""
echo "====================================================="
echo " Setup complete!"
echo "====================================================="
echo " Next steps:"
echo "   1. Set your token:  nano $REPO_DIR/.env"
echo "   2. Start the bot:   sudo systemctl start $SERVICE_NAME"
echo "   3. Check logs:      sudo journalctl -u $SERVICE_NAME -f"
echo "====================================================="
