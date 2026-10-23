"use client";

import { useEffect, useRef } from "react";

// Escena del encabezado: la lluvia y los relámpagos siguen los datos reales
// (parte del aeropuerto y rayos del satélite), no son decoración fija.
// 0 sin lluvia, 1 débil, 2 moderada, 3 fuerte.
export type RainIntensity = 0 | 1 | 2 | 3;

const DROPS: Record<RainIntensity, number> = { 0: 0, 1: 45, 2: 110, 3: 220 };

export function NinoSky({ intensity, lightning }: { intensity: RainIntensity; lightning: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0, height = 0, frame = 0, visible = true, last = performance.now();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const drops = Array.from({ length: DROPS[intensity] }, () => ({ x: Math.random(), y: Math.random(), speed: 0.55 + Math.random() * 0.6, length: 10 + Math.random() * 14 }));
    const resize = () => {
      width = canvas.clientWidth; height = canvas.clientHeight;
      canvas.width = width * ratio; canvas.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const draw = (dt: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = intensity === 3 ? 1.6 : 1.1;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const d of drops) {
        if (!reduced) { d.y += (d.speed * dt) / 900; if (d.y > 1.1) { d.y = -0.1; d.x = Math.random(); } }
        const x = d.x * width, y = d.y * height;
        // Inclinación leve, como con viento del noreste.
        ctx.moveTo(x, y); ctx.lineTo(x - d.length * 0.25, y + d.length);
      }
      ctx.stroke();
    };
    const loop = (now: number) => {
      const dt = Math.min(64, now - last); last = now;
      if (visible && !document.hidden) draw(dt);
      frame = requestAnimationFrame(loop);
    };
    resize();
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(canvas);
    const viewObserver = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    viewObserver.observe(canvas);
    if (reduced || !drops.length) draw(0); else frame = requestAnimationFrame(loop);

    // Relámpago cada tantos segundos, solo si hay rayos cerca de verdad.
    let flashTimer = 0;
    const scheduleFlash = () => {
      flashTimer = window.setTimeout(() => {
        const el = flashRef.current;
        // Doble destello corto, como un relámpago real.
        if (el && visible && !document.hidden) el.animate([{ opacity: 0 }, { opacity: 0.55 }, { opacity: 0.05 }, { opacity: 0.35 }, { opacity: 0 }], { duration: 650, easing: "ease-out" });
        scheduleFlash();
      }, 4000 + Math.random() * 7000);
    };
    if (lightning && !reduced) scheduleFlash();
    return () => { cancelAnimationFrame(frame); clearTimeout(flashTimer); sizeObserver.disconnect(); viewObserver.disconnect(); };
  }, [intensity, lightning]);

  return <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: "inherit", pointerEvents: "none" }}>
    <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    <div ref={flashRef} style={{ position: "absolute", inset: 0, background: "#fff", opacity: 0 }} />
  </div>;
}
