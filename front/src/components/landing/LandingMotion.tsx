"use client";

import { useEffect, type PointerEvent, type ReactNode } from "react";

export function LandingMotion({ children }: { children: ReactNode }) {
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".launch-shell");
    const elements = document.querySelectorAll<HTMLElement>("[data-landing-reveal]");
    shell?.classList.add("is-motion-ready");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8%", threshold: 0.12 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const x = (event.clientX / window.innerWidth - 0.5) * 2;
    const y = (event.clientY / window.innerHeight - 0.5) * 2;
    event.currentTarget.style.setProperty("--landing-pointer-x", x.toFixed(3));
    event.currentTarget.style.setProperty("--landing-pointer-y", y.toFixed(3));
  }

  return (
    <div className="launch-shell" onPointerMove={handlePointerMove}>
      {children}
    </div>
  );
}
