"use client";

// Ranking top/bottom 5 de barrios por UHI o LST.

import Link from "next/link";
import chroma from "chroma-js";

import type { UhiMensualRow, UhiEstacionalRow } from "@/lib/types";
import type { MetricaCalor } from "./MapaCalor";

interface Props {
  rows: UhiMensualRow[];
  estacionales: UhiEstacionalRow[];
  metrica: MetricaCalor;
  nombres: Record<string, string>; // id → nombre legible
  onSelect?: (id: string) => void;
}

const ESCALA_UHI = chroma
  .scale(["#1a3a5c", "#ffffff", "#c97d3c"])
  .mode("lab")
  .domain([-5, 0, 8]);

const ESCALA_LST = chroma
  .scale(["#000004", "#3b0f70", "#8c2981", "#de4968", "#fd9a6a", "#fcfdbf"])
  .domain([20, 45]);

interface FilaRanking {
  id: string;
  nombre: string;
  valor: number;
}

export function RankingBarrios({
  rows,
  estacionales,
  metrica,
  nombres,
  onSelect,
}: Props) {
  // Tomamos el dato más reciente de cada polígono.
  const ultimosPorPoli = new Map<string, UhiMensualRow>();
  for (const r of rows) {
    const prev = ultimosPorPoli.get(r.poligono_id);
    if (!prev || prev.anio < r.anio || (prev.anio === r.anio && prev.mes < r.mes)) {
      ultimosPorPoli.set(r.poligono_id, r);
    }
  }

  const filas: FilaRanking[] = [];
  for (const [id, r] of ultimosPorPoli.entries()) {
    let valor: number;
    if (metrica === "lst") valor = Number(r.lst_mean);
    else if (metrica === "uhi_vs_rural") valor = Number(r.uhi_vs_rural);
    else valor = Number(r.uhi_vs_ciudad);
    if (!Number.isFinite(valor)) continue;
    filas.push({ id, nombre: nombres[id] ?? id, valor });
  }

  filas.sort((a, b) => b.valor - a.valor);
  const top5 = filas.slice(0, 5);
  const bottom5 = [...filas].slice(-5).reverse();

  // Marcar "sin datos" si no hay estacionales (fallback).
  const sinDatos = !rows.length;
  if (sinDatos) {
    return (
      <div className="card">
        <h3 className="text-sm font-semibold text-primary">Ranking</h3>
        <p className="mt-2 text-sm text-neutral-muted">
          Aún no hay datos de UHI. Corriendo el pipeline Landsat…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Ranking
        titulo="Top 5 más calientes"
        filas={top5}
        metrica={metrica}
        onSelect={onSelect}
      />
      <Ranking
        titulo="Top 5 más frescos"
        filas={bottom5}
        metrica={metrica}
        onSelect={onSelect}
      />
    </div>
  );
}

function Ranking({
  titulo,
  filas,
  metrica,
  onSelect,
}: {
  titulo: string;
  filas: FilaRanking[];
  metrica: MetricaCalor;
  onSelect?: (id: string) => void;
}) {
  const escala = metrica === "lst" ? ESCALA_LST : ESCALA_UHI;
  const maxAbs = Math.max(...filas.map((f) => Math.abs(f.valor)), 0.1);

  return (
    <div className="card">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-secondary">
        {titulo}
      </h3>
      <ul className="mt-2 space-y-2">
        {filas.map((f) => {
          const ancho = (Math.abs(f.valor) / maxAbs) * 100;
          const color = escala(f.valor).hex();
          return (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              <button
                type="button"
                className="flex-1 text-left font-medium text-primary hover:underline"
                onClick={() => onSelect?.(f.id)}
              >
                {f.nombre}
              </button>
              <div className="relative h-5 w-32 overflow-hidden rounded bg-neutral-100">
                <div
                  className="h-full"
                  style={{ width: `${ancho}%`, background: color }}
                />
              </div>
              <span className="w-16 text-right font-mono text-xs text-neutral-text">
                {f.valor > 0 ? "+" : ""}
                {f.valor.toFixed(1)}°C
              </span>
              <Link
                href={`/poligono/${f.id}`}
                className="text-xs text-secondary hover:underline"
                aria-label={`Ver ficha de ${f.nombre}`}
              >
                ficha
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
