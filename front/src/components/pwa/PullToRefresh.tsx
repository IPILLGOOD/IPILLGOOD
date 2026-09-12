"use client";

import { ArrowDown, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

type PullState = "idle" | "pulling" | "ready" | "refreshing";
const threshold = 120;

// A page gesture must never take over a form, dialog, or independently scrolling area.
function canStartAt(target: EventTarget | null) {
  if (!(target instanceof Element)
    || !target.closest(".app-column")
    || target.closest('a, button, input, textarea, select, label, [contenteditable]:not([contenteditable="false"]), [role="slider"]')
    || document.querySelector('[aria-modal="true"], dialog[open]')) return false;
  for (let node: Element | null = target; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return false;
  }
  return true;
}

export function PullToRefresh() {
  const [state, setState] = useState<PullState>("idle");

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 959px) and (pointer: coarse)");
    let start: { x: number; y: number; id: number } | null = null;
    let distance = 0;
    let refreshing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      start = null;
      distance = 0;
      if (!refreshing) setState("idle");
    };
    const onStart = (event: TouchEvent) => {
      if (refreshing) return;
      cancel();
      if (!mobile.matches || event.touches.length !== 1 || window.scrollY > 0
        || (window.visualViewport?.scale ?? 1) !== 1 || !canStartAt(event.target)) return;
      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
    };
    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0];
      if (!mobile.matches || event.touches.length !== 1 || touch.identifier !== start.id
        || window.scrollY > 0 || event.defaultPrevented || !event.cancelable) return cancel();
      const dx = Math.abs(touch.clientX - start.x);
      const dy = touch.clientY - start.y;
      if (dy < 0 || (dx > 8 && dx > dy)) return cancel();
      if (dy < 8) { distance = 0; setState("idle"); return; }
      // Installed PWAs don't consistently implement the browser's native gesture.
      // Cancel only a downward pull at the top, leaving ordinary scrolling intact.
      event.preventDefault();
      distance = dy;
      setState(dy >= threshold ? "ready" : "pulling");
    };
    const onEnd = (event: TouchEvent) => {
      if (!start || event.touches.length !== 0) return cancel();
      if (distance < threshold) return cancel();
      start = null;
      refreshing = true;
      setState("refreshing");
      // Let the status paint before reloading the current URL, including its query.
      timer = setTimeout(() => window.location.reload(), 100);
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      clearTimeout(timer);
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", cancel);
    };
  }, []);

  return (
    <div className={`pull-to-refresh pull-to-refresh--${state}`} role="status" aria-live="polite" aria-atomic="true">
      {state !== "idle" ? (
        <>
          {state === "refreshing" ? <RotateCw size={18} aria-hidden="true" /> : <ArrowDown size={18} aria-hidden="true" />}
          <span>{state === "refreshing" ? "새로고침 중…" : state === "ready" ? "놓으면 새로고침" : "아래로 당겨 새로고침"}</span>
        </>
      ) : null}
    </div>
  );
}
