# Purrdora

System monitoring & control dashboard for Fedora Linux, built with Tauri v2 + React.

<p align="center">
  <img alt="Purrdora Logo" src="./assets/logo.png" width="200">
</p>

## Features

- **System Monitor** — Real-time CPU, RAM, GPU, and network charts (1s refresh)
- **Audio Mixer** — Volume slider & mute toggle via PipeWire
- **Media Player** — Now-playing display for any MPRIS-compatible player (Spotify, Firefox, etc.)
- **Power Profiles** — Switch between Power Saver / Balanced / Performance via UPower D-Bus
- **GameMode** — One-click FeralInteractive GameMode toggle
- **Drop RAM Cache** — Free page cache, dentries, and inodes (pkexec/Polkit)
- **Performance History** — Time-series charts for CPU, RAM, GPU, network
- **Top Processes** — Live process table sorted by resource usage
- **MSI EC Monitor** — Fan speeds, CPU/GPU temps from MSI embedded controller
- **Shutdown Timer** — Schedule system shutdown with countdown
- **Custom Window Frame** — Native-looking title bar with minimize/maximize/close

## Requirements

- **Fedora Linux** 40+ (Workstation)
- **PipeWire** for audio control
- **UPower PowerProfiles** D-Bus service
- **gamemode** — optional, for GameMode toggle: `sudo dnf install gamemode`
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

Hardware monitoring works without elevated privileges. Executing hardware commands (Fan Modes, Shift Modes, Cooler Boost, Keyboard Backlight, Battery limits, Power Profiles) requires superuser access.

Purrdora uses a dedicated Rust helper (`purrdora-helper`) with **PolicyKit (polkit)** rules for secure, passwordless execution.

```bash
pnpm tauri:build                     # Build first
sudo ./packaging/install.sh          # Install helper + polkit rules
```

What the installer does:
1. Copies `purrdora-helper` to `/usr/libexec/purrdora-helper` (input-whitelisted, memory-safe Rust)
2. Installs Polkit policy: `/usr/share/polkit-1/actions/com.purrdora.pkexec.policy`
3. Installs Polkit rules: `/etc/polkit-1/rules.d/99-purrdora.rules`

> **Note:** A `pkexec` dialog may appear on first privileged action, or if Polkit is misconfigured. In dev mode (`pnpm tauri:dev`), a setup dialog warns when the helper isn't installed.

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

## Project Structure

```
├── assets/                    # Logo & static assets
├── src/                       # Frontend (React + TypeScript)
│   ├── App.tsx                # Root component
│   ├── main.tsx               # React entry point
│   ├── index.css              # Tailwind & global styles
│   ├── components/
│   │   ├── Layout.tsx         # Main window frame
│   │   ├── BottomDock.tsx     # Bottom dock bar
│   │   ├── FooterStrip.tsx    # Status footer
│   │   ├── AudioMixerWidget.tsx
│   │   ├── MediaPlayerWidget.tsx
│   │   ├── MsiCenterPage.tsx  # MSI hardware page
│   │   ├── QuickActions.tsx   # GameMode, RAM cache
│   │   ├── ShutdownTimer.tsx  # Shutdown scheduler
│   │   └── widgets/
│   │       ├── factory.tsx    # Widget registry
│   │       ├── CpuWidget.tsx
│   │       ├── GpuWidget.tsx
│   │       ├── RamWidget.tsx
│   │       ├── NetworkWidget.tsx
│   │       ├── GameStatusWidget.tsx
│   │       ├── HardwareStatsWidget.tsx
│   │       ├── MsiEcWidget.tsx
│   │       ├── PerformanceHistoryWidget.tsx
│   │       ├── RunningGameWidget.tsx
│   │       ├── SessionToolsWidget.tsx
│   │       ├── SystemMetricsWidget.tsx
│   │       └── TopProcessesWidget.tsx
│   ├── hooks/
│   │   ├── useDebounce.ts
│   │   └── useIpcListener.ts
│   ├── store/
│   │   └── useSystemStore.ts  # Zustand state
│   └── types/
│       └── schema.d.ts        # Type definitions
├── src-tauri/                 # Backend (Rust)
│   ├── Cargo.toml
│   ├── tauri.conf.json        # Tauri v2 config
│   ├── capabilities/          # Permission scopes
│   └── src/
│       ├── main.rs            # Entry point
│       ├── lib.rs             # Command registration
│       ├── audio.rs           # PipeWire audio control
│       ├── monitor.rs         # System telemetry
│       ├── mpris.rs           # MPRIS media player
│       ├── optimizer.rs       # Power profiles & GameMode
│       ├── msi_ec.rs          # MSI embedded controller
│       ├── helper.rs          # Privileged helper binary
│       ├── operating_mode.rs  # Performance mode profiles
│       └── privileged.rs      # Polkit integration
└── resources/                 # App icons & assets
```

## License

MIT
