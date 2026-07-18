import { memo, useRef, type ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

const Layout = memo(function Layout({ children }: LayoutProps) {
  const mainRef = useRef<HTMLElement>(null);

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
        <div className="dashboard-columns w-full" style={{ height: "100%" }}>
          {children}
        </div>
      </main>
    </div>
  );
});

export default Layout;
