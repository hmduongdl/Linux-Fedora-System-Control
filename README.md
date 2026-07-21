# Purrdora

Bảng điều khiển giám sát hệ thống và tối ưu hóa phần cứng chuyên sâu dành cho **Fedora Linux**, xây dựng trên nền tảng **Tauri v2 + React 19**, tích hợp sâu với trình điều khiển **MSI Embedded Controller (msi-ec)** nhằm mang các tính năng độc quyền của MSI Center lên Linux.

Purrdora hợp nhất giám sát tài nguyên phần cứng thời gian thực với khả năng tinh chỉnh hệ thống (quạt tản nhiệt, giới hạn sạc pin, chế độ hiệu năng, dọn dẹp bộ nhớ) trong một giao diện trực quan, mượt mà.

---

## Tính năng

### 1. Giám sát hệ thống thời gian thực
*   **Chỉ số tài nguyên:** Theo dõi mức sử dụng CPU, RAM, GPU, và băng thông mạng với chu kỳ cập nhật 1 giây.
*   **Lịch sử hiệu năng:** Biểu đồ dòng thời gian cho các chỉ số quan trọng giúp kiểm soát độ ổn định.
*   **Cảm biến nhiệt độ:** Đọc trực tiếp từ nhân Linux và bộ điều khiển MSI EC.
*   **Tiến trình hệ thống:** Danh sách các tiến trình ngốn RAM nhất, sắp xếp giảm dần theo thời gian thực.

### 2. Tinh chỉnh & tối ưu hệ thống
*   **Chế độ hoạt động:** Chuyển đổi nhanh giữa Work (cân bằng), Game (hiệu năng tối đa), và Eco (tiết kiệm pin, giới hạn sạc 80%).
*   **GameMode:** Bật/tắt nhanh GameMode của FeralInteractive để tăng ưu tiên CPU/GPU Scheduler, tích hợp MangoHud theo dõi FPS trực tiếp.
*   **Giải phóng RAM Cache:** Xóa Page Cache, Dentries, Inodes để giải phóng bộ nhớ vật lý tức thì (yêu cầu quyền nâng cao qua Polkit).
*   **Hẹn giờ tắt máy:** Công cụ đếm ngược tắt hệ thống tự động.

### 3. Tích hợp MSI EC Center
*   **Cấu hình quạt (Fan Profile):** Chuyển chế độ quạt (Auto, Silent, Advanced) hoặc kích hoạt Cooler Boost.
*   **Tự động tăng tốc quạt:** Bật Cooler Boost khi nhiệt độ đạt ngưỡng chỉ định và tự động tắt khi hạ nhiệt.
*   **Chế độ hiệu năng (Shift Mode):** Thiết lập mức giới hạn hiệu năng của EC (Eco, Comfort, Sport/Turbo).
*   **Bảo vệ pin (Battery Master):** Giới hạn sạc ở 80% để bảo vệ tuổi thọ pin hoặc cho phép sạc đầy 100%.
*   **Đèn nền bàn phím:** Thay đổi độ sáng đèn nền qua bộ điều khiển nhúng.

### 4. Âm thanh & đa phương tiện
*   **PipeWire Audio Mixer:** Điều chỉnh âm lượng riêng biệt cho từng cổng ra và bật/tắt tiếng (Mute).
*   **MPRIS:** Hiển thị bài hát đang phát (tên, nghệ sĩ, ảnh bìa) và điều khiển phát nhạc từ các trình phát tương thích (Spotify, Firefox, VLC, v.v.).

### 5. Quản lý Driver & Firmware
*   **Quét thiết bị thiếu driver:** Tự động phát hiện thiết bị PCI/USB chưa được kernel bind driver qua sysfs.
*   **Phát hiện thiếu firmware:** Quét nhật ký kernel để phát hiện module thiếu firmware blob.
*   **Cập nhật firmware qua LVFS:** Tích hợp `fwupdmgr` để kiểm tra và cài đặt cập nhật firmware cho BIOS, SSD, và thiết bị hỗ trợ LVFS.
*   **Khuyến nghị cài đặt driver:** Dựa trên vendor/device ID và distro family, gợi ý tên gói cần cài đặt cho từng dòng phần cứng.

---

## Thiết kế bảo mật & phân quyền

Để thực hiện các thao tác hệ thống nâng cao (ghi ngưỡng sạc pin, dọn RAM, chỉnh quạt MSI), Purrdora sử dụng kiến trúc phân quyền nghiêm ngặt:

*   **Giao diện unprivileged:** Giao diện Tauri/React chạy dưới quyền người dùng thông thường, hạn chế tối đa nguy cơ khai thác lỗ hổng qua Webview.
*   **Trợ lý đặc quyền (`purrdora-helper`):** Tiến trình Rust độc lập đặt tại `/usr/libexec/purrdora-helper`, chỉ chấp nhận danh sách lệnh được whitelist.
*   **Chính sách Polkit:** Cấu hình Polkit policy và rules cho phép thực thi passwordless chỉ dành riêng cho helper của ứng dụng.

