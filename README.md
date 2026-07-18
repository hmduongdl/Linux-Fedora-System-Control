# Fedora System Control

Dashboard giám sát & điều khiển hệ thống dành cho Fedora Linux, xây dựng với Tauri v2 + React.

## Tính năng

- **Giám sát hiệu năng** — biểu đồ CPU, RAM, GPU, và thông tin mạng theo thời gian thực (cập nhật mỗi giây)
- **Điều khiển âm thanh** — thanh trượt âm lượng và nút bật/tắt tiếng qua PipeWire (`wpctl`)
- **Trình phát nhạc** — hiển thị bài hát đang phát từ bất kỳ trình phát MPRIS nào (Spotify, Firefox, v.v.)
- **Power Profiles** — chuyển đổi giữa Power Saver / Balanced / Performance qua UPower D-Bus
- **GameMode** — bật/tắt FeralInteractive GameMode chỉ với một cú nhấp
- **Drop RAM Cache** — giải phóng bộ nhớ đệm (yêu cầu quyền sudo)
- **Custom window frame** — thanh tiêu đề riêng với nút đóng, thu nhỏ, phóng to

## Yêu cầu hệ thống

- **Fedora Linux** (Workstation, bản 40+)
- **PipeWire** (cho điều khiển âm thanh)
- **UPower PowerProfiles** (cho power profiles)
- **FeralInteractive GameMode** (tùy chọn, cho GameMode toggle)

Các công cụ phát triển:

- **Node.js** >= 20 + **pnpm**
- **Rust** >= 1.77.2
- **Tauri CLI** >= 2.x

## Cài đặt & Chạy

```bash
# 1. Cài dependencies
pnpm install

# 2. Chạy ở môi trường development
pnpm tauri:dev

# 3. Build production
pnpm tauri:build
```

File cài đặt sẽ nằm trong `src-tauri/target/release/bundle/`.

## Công nghệ sử dụng

| Lớp | Công nghệ |
|------|-----------|
| Frontend | React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Recharts, Framer Motion, Zustand |
| Backend | Tauri v2, Rust, sysinfo, tokio, zbus |
| Âm thanh | PipeWire (`wpctl` CLI) |
| D-Bus | MPRIS (media player), UPower PowerProfiles, GameMode |

## Cấu trúc dự án

```
├── src/                     # Frontend React
│   ├── App.tsx              # Entry point
│   ├── components/
│   │   ├── widgets/         # CpuWidget, RamWidget, GpuWidget
│   │   ├── VolumeSlider.tsx # Thanh trượt âm lượng
│   │   ├── MediaPlayerWidget.tsx  # Widget trình phát nhạc
│   │   ├── QuickActions.tsx # GameMode & Drop Cache
│   │   ├── Layout.tsx       # Khung cửa sổ chính
│   │   └── TrafficLights.tsx # Nút close/minimize/maximize
│   ├── hooks/               # useIpcListener, useDebounce
│   ├── store/               # Zustand store (useSystemStore)
│   └── types/               # TypeScript type definitions
├── src-tauri/               # Backend Rust
│   └── src/
│       ├── main.rs          # Entry point
│       ├── lib.rs           # Tauri builder & command registration
│       ├── monitor.rs       # System telemetry (CPU, RAM, GPU, network)
│       ├── audio.rs         # PipeWire audio control (wpctl)
│       ├── mpris.rs         # MPRIS media player listener
│       ├── optimizer.rs     # Power profiles, GameMode, RAM cache
│       └── ipc.rs           # IPC emitter (event queue)
└── resources/               # App icons & assets
```

## Quick Actions

### GameMode
Bật/tắt FeralInteractive GameMode. Khi bật, biểu tượng sẽ đổi màu cyan kèm chấm chỉ báo. Yêu cầu cài đặt `gamemoded`:

```bash
sudo dnf install gamemode
```

### Drop RAM Cache
Giải phóng page cache, dentries và inodes. Cần chạy app với quyền sudo hoặc cấu hình sudoers:

```bash
# Cho phép không cần mật khẩu (tùy chọn)
echo "$USER ALL=(ALL) NOPASSWD: /usr/bin/tee /proc/sys/vm/drop_caches" | sudo tee /etc/sudoers.d/drop-cache
```

## License

MIT
