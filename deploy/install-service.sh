#!/usr/bin/env bash
# ============================================================
# Voice Mod Bot — Service Installer
# Copies the systemd service file with correct paths for this
# machine. Run this any time the service file changes.
# Usage: sudo bash deploy/install-service.sh
# ============================================================

set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "Please run with sudo: sudo bash deploy/install-service.sh"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOT_USER="${SUDO_USER:-$(logname 2>/dev/null || whoami)}"
SERVICE_NAME="discord-bot"
INSTALL_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

echo "==> Bot directory : $REPO_DIR"
echo "==> Service user  : $BOT_USER"
echo "==> Installing to : $INSTALL_PATH"

sed \
  -e "s|/home/pi/voice-mod-bot|$REPO_DIR|g" \
  -e "s|User=pi|User=$BOT_USER|g" \
  "$REPO_DIR/deploy/discord-bot.service" > "$INSTALL_PATH"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo ""
echo "Done. To apply:"
echo "  sudo systemctl restart $SERVICE_NAME"
echo "  sudo systemctl status  $SERVICE_NAME"
