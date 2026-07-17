.
├── src/                    # FRONTEND (React + TS)
│   ├── src/
│   │   ├── components/     # UI Widgets (System, Audio, Media, Actions)
│   │   ├── hooks/          # Custom hooks (useAudio, useMpris...)
│   │   ├── store/          # Zustand State Management (useSystemStore.ts)
│   │   ├── types/          # TypeScript Interfaces (schema.d.ts)
│   │   ├── App.tsx         # Main Layout & Routing
│   │   └── index.css       # Tailwind & Cyberpunk themes
├── src-tauri/              # BACKEND (Rust)
│   ├── src/
│   │   ├── audio.rs        # PipeWire/WirePlumber Controller
│   │   ├── monitor.rs      # Hardware Telemetry Engine
│   │   ├── mpris.rs        # DBus Media integration
│   │   ├── optimizer.rs    # Performance profiles & GameMode
│   │   └── main.rs         # Tauri Entrypoint & State Init
│   ├── Cargo.toml
│   └── tauri.conf.json     # Tauri v2 configuration