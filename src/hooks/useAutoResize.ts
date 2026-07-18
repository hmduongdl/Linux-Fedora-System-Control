import { useEffect, useRef, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalSize } from "@tauri-apps/api/dpi";

const GROW_STEP = 20;

/**
 * Monitors a scrollable container and grows the window when content
 * overflows, ensuring cards never overlap with the bottom dock.
 */
export function useAutoResize(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
) {
  const hasResized = useRef(false);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = () => {
      // A resize triggers ResizeObserver again. Only perform one corrective
      // resize per mount; repeated setSize calls can starve WebKitGTK's UI
      // event loop and make the native window appear unresponsive.
      if (hasResized.current) return;
      const overflow = container.scrollHeight - container.clientHeight;
      if (overflow <= 0) return;

      hasResized.current = true;
      const win = getCurrentWindow();
      win.innerSize().then((size) => {
        win.setSize(
          new PhysicalSize(size.width, size.height + Math.ceil(overflow) + GROW_STEP),
        );
      }).catch(() => {});
    };

    const initialTimer = setTimeout(check, 150);
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, 200);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
      clearTimeout(initialTimer);
    };
  }, [active, containerRef]);
}
