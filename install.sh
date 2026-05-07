#!/bin/sh
# install.sh — One-line installer for Working Mind (wmind)
# Usage: curl -fsSL https://wmind.ai/install.sh | sh
#        curl -fsSL https://wmind.ai/install.sh | sh -s -- --yes
#        curl -fsSL https://wmind.ai/install.sh | sh -s -- 0.0.1

set -e

VERSION="latest"
YES_MODE=false
INSTALL_DIR="/usr/local/bin"

for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES_MODE=true ;;
    -h|--help)
      echo "Usage: curl -fsSL https://wmind.ai/install.sh | sh [-s -- [options] [version]]"
      echo ""
      echo "Options:"
      echo "  --yes, -y    Skip confirmation prompts"
      echo "  version      Install specific version (default: latest)"
      echo ""
      echo "Examples:"
      echo "  curl -fsSL https://wmind.ai/install.sh | sh"
      echo "  curl -fsSL https://wmind.ai/install.sh | sh -s -- --yes"
      echo "  curl -fsSL https://wmind.ai/install.sh | sh -s -- 0.0.1"
      exit 0
      ;;
    -y|--yes) YES_MODE=true ;;
    latest) ;;
    -*) ;;
    *) VERSION="$arg" ;;
  esac
done

BOLD='\033[1m'
DIM='\033[2m'
RED='\033[31m'
GREEN='\033[32m'
RESET='\033[0m'

info()  { printf "${BOLD}wmind${RESET}  %s\n" "$1"; }
dim()   { printf "${DIM}%s${RESET}\n" "$1"; }
err()   { printf "${RED}error${RESET}  %s\n" "$1" >&2; }
ok()    { printf "${GREEN}ok${RESET}      %s\n" "$1"; }

detect_binary() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS-$ARCH" in
    Darwin-arm64)  echo "wmind-darwin-arm64" ;;
    Darwin-x86_64) echo "wmind-darwin-x64" ;;
    Linux-x86_64)  echo "wmind-linux-x64" ;;
    Linux-aarch64) echo "wmind-linux-arm64" ;;
    MINGW*-x86_64) echo "wmind-windows-x64.exe" ;;
    CYGWIN*-x86_64) echo "wmind-windows-x64.exe" ;;
    *) echo "" ;;
  esac
}

get_version_tag() {
  if [ "$VERSION" = "latest" ]; then
    TAG=$(curl -fsSL https://api.github.com/repos/pawco/working-brain/releases/latest 2>/dev/null | grep '"tag_name"' | sed 's/.*"tag_name": *"v\(.*\)".*/\1/' | head -1)
    if [ -n "$TAG" ]; then
      echo "$TAG"
    else
      echo "0.0.1"
    fi
  else
    echo "$VERSION"
  fi
}

main() {
  printf "\n  ${BOLD}Working Mind${RESET}  ${DIM}v0.0.1 alpha${RESET}\n\n"

  BINARY_NAME=$(detect_binary)

  if [ -z "$BINARY_NAME" ]; then
    err "Unsupported platform: $(uname -s)/$(uname -m)"
    dim "Install via npm instead: npm install -g wmind"
    exit 1
  fi

  ok "Platform: $(uname -s)/$(uname -m)"

  TAG=$(get_version_tag)
  DOWNLOAD_URL="https://github.com/pawco/working-brain/releases/download/v${TAG}/${BINARY_NAME}"

  TARGET="${INSTALL_DIR}/wmind"
  if [ "$BINARY_NAME" = "wmind-windows-x64.exe" ]; then
    TARGET="${INSTALL_DIR}/wmind.exe"
  fi

  if [ -w "$INSTALL_DIR" ] 2>/dev/null; then
    :
  else
    if [ "$YES_MODE" = true ]; then
      TARGET="$HOME/.local/bin/wmind"
      mkdir -p "$HOME/.local/bin"
    else
      printf "  %s is not writable.\n" "$INSTALL_DIR"
      printf "  Install to %s instead? [Y/n] " "$HOME/.local/bin"
      if [ -t 0 ]; then
        read -r answer </dev/tty
      else
        read -r answer
      fi
      case "$answer" in
        n|N|no|No|NO)
          err "Cannot write to install directory. Try: sudo sh install.sh"
          exit 1
          ;;
        *) TARGET="$HOME/.local/bin/wmind" ; mkdir -p "$HOME/.local/bin" ;;
      esac
    fi
  fi

  info "Downloading wmind v${TAG}..."
  curl -fsSL "$DOWNLOAD_URL" -o "$TARGET"
  chmod +x "$TARGET"

  ok "wmind installed to ${TARGET}"

  case ":$PATH:" in
    *":$(dirname "$TARGET"):"*) ;;
    *)
      dim "Add to PATH: export PATH=\"\$(dirname "$TARGET"):\$PATH\""
      ;;
  esac

  printf "\n"
  dim "  Next:  wmind --configure"
  dim "  Docs:  https://docs.workingmind.ai"
  dim "  Alpha: expect breaking changes until v0.1.0"
  printf "\n"
}

main "$@"
