#!/bin/bash
set -e

# Make sure the script is run with sudo/root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (using sudo)"
  exit 1
fi

echo "Installing Purrdora privileged helper and Polkit policies..."

# Resolve script directory before constructing source paths.
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# These are runtime requirements, not optional build tools.
if ! command -v pkexec >/dev/null 2>&1; then
  echo "Error: pkexec was not found. Install polkit first."
  exit 1
fi
if [ ! -x /usr/lib/polkit-1/polkitd ] && [ ! -x /usr/libexec/polkitd ]; then
  echo "Error: polkitd was not found. Install polkit/polkit-libs first."
  exit 1
fi

# Paths
HELPER_SRC="$DIR/../src-tauri/target/release/purrdora-helper"
HELPER_DEST="/usr/libexec/purrdora-helper"
POLICY_SRC="$DIR/com.purrdora.pkexec.policy"
POLICY_DEST="/usr/share/polkit-1/actions/com.purrdora.pkexec.policy"
RULES_SRC="$DIR/99-purrdora.rules"
RULES_DEST="/etc/polkit-1/rules.d/99-purrdora.rules"

cd "$DIR"

install -d -m 0755 /usr/libexec /usr/share/polkit-1/actions /etc/polkit-1/rules.d

# Build helper if needed
if [ ! -f "$HELPER_SRC" ]; then
  echo "Helper binary not built at $HELPER_SRC, compiling first..."
  if command -v cargo &> /dev/null; then
    cargo build --manifest-path "$DIR/../src-tauri/Cargo.toml" --release --bin purrdora-helper
  else
    echo "Error: cargo is not installed. Please build purrdora-helper first."
    exit 1
  fi
fi

# Copy helper binary
echo "Installing helper binary to $HELPER_DEST"
cp "$HELPER_SRC" "$HELPER_DEST"
chmod 755 "$HELPER_DEST"
chown root:root "$HELPER_DEST"

# Copy Polkit policy
echo "Installing Polkit policy to $POLICY_DEST"
cp "$POLICY_SRC" "$POLICY_DEST"
chmod 644 "$POLICY_DEST"
chown root:root "$POLICY_DEST"

# Copy Polkit rules
echo "Installing Polkit rules to $RULES_DEST"
cp "$RULES_SRC" "$RULES_DEST"
chmod 644 "$RULES_DEST"
chown root:root "$RULES_DEST"

echo "Installation complete! Purrdora helper is now configured."
