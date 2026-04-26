"use client";

// Barra de leyenda cromática para el mapa de calor.
// Se re-genera según la métrica activa.

import chroma from "chroma-js";

import type { MetricaCalor } from "./MapaCalor";

interface Props {
  metrica: MetricaCalor;
}

export function LeyendaMapa({ metrica }: Props) {
  const config =
    metrica === "lst"
      ? {
          titulo: "Temperatura del suelo (°C)",
          min: 20,
          max: 45,
          paleta: chroma
            .scale([
              "#000004",
              "#3b0f70",
              "#8c2981",
              "#de4968",
              "#fd9a6a",
              "#fcfdbf",
            ])
            .domain([20, 45]),
          marcas: [20, 25, 30, 35, 40, 45],
        }
      : {
          titulo:
            metrica === "uhi_vs_rural"
              ? "Cuánto más caliente que el campo (°C)"
              : "Cuánto más que el promedio de la ciudad (°C)",
          min: -5,
          max: 8,
          paleta: chroma
            .scale(["#1a3a5c", "#ffffff", "#c97d3c"])
            .mode("lab")
            .domain([-5, 0, 8]),
          marcas: [-4, -2, 0, 2, 4, 6, 8],
        };

  const steps = 80;
  const gradient = Array.from({ length: steps }, (_, i) => {
    const t = config.min + ((config.max - config.min) * i) / (steps - 1);
    return config.paleta(t).hex();
  });

  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-neutral-muted dark:text-dk-muted">
        {config.titulo}
      </p>
      <div className="mt-1 flex h-4 w-full overflow-hidden rounded border border-neutral-border dark:border-dk-border">
        {gradient.map((c, i) => (
          <div key={i} className="flex-1" style={{ background: c }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-neutral-muted dark:text-dk-muted">
        {config.marcas.map((m) => (
          <span key={m}>{m}°</span>
        ))}
      </div>
    </div>
  );
}
