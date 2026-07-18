import { memo, type ReactNode } from "react";
import { motion } from "framer-motion";
import TrafficLights from "./TrafficLights";
import { closeWindow, minimizeWindow, toggleMaximize } from "../hooks/useWindowControls";

interface LayoutProps {
  children: ReactNode;
}

const Layout = memo(function Layout({ children }: LayoutProps) {
  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* ── Window Header (28px) ── */}
      <header className="flex items-center h-[28px] min-h-[28px] bg-[#12131C] border-b border-[#2A2B3C] select-none">
        <TrafficLights
          onClose={closeWindow}
          onMinimize={minimizeWindow}
          onToggleMaximize={toggleMaximize}
        />
        <div data-tauri-drag-region className="flex-1 h-full" />
      </header>

      {/* ── Content Area ── */}
      <main className="flex-1 overflow-hidden p-3">
        <motion.div layout className="h-full grid grid-cols-1 auto-rows-min gap-2 overflow-y-auto">
          {children}
        </motion.div>
      </main>
    </div>
  );
});

export default Layout;
