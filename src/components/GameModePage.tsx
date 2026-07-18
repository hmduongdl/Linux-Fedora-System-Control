import { useState, useRef, useEffect } from "react";
import { Gamepad2, Activity, Cpu, History, HelpCircle } from "lucide-react";
import { useSystemStore } from "../store/useSystemStore";
import { GameStatusWidget } from "./widgets/GameStatusWidget";
import { RunningGameWidget } from "./widgets/RunningGameWidget";
import { WidgetFactory } from "./widgets/factory";
import { invoke } from "@tauri-apps/api/core";
import type { GameSession } from "../types/schema";

export default function GameModePage() {
  const mainRef = useRef<HTMLElement>(null);

  const active = useSystemStore((s) => s.controls.is_gamemode_active);
  const toggle = useSystemStore((s) => s.toggleGamemode);

  // MangoHud states
  const [isMangoInstalled, setIsMangoInstalled] = useState<boolean>(false);
  const [isMangoConfigured, setIsMangoConfigured] = useState<boolean>(false);
  const [loadingMango, setLoadingMango] = useState<boolean>(true);
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [dismissedOnboarding, setDismissedOnboarding] = useState<boolean>(() => {
    return localStorage.getItem("purrdora_mangohud_onboarding_dismissed") === "true";
  });

  const checkMangoStatus = async () => {
    try {
      const installed = await invoke<boolean>("is_mangohud_installed");
      setIsMangoInstalled(installed);
      if (installed) {
        const configured = await invoke<boolean>("is_mangohud_configured");
        setIsMangoConfigured(configured);
      }
    } catch (err) {
      console.error("Failed to check MangoHud status:", err);
    } finally {
      setLoadingMango(false);
    }
  };

  const fetchSessions = async () => {
    try {
      const data = await invoke<GameSession[]>("list_recent_game_sessions");
      setSessions(data);
    } catch (err) {
      console.error("Failed to fetch game sessions:", err);
    }
  };

  useEffect(() => {
    checkMangoStatus();
    fetchSessions();
  }, []);

  const handleConfigureMango = async () => {
    try {
      const msg = await invoke<string>("configure_mangohud");
      setIsMangoConfigured(true);
      setIsSuccess(true);
      setActionStatus(msg || "Đã cấu hình MangoHud thành công!");
      fetchSessions();
    } catch (error) {
      setIsSuccess(false);
      setActionStatus(`Lỗi cấu hình MangoHud: ${String(error)}`);
    }
  };

  const formatTime = (ms: number) => {
    const date = new Date(ms);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' - ' + date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0a0a0f] text-[#e4e1e9]">
      <main
        ref={mainRef}
        className="custom-scrollbar min-h-0 flex-1 overflow-y-auto"
        style={{
          padding: "clamp(8px, 1.2vw, 24px)",
          paddingBottom: "calc(var(--dock-height, 68px) + 32px)",
        }}
      >
        <div className="dashboard-columns w-full">
          {/* ── Cột 1: Điều khiển Game Mode ── */}
          <div className="dashboard-column">
            <WidgetFactory title="ĐIỀU KHIỂN CHẾ ĐỘ" icon={<Gamepad2 size={14} />} accentColor="text-emerald-400">
              <div className="flex flex-col gap-3 py-1">
                <p className="text-[10px] text-on-surface-variant leading-relaxed">
                  Kích hoạt Game Mode để tối ưu hóa CPU Governor, GPU Power Profile và kích hoạt GameMode Daemon nhằm đạt hiệu năng chơi game tối đa.
                </p>

                {/* Big interactive switch button */}
                <button
                  onClick={() => void toggle()}
                  className={`group relative flex flex-col items-center justify-center rounded-2xl border p-4 text-center transition-all duration-300 ${
                    active
                      ? "border-emerald-500/40 bg-emerald-500/5 shadow-[0_0_20px_rgba(16,185,129,0.15)] text-emerald-400 hover:border-emerald-400/60"
                      : "border-white/10 bg-black/20 text-slate-400 hover:border-white/20 hover:bg-black/30"
                  }`}
                >
                  {active && (
                    <div className="absolute inset-0 -z-10 rounded-2xl bg-emerald-400/5 blur-xl animate-pulse" />
                  )}

                  <Gamepad2
                    size={32}
                    className={`transition-transform duration-500 group-hover:scale-110 ${
                      active ? "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" : "text-slate-600"
                    }`}
                  />
                  
                  <span className="mt-2 text-[11px] font-bold uppercase tracking-wider">
                    {active ? "Game Mode: Đang Bật" : "Game Mode: Đang Tắt"}
                  </span>
                  
                  <span className="mt-0.5 text-[8px] text-on-surface-variant font-mono">
                    {active ? "Click để tắt chế độ hiệu năng" : "Click để tối ưu hiệu năng chơi game"}
                  </span>
                </button>

                {/* Performance stats summary */}
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div className="flex items-center gap-2 rounded border border-white/5 bg-black/20 p-2">
                    <Cpu size={12} className="text-cyan-accent" />
                    <div>
                      <p className="text-[8px] uppercase text-on-surface-variant">CPU Governor</p>
                      <p className="font-mono text-[9px] font-bold text-slate-200">
                        {active ? "performance" : "schedutil"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded border border-white/5 bg-black/20 p-2">
                    <Activity size={12} className="text-pink-accent" />
                    <div>
                      <p className="text-[8px] uppercase text-on-surface-variant">Scheduler</p>
                      <p className="font-mono text-[9px] font-bold text-slate-200">
                        {active ? "GameMode" : "Default"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* MangoHud integration card */}
                <div className="border-t border-white/5 pt-3 mt-2">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-300 mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <HelpCircle size={12} className="text-cyan-accent" />
                      Theo dõi hiệu năng (MangoHud)
                    </span>
                  </div>

                  {/* Onboarding block */}
                  {!dismissedOnboarding && (
                    <div className="relative mb-2.5 rounded-lg border border-cyan-accent/20 bg-cyan-accent/5 p-2.5 text-[9px] text-on-surface-variant leading-relaxed">
                      <button 
                        onClick={() => {
                          localStorage.setItem("purrdora_mangohud_onboarding_dismissed", "true");
                          setDismissedOnboarding(true);
                        }}
                        className="absolute right-2 top-2 text-cyan-accent hover:text-white transition-colors font-bold"
                      >
                        ✕
                      </button>
                      <p className="font-bold text-cyan-accent mb-0.5">💡 HƯỚNG DẪN ĐO FPS</p>
                      <p className="pr-3">
                        Để hiển thị FPS trực tiếp, vui lòng cài đặt MangoHud và thêm cấu hình sau vào thuộc tính khởi chạy (Launch Options) của game trên Steam (hoặc cài đặt tương đương trên Lutris/Heroic):
                      </p>
                      <code className="mt-1 block bg-black/40 px-1.5 py-0.5 rounded text-cyan-accent font-mono text-[8px]">
                        MANGOHUD=1 %command%
                      </code>
                    </div>
                  )}

                  {/* MangoHud Installation Status check */}
                  {loadingMango ? (
                    <p className="text-[9px] text-slate-500 italic">Đang kiểm tra MangoHud...</p>
                  ) : !isMangoInstalled ? (
                    <div className="rounded-lg border border-pink-accent/20 bg-pink-accent/5 p-2 text-[9px] text-on-surface-variant">
                      <p className="font-bold text-pink-accent mb-0.5">⚠️ CHƯA CÀI ĐẶT MANGOHUD</p>
                      <p>Vui lòng cài đặt MangoHud để theo dõi chỉ số FPS in-game:</p>
                      <code className="mt-1 block bg-black/40 px-1.5 py-0.5 rounded text-pink-accent font-mono text-[8px]">
                        sudo dnf install mangohud
                      </code>
                    </div>
                  ) : !isMangoConfigured ? (
                    <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-2 text-[9px] text-on-surface-variant">
                      <p className="font-bold text-yellow-400 mb-0.5">⚙️ CHƯA CẤU HÌNH GHI LOG</p>
                      <p className="mb-1.5">Purrdora cần thiết lập thư mục log để đọc chỉ số FPS in-game.</p>
                      <button
                        onClick={handleConfigureMango}
                        className="px-2.5 py-1 bg-yellow-500/10 border border-yellow-500/30 hover:bg-yellow-500/20 text-yellow-400 text-[8px] font-bold rounded transition-colors uppercase tracking-wider"
                      >
                        Thiết lập thư mục log
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-2 text-[9px] flex items-center justify-between">
                      <div>
                        <p className="font-bold text-emerald-400">✅ MANGOHUD SẴN SÀNG</p>
                        <p className="text-[8px] text-slate-500">Đã kích hoạt tự động ghi log vào Purrdora</p>
                      </div>
                      <div className="flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    </div>
                  )}
                </div>
              </div>
            </WidgetFactory>

          </div>

          {/* ── Cột 2: Trạng thái Game & Lịch sử phiên chơi ── */}
          <div className="dashboard-column">
            <GameStatusWidget />

            {/* Session History Widget */}
            <WidgetFactory title="LỊCH SỬ PHIÊN CHƠI" icon={<History size={14} />} accentColor="text-pink-accent">
              <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto custom-scrollbar pr-1 py-1">
                {sessions.length === 0 ? (
                  <p className="text-[10px] text-slate-500 italic py-2">Chưa ghi nhận phiên chơi nào.</p>
                ) : (
                  sessions.slice(0, 6).map((session, index) => (
                    <div key={index} className="flex justify-between items-center rounded border border-white/5 bg-black/20 p-2 text-[10px] hover:border-white/10 transition-colors">
                      <div className="min-w-0 pr-2">
                        <p className="font-bold truncate text-slate-300" title={session.filename}>
                          {session.filename.split('_')[0] || "Game"}
                        </p>
                        <p className="text-[8px] text-slate-500 font-mono mt-0.5">{formatTime(session.start_time_ms)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono text-cyan-accent font-bold text-[11px]">
                          {session.average_fps != null ? `${session.average_fps.toFixed(0)}` : "—"}
                        </span>
                        <span className="text-[8px] text-slate-500 ml-0.5">FPS</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </WidgetFactory>
          </div>

          {/* ── Cột 3: Trò chơi đang chạy ── */}
          <div className="dashboard-column">
            <RunningGameWidget />
          </div>
        </div>
      </main>
    </div>
  );
}
