#!/usr/bin/env bash

# ============================================================
# Quick Setup — install ai-coding-ssh locally
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

INSTALL_DIR="${HOME}/.ai-coding-ssh"
BIN_DIR="${HOME}/.local/bin"

echo -e "${CYAN}Installing ai-coding-ssh...${NC}"
echo ""

# Copy files
mkdir -p "$INSTALL_DIR"/{bin,lib}
mkdir -p "$BIN_DIR"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/lib/proxy.mjs" "$INSTALL_DIR/lib/"
cp "$SCRIPT_DIR/bin/ai-coding-ssh" "$INSTALL_DIR/bin/"
cp "$SCRIPT_DIR/bin/ai-coding-ssh-install-remote" "$INSTALL_DIR/bin/"
cp "$SCRIPT_DIR/package.json" "$INSTALL_DIR/"

chmod +x "$INSTALL_DIR/bin/ai-coding-ssh"
chmod +x "$INSTALL_DIR/bin/ai-coding-ssh-install-remote"

# Fix LIB_DIR path in scripts to use installed location
sed -i.bak "s|LIB_DIR=.*|LIB_DIR=\"$INSTALL_DIR/lib\"|" "$INSTALL_DIR/bin/ai-coding-ssh" && rm -f "$INSTALL_DIR/bin/ai-coding-ssh.bak"

# Create symlinks
ln -sf "$INSTALL_DIR/bin/ai-coding-ssh" "$BIN_DIR/ai-coding-ssh"
ln -sf "$INSTALL_DIR/bin/ai-coding-ssh-install-remote" "$BIN_DIR/ai-coding-ssh-install-remote"

echo -e "${GREEN}[✓]${NC} Installed to $INSTALL_DIR"
echo -e "${GREEN}[✓]${NC} Symlinked to $BIN_DIR"

# Check PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo ""
  echo -e "Add this to your shell profile (.zshrc / .bashrc):"
  echo ""
  echo -e "  ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
  echo ""
fi

echo ""
echo -e "Usage:"
echo -e "  ${CYAN}ai-coding-ssh user@remote-server${NC}"
echo ""
echo -e "First time? Install Claude Code on the remote server:"
echo -e "  ${CYAN}ai-coding-ssh --install-remote user@remote-server${NC}"
echo ""
echo "Done!"
