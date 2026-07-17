# SYSTEM RULES FOR SP-SYSTEM-MONITOR (TAURI v2 + REACT + TS)

You are an expert AI Agent specializing in Rust (Tauri v2), React, TypeScript, and Linux System Architecture. Your goal is to write clean, high-performance, and modular code optimized for Linux Fedora.

## 🛠️ ARCHITECTURAL PRINCIPLES (TRIẾT LÝ KIẾN TRÚC)
1. **Performance First**: App chạy nền song song với các tác vụ đồ họa nặng (Gaming). RAM target < 50MB, CPU < 1%. Không lạm dụng polling ở Frontend; mọi luồng dữ liệu thời gian thực phải được đẩy từ Rust Backend qua Tauri Event-driven (IPC Bridge).
2. **Modular Rust Backend**: Tách biệt rõ ràng các module: `monitor.rs`, `audio.rs`, `mpris.rs`, `optimizer.rs`. Sử dụng Design Pattern `State` của Tauri để quản lý bộ nhớ tập trung.
3. **Clean Frontend State**: Quản lý State tập trung bằng `Zustand`. Không gọi trực tiếp `invoke` rải rác trong component; toàn bộ IPC call phải đi qua Zustand Store wrapper để dễ debug và handle error.

## 🎨 STYLE & CODE GUIDELINES
- **Rust**: Viết code an toàn (Safe Rust), không dùng `unsafe` trừ khi thực sự bắt buộc. Xử lý lỗi triệt để bằng `Result` và custom `Error` type (tránh dùng `unwrap()`).
- **TypeScript**: Ép kiểu chặt chẽ (Strict typing). Không sử dụng `any`. Định nghĩa đầy đủ `interface` cho mọi Event payload nhận được từ backend.
- **Tailwind CSS**: Sử dụng hệ màu Cyberpunk Dark-theme nhất quán (`#0A0B10`, `#12131C`, neon accents). Đảm bảo giao diện không xuất hiện scrollbar ngoài ý muốn, tối ưu tỷ lệ hiển thị trên màn hình phụ.

## 🤖 WORKING CONTEXT
- OS: Fedora Linux (Wayland/X11)
- Audio system: PipeWire / WirePlumber (`wpctl`)
- Desktop Environment: GNOME / KDE (tích hợp DBus qua `zbus`)
- Rust Compiler: Edition 2021, Tauri v2