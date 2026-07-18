#!/bin/bash
# Post-installation script for Fedora System Control
# Copies .desktop file and enables autostart

set -e

DESKTOP_FILE="fedora-system-control.desktop"
AUTOSTART_DIR="$HOME/.config/autostart"

echo "Setting up Fedora System Control autostart..."

mkdir -p "$AUTOSTART_DIR"

# Copy desktop file to autostart dir
cp "$DESKTOP_FILE" "$AUTOSTART_DIR/"

# Also copy to local applications for app menu
mkdir -p "$HOME/.local/share/applications"
cp "$DESKTOP_FILE" "$HOME/.local/share/applications/"

echo "Autostart enabled. The app will launch 5 seconds after login."
echo "To disable: rm $AUTOSTART_DIR/$DESKTOP_FILE"
