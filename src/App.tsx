import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useIpcListener } from "./hooks/useIpcListener";
import MediaPlayerWidget from "./components/MediaPlayerWidget";
import { AudioMixerWidget } from "./components/AudioMixerWidget";
import { SystemMetricsWidget } from "./components/widgets/SystemMetricsWidget";
import { PerformanceHistoryWidget } from "./components/widgets/PerformanceHistoryWidget";
import { SessionToolsWidget } from "./components/widgets/SessionToolsWidget";
import { MsiCenterPage } from "./components/MsiCenterPage";
import GameModePage from "./components/GameModePage";
import { TopProcessesWidget } from "./components/widgets/TopProcessesWidget";
import Layout from "./components/Layout";
import { BottomDock } from "./components/BottomDock";

function App() {
  useIpcListener();
  const [activeTab, setActiveTab] = useState<"dashboard" | "game" | "msi">("dashboard");
  const [helperStatus, setHelperStatus] = useState<any>(null);
  const [showHelperModal, setShowHelperModal] = useState(false);
  const [alwaysAuthenticate, setAlwaysAuthenticate] = useState(() =>
    localStorage.getItem("purrdora_always_authenticate") === "true"
  );

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const handleFullscreenKeys = async (event: KeyboardEvent) => {
      if (event.key !== "F11" && event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      if (event.key === "F11") {
        await appWindow.setFullscreen(!(await appWindow.isFullscreen()));
      } else if (await appWindow.isFullscreen()) {
        await appWindow.setFullscreen(false);
      }
    };
    globalThis.addEventListener("keydown", handleFullscreenKeys, { capture: true });
    return () => globalThis.removeEventListener("keydown", handleFullscreenKeys);
  }, []);

  const handleAuthenticationPreference = (enabled: boolean) => {
    setAlwaysAuthenticate(enabled);
    localStorage.setItem("purrdora_always_authenticate", String(enabled));
  };

  useEffect(() => {
    const isDismissed = localStorage.getItem("purrdora_helper_dialog_dismissed") === "true";
    if (isDismissed) return;

    invoke<any>("check_helper_installation")
      .then((status) => {
        if (!status.is_correct) {
          setHelperStatus(status);
          setShowHelperModal(true);
        }
      })
      .catch((err) => console.error("Failed to check helper installation:", err));
  }, []);

  const handleDismissHelperModal = () => {
    localStorage.setItem("purrdora_helper_dialog_dismissed", "true");
    setShowHelperModal(false);
  };

  return (
    <>
      {activeTab === "dashboard" ? (
        <Layout>
        {/* ── Column 1: Media ── */}
        <div className="dashboard-column">
          <MediaPlayerWidget />
          <AudioMixerWidget />
        </div>

        {/* ── Column 2: Performance Stats ── */}
        <div className="dashboard-column">
          <SystemMetricsWidget />
          <PerformanceHistoryWidget />
        </div>

        {/* ── Column 3: Controls & Processes ── */}
        <div className="dashboard-column">
          <SessionToolsWidget />
          <TopProcessesWidget />
        </div>
        </Layout>
      ) : activeTab === "game" ? (
        <GameModePage />
      ) : (
        <MsiCenterPage />
      )}

      <BottomDock
        activePage={activeTab}
        onNavigate={setActiveTab}
      />

      {showHelperModal && helperStatus && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
          <div className="glass-panel w-full max-w-[500px] border border-white/10 bg-slate-900 rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h2 className="text-sm font-bold text-pink-accent flex items-center gap-2 mb-3">
              ⚠️ YÊU CẦU CÀI ĐẶT HELPER & POLKIT
            </h2>
            <div className="space-y-3 text-xs text-on-surface-variant leading-relaxed mb-4">
              <p>
                Ứng dụng phát hiện thấy gói bổ trợ đặc quyền hệ thống (<code className="bg-white/5 px-1 py-0.5 rounded text-cyan-accent font-mono text-[10px]">purrdora-helper</code> hoặc cấu hình Polkit) chưa được cài đặt đầy đủ.
              </p>
              <p>
                Để các tính năng kiểm soát phần cứng (tốc độ quạt, hiệu năng, giới hạn sạc pin) hoạt động trơn tru mà <strong>không cần mật khẩu</strong>, ứng dụng cần được cài đặt từ gói chính thức (<code className="bg-white/5 px-1 py-0.5 rounded text-cyan-accent font-mono text-[10px]">.deb</code> / <code className="bg-white/5 px-1 py-0.5 rounded text-cyan-accent font-mono text-[10px]">.rpm</code>) thay vì chạy trực tiếp qua <code className="bg-white/5 px-1 py-0.5 rounded text-cyan-accent font-mono text-[10px]">cargo tauri dev</code>.
              </p>
            </div>
            
            <div className="bg-black/30 border border-white/5 rounded-xl p-3 mb-5">
              <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2">Trạng thái cài đặt hệ thống:</p>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Helper Binary:</span>
                  <span className={helperStatus.helper_exists ? "text-emerald-400" : "text-red-400 font-bold"}>
                    {helperStatus.helper_exists ? "Đã cài đặt" : "Chưa tìm thấy"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Polkit Policy:</span>
                  <span className={helperStatus.policy_exists ? "text-emerald-400" : "text-red-400 font-bold"}>
                    {helperStatus.policy_exists ? "Đã cấu hình" : "Chưa cấu hình"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Polkit Rules:</span>
                  <span className={helperStatus.rules_exists ? "text-emerald-400" : "text-red-400 font-bold"}>
                    {helperStatus.rules_exists ? "Đã cấu hình" : "Chưa cấu hình"}
                  </span>
                </div>
              </div>
            </div>

            <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-xl border border-white/5 bg-black/20 p-3 text-xs">
              <input
                type="checkbox"
                checked={alwaysAuthenticate}
                onChange={(event) => handleAuthenticationPreference(event.target.checked)}
                className="mt-0.5 accent-pink-500"
              />
              <span className="leading-relaxed text-on-surface-variant">
                Luôn yêu cầu nhập mật khẩu khi thực hiện thao tác đặc quyền
                <span className="mt-1 block text-[10px] text-slate-500">
                  Lựa chọn được lưu trên máy này. Tắt tùy chọn để dùng Polkit passwordless.
                </span>
              </span>
            </label>

            <div className="flex justify-end gap-3">
              <button
                onClick={handleDismissHelperModal}
                className="px-4 py-2 bg-pink-accent/20 border border-pink-accent/30 hover:bg-pink-accent/30 text-pink-accent font-bold text-xs rounded-xl transition-all"
              >
                Tôi Đã Hiểu
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