---

## Yêu cầu hệ thống

*   **Hệ điều hành:** Fedora Linux 40+ (Workstation)
*   **Hệ thống âm thanh:** PipeWire (`wpctl`)
*   **D-Bus:** Dịch vụ UPower và PowerProfiles
*   **Firmware:** `fwupd` và `fwupdmgr` để cập nhật qua LVFS
*   **Gói phụ trợ (tùy chọn):**
    *   `gamemode`: `sudo dnf install gamemode`
    *   `mangohud`: `sudo dnf install mangohud`
*   **Phần cứng MSI (tùy chọn):** Laptop MSI với driver `msi-ec` đã được nạp.

---

## Hướng dẫn cài đặt & phát triển

### 1. Chuẩn bị môi trường

Yêu cầu các công cụ sau:

*   **Node.js** >= 20 + **pnpm**
*   **Rust** >= 1.77
*   **Tauri CLI** >= 2.x

### 2. Cài đặt phụ thuộc

```bash
pnpm install
```

### 3. Thiết lập môi trường đặc quyền (chạy một lần)

Cài đặt `purrdora-helper`, polkit policy và udev rules để các tính năng privileged hoạt động không cần mật khẩu trong môi trường dev:

```bash
bash scripts/install-dev-env.sh
```

Script sẽ yêu cầu sudo để sao chép file vào các thư mục hệ thống:
- `/usr/libexec/purrdora-helper` — helper binary
- `/usr/share/polkit-1/actions/com.purrdora.pkexec.policy` — khai báo hành động Polkit
- `/etc/polkit-1/rules.d/99-purrdora.rules` — quy tắc Polkit passwordless
- `/etc/udev/rules.d/99-purrdora.rules` — quy tắc udev cho MSI EC

### 4. Chạy ứng dụng ở chế độ dev

```bash
pnpm tauri:dev
```

### 5. Biên dịch bản release

```bash
pnpm tauri:build
```

---

## Cấu trúc dự án

```
├── assets/                          # Logo và tài nguyên tĩnh
├── packaging/
│   ├── 99-purrdora.rules            # Quy tắc Polkit passwordless
│   └── com.purrdora.pkexec.policy   # Khai báo hành động Polkit
├── scripts/
│   └── install-dev-env.sh           # Script cài đặt môi trường dev
├── resources/
│   ├── 99-purrdora.rules
│   ├── fedora-system-control.desktop
│   └── install-autostart.sh
├── src/                             # Frontend (React + TypeScript + Tailwind v4)
│   ├── App.tsx                      # Giao diện chính
│   ├── main.tsx                     # Điểm khởi chạy React
│   ├── index.css                    # Định nghĩa kiểu Tailwind toàn cục
│   ├── components/
│   │   ├── Layout.tsx               # Khung cửa sổ tùy chỉnh
│   │   ├── BottomDock.tsx           # Thanh dock điều hướng
│   │   ├── MsiCenterPage.tsx        # Trang điều khiển MSI Center
│   │   ├── GameModePage.tsx         # Trang GameMode & MangoHud
│   │   ├── DriversPage.tsx          # Trang Driver & Firmware
│   │   └── widgets/                 # Widget hiển thị chỉ số chi tiết
│   │       ├── HardwareHealthWidget.tsx
│   │       ├── OrphanDeviceList.tsx
│   │       ├── FirmwareUpdateList.tsx
│   │       ├── SystemMetricsWidget.tsx
│   │       └── ...
│   ├── hooks/
│   ├── store/
│   └── types/
└── src-tauri/                       # Backend (Tauri + Rust)
    ├── src/
    │   ├── main.rs                  # Điểm khởi chạy Tauri
    │   ├── lib.rs                   # Đăng ký lệnh IPC & module
    │   ├── monitor.rs               # Telemetry hệ thống (CPU/GPU/RAM/Network)
    │   ├── msi_ec.rs                # Giao tiếp với driver msi-ec
    │   ├── helper.rs                # Mã nguồn tiến trình helper
    │   ├── privileged.rs            # Giao tiếp nâng quyền với helper
    │   ├── driver_scan.rs           # Quét thiết bị thiếu driver & firmware
    │   ├── pci_ids.rs               # Parser cơ sở dữ liệu pci.ids/usb.ids
    │   ├── firmware.rs              # Tích hợp fwupd/LVFS
    │   └── driver_recommend.rs      # Khuyến nghị gói driver theo distro
    ├── resources/
    │   ├── pci.ids
    │   └── usb.ids
    └── capabilities/
        └── default.json
```

---

## Giấy phép

Dự án này được phát hành dưới giấy phép **MIT**. Xem chi tiết tại [LICENSE](./LICENSE).
