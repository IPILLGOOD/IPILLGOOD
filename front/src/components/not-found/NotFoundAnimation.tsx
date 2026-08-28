"use client";

import type { AnimationItem } from "lottie-web";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const ASSET_ROOT = "/projects/ipillgood/scene-404";

export function NotFoundAnimation() {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = container.current;
    if (!host) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const controller = new AbortController();
    let player: AnimationItem | undefined;
    let active = true;
    let visible = false;
    let loading = false;
    let failed = false;

    const shouldPlay = () => !reducedMotion.matches && visible && document.visibilityState === "visible";
    const updatePlayback = () => {
      if (!active || !player) return;
      if (shouldPlay()) {
        player.play();
        host.dataset.state = "playing";
      } else {
        player.pause();
        host.dataset.state = "paused";
      }
    };

    const load = async () => {
      if (!active || player || loading || failed || !shouldPlay()) return;
      loading = true;
      try {
        // The SVG-only player and local vector data load only on this screen.
        const [{ default: lottie }, animationData] = await Promise.all([
          import("lottie-web/build/player/lottie_light"),
          fetch(`${ASSET_ROOT}/lottie.json`, { signal: controller.signal }).then((response) => {
            if (!response.ok) throw new Error("Animation unavailable");
            return response.json();
          }),
        ]);
        if (!active || reducedMotion.matches) return;
        player = lottie.loadAnimation({
          container: host,
          renderer: "svg",
          loop: true,
          autoplay: false,
          animationData,
          rendererSettings: { preserveAspectRatio: "xMidYMid meet", hideOnTransparent: true },
        });
        // Keep the compact 30-fps timeline, but interpolate at display refresh rate
        // so gentle motion does not repeat frames on 60/120-Hz screens.
        player.setSubframe(true);
        player.addEventListener("DOMLoaded", () => {
          if (!active) return;
          setReady(true);
          updatePlayback();
        });
        player.addEventListener("data_failed", () => {
          if (active) setReady(false);
          failed = true;
          player?.destroy();
          player = undefined;
        });
      } catch {
        // Decorative artwork must never block recovery from the error page.
        failed = true;
      } finally {
        loading = false;
      }
    };

    const sync = () => {
      updatePlayback();
      void load();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(host);
    reducedMotion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);

    return () => {
      active = false;
      controller.abort();
      observer.disconnect();
      reducedMotion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      player?.destroy();
    };
  }, []);

  return (
    <div className="not-found-art" data-ready={ready} aria-hidden="true">
      <Image
        className="not-found-art__poster"
        src={`${ASSET_ROOT}/poster.svg`}
        alt=""
        width={480}
        height={320}
        loading="eager"
        unoptimized
      />
      <div className="not-found-art__animation" ref={container} />
    </div>
  );
}
