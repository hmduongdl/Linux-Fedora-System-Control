# Purrdora

System monitoring and control dashboard for Fedora Linux, built with Tauri v2 + React.

<p align="center">
  <img alt="Purrdora Logo" src="./assets/logo.png" width="200">
</p>

## Features

- **System Monitor** — Real-time CPU, RAM, GPU, and network metrics with 1s refresh
- **Audio Mixer** — Per-sink volume slider and mute toggle via PipeWire
- **Media Player** — Now-playing display for any MPRIS-compatible player (Spotify, Firefox, etc.)
- **Power Profiles** — Switch between Power Saver, Balanced, and Performance via UPower D-Bus
- **GameMode** — One-click FeralInteractive GameMode toggle with FPS overlay support (MangoHud)
- **Drop RAM Cache** — Free page cache, dentries, and inodes via pkexec/Polkit
- **Performance History** — Time-series charts for CPU, RAM, GPU, and network
- **Top Processes** — Live process table sorted by resource usage
- **MSI EC Monitor** — Fan speeds, CPU/GPU temperatures from the MSI embedded controller
- **Shutdown Timer** — Schedule system shutdown with a visual countdown
- **Custom Window Frame** — Native-looking title bar with minimize, maximize, and close

## Requirements

- **Fedora Linux** 40+ (Workstation)
- **PipeWire** for audio control
- **UPower PowerProfiles** D-Bus service
- **gamemode** — optional, for GameMode toggle: `sudo dnf install gamemode`
- **MangoHud** — optional, for in-game FPS overlay: `sudo dnf install mangohud`
- **polkit** and **pkexec** — usually pre-installed (`polkit`, `polkit-libs`, `polkit-gnome` or equivalent)

## Quick Start

```bash
pnpm install          # Install dependencies
pnpm tauri:dev        # Run in development mode
pnpm tauri:build      # Build for production
```

Build output: `src-tauri/target/release/bundle/`

### Development Tools

- **Node.js** >= 20 + **pnpm**
- **Rust** >= 1.77
- **Tauri CLI** >= 2.x

## Privileged Access (Polkit Helper)

Hardware monitoring works without elevated privileges. Executing hardware commands (fan modes, shift modes, cooler boost, keyboard backlight, battery limits, power profiles) requires superuser access.

Purrdora uses a dedicated Rust helper (`purrdora-helper`) with **PolicyKit (polkit)** rules for secure, passwordless execution.

```bash
pnpm tauri:build                     # Build first
sudo ./packaging/install.sh          # Install helper + polkit rules
```

What the installer does:
1. Copies `purrdora-helper` to `/usr/libexec/purrdora-helper` (input-whitelisted, memory-safe Rust)
2. Installs Polkit policy: `/usr/share/polkit-1/actions/com.purrdora.pkexec.policy`
3. Installs Polkit rules: `/etc/polkit-1/rules.d/99-purrdora.rules`

> A `pkexec` dialog may appear on first privileged action, or if Polkit is misconfigured. In dev mode, a setup dialog warns when the helper isn't installed.

### Security Design

- **No setuid on Tauri binary** — the GUI runs entirely unprivileged (webview + JS attack surface)
- **Isolated helper** — `/usr/libexec/purrdora-helper` is a hardened Rust binary with a hardcoded whitelist of allowed actions and strict input sanitization
- **Granular Polkit rules** — passwordless auth is restricted to `com.purrdora.*` namespace, local active sessions only; no blanket access to `sudo` or `/usr/bin/tee`

## Tech Stack

| Layer    | Technology |
|----------|------------|
| Frontend | React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Recharts, Framer Motion, Zustand |
| Backend  | Tauri v2, Rust, sysinfo, tokio, zbus |
| Audio    | PipeWire (`wpctl` CLI) |
| D-Bus    | MPRIS, UPower PowerProfiles, GameMode |
| Gaming   | MangoHud FPS monitoring, FeralInteractive GameMode |

## Project Structure

```
├── assets/                          # Logo and static assets
├── packaging/
│   ├── install.sh                   # Polkit helper installer
│   ├── 99-purrdora.rules            # Polkit rules
│   └── com.purrdora.pkexec.policy   # Polkit action policy
├── resources/
│   ├── 99-purrdora.rules
│   ├── fedora-system-control.desktop
│   └── install-autostart.sh
├── src/                             # Frontend (React + TypeScript)
│   ├── App.tsx                      # Root component
│   ├── main.tsx                     # React entry point
│   ├── index.css                    # Tailwind and global styles
│   ├── components/
│   │   ├── Layout.tsx               # Main window frame
│   │   ├── BottomDock.tsx           # Bottom dock bar
│   │   ├── FooterStrip.tsx          # Status footer
│   │   ├── AudioMixerWidget.tsx     # Audio mixer
│   │   ├── MediaPlayerWidget.tsx    # MPRIS media player
│   │   ├── MsiCenterPage.tsx        # MSI hardware page
│   │   ├── GameModePage.tsx         # GameMode and MangoHud
│   │   ├── QuickActions.tsx         # GameMode toggle, RAM cache, disk cleanup
│   │   ├── ShutdownTimer.tsx        # Shutdown scheduler
│   │   ├── VolumeSlider.tsx         # PipeWire volume slider
│   │   ├── ui/                      # shadcn/ui primitives
│   │   └── widgets/
│   │       ├── factory.tsx          # Widget registry
│   │       ├── CpuWidget.tsx
│   │       ├── GpuWidget.tsx
│   │       ├── RamWidget.tsx
│   │       ├── NetworkWidget.tsx
│   │       ├── GameStatusWidget.tsx
│   │       ├── HardwareStatsWidget.tsx
│   │       ├── MsiEcWidget.tsx
│   │       ├── PerformanceHistoryWidget.tsx
│   │       ├── RunningGameWidget.tsx
│   │       ├── SessionCard.tsx
│   │       ├── SessionToolsWidget.tsx
│   │       ├── SystemMetricsWidget.tsx
│   │       └── TopProcessesWidget.tsx
│   ├── hooks/
│   │   ├── useAutoResize.ts
│   │   ├── useDebounce.ts
│   │   └── useIpcListener.ts
│   ├── store/
│   │   └── useSystemStore.ts        # Zustand state
│   └── types/
│       └── schema.d.ts              # Type definitions
├── src-tauri/                       # Backend (Rust)
│   ├── Cargo.toml
│   ├── tauri.conf.json              # Tauri v2 config
│   ├── build.rs
│   ├── capabilities/
│   │   └── default.json             # Permission scopes
│   ├── icons/                       # App icons
│   └── src/
│       ├── main.rs                  # Entry point
│       ├── lib.rs                   # Command registration
│       ├── audio.rs                 # PipeWire audio control
│       ├── helper.rs                # Privileged helper binary
│       ├── ipc.rs                   # Backpressure-safe event emitter
│       ├── mangohud.rs              # MangoHud FPS log parser
│       ├── monitor.rs               # System telemetry (CPU/RAM/GPU/network)
│       ├── mpris.rs                 # MPRIS D-Bus media player
│       ├── msi_ec.rs                # MSI embedded controller
│       ├── operating_mode.rs        # Performance mode profiles
│       ├── optimizer.rs             # Power profiles and GameMode
│       └── privileged.rs            # Polkit integration
└── pnpm-lock.yaml
```

## License

MIT
