"use client";

// Gauge de calidad del aire (NO2 troposferico Sentinel-5P TROPOMI).
// Representa el valor `no2_relativo_bbox` como una barra horizontal
// con tres zonas semaforicas: mejor / similar / peor que el promedio
// del bbox de Posadas. Debajo se muestra el valor absoluto en
// notacion cientifica (mol/m2) y el anio de referencia.

import { TerminoGlosario } from "@/components/TerminoGlosario";
import type { No2Row } from "@/lib/types";

interface AireGaugeProps {
  rows: No2Row[];
}

// Limites de la barra horizontal. Los datos reales van ~0.7 a ~1.3,
// asi que 0.6 / 1.5 da un margen razonable sin clipear puntos reales.
const MIN_RATIO = 0.6;
const MAX_RATIO = 1.5;

const COLOR_MEJOR = "#10b981"; // verde <0.9
const COLOR_SIMILAR = "#eab308"; // amarillo 0.9-1.1
const COLOR_PEOR = "#c97d3c"; // accent naranja >1.1
const COLOR_GRID = "#e5e7eb";

function tomarMasReciente(rows: No2Row[]): No2Row | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => b.anio - a.anio)[0];
}

function colorPorRatio(ratio: number): string {
  if (ratio < 0.9) return COLOR_MEJOR;
  if (ratio <= 1.1) return COLOR_SIMILAR;
  return COLOR_PEOR;
}

function etiquetaPorRatio(ratio: number): string {
  if (ratio < 0.9) return "Mejor aire que el promedio de Posadas";
  if (ratio <= 1.1) return "Calidad de aire similar al promedio";
  return "Peor aire que el promedio de Posadas";
}

// Convertimos el valor en mol/m2 a notacion cientifica compacta.
// Ejemplo: 1.66e-5 -> "1.66 x 10 a la -5".
function formatoCientifico(valor: number): string {
  if (!Number.isFinite(valor) || valor === 0) return "0";
  const exponente = Math.floor(Math.log10(Math.abs(valor)));
  const mantisa = valor / Math.pow(10, exponente);
  return `${mantisa.toFixed(2)} × 10${superindice(exponente)}`;
}

// Devuelve el exponente en superindice unicode para negativos/positivos.
function superindice(n: number): string {
  const digitos: Record<string, string> = {
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
    "7": "⁷",
    "8": "⁸",
    "9": "⁹",
    "-": "⁻",
  };
  return String(n)
    .split("")
    .map((c) => digitos[c] ?? c)
    .join("");
}

export function AireGauge({ rows }: AireGaugeProps) {
  const ultima = tomarMasReciente(rows);

  if (!ultima) {
    return (
      <div className="flex h-full min-h-[160px] flex-col items-start justify-center">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          Calidad del aire
        </h3>
        <p className="mt-2 text-sm italic text-neutral-muted dark:text-dk-muted">
          Sin datos de aire para este polígono todavía.
        </p>
      </div>
    );
  }

  const ratio = ultima.no2_relativo_bbox;
  const clamped = Math.max(MIN_RATIO, Math.min(MAX_RATIO, ratio));
  const posicionPct = ((clamped - MIN_RATIO) / (MAX_RATIO - MIN_RATIO)) * 100;
  const color = colorPorRatio(ratio);
  const etiqueta = etiquetaPorRatio(ratio);

  // Posiciones de los cortes 0.9 y 1.1 sobre el eje (en %).
  const corte09 = ((0.9 - MIN_RATIO) / (MAX_RATIO - MIN_RATIO)) * 100;
  const corte11 = ((1.1 - MIN_RATIO) / (MAX_RATIO - MIN_RATIO)) * 100;

  const tooltip = `Dióxido de nitrógeno (NO2) detectado por Sentinel-5P TROPOMI. Promedio ${ultima.anio}, relativo al promedio de Posadas. Valores > 1 indican más contaminación local que el promedio de la ciudad.`;

  return (
    <div
      className="flex flex-col gap-2"
      title={tooltip}
      aria-label={`Calidad del aire: NO2 relativo al promedio de Posadas ${ratio.toFixed(2)}. ${etiqueta}.`}
    >
      <div>
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          Calidad del aire
        </h3>
        <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
          Detecta dióxido de nitrógeno{" "}
          (<TerminoGlosario id="no2">NO₂</TerminoGlosario>), principal
          contaminante del tránsito vehicular y de la combustión.
        </p>
      </div>
      <div className="rounded-md border border-neutral-border p-4 dark:border-dk-border dark:bg-dk-elevated/40">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-bold" style={{ color }}>
            {ratio.toFixed(2)}
            {"×"}
          </span>
          <span className="text-[11px] uppercase tracking-wider text-secondary dark:text-dk-muted">
            vs promedio Posadas
          </span>
        </div>

        {/* Barra con tres zonas de color. La pista (track) usa un gris en
            light y un slate oscuro en dark para que las zonas semánticas
            verde/amarillo/naranja se sigan leyendo bien. */}
        <div
          className="relative mt-3 h-3 w-full overflow-hidden rounded-full bg-neutral-border dark:bg-dk-border"
          aria-hidden="true"
        >
          <div
            className="absolute left-0 top-0 h-full"
            style={{
              width: `${corte09}%`,
              backgroundColor: COLOR_MEJOR,
              opacity: 0.45,
            }}
          />
          <div
            className="absolute top-0 h-full"
            style={{
              left: `${corte09}%`,
              width: `${corte11 - corte09}%`,
              backgroundColor: COLOR_SIMILAR,
              opacity: 0.5,
            }}
          />
          <div
            className="absolute top-0 h-full"
            style={{
              left: `${corte11}%`,
              right: 0,
              backgroundColor: COLOR_PEOR,
              opacity: 0.5,
            }}
          />
          {/* Marker del valor actual. El boxShadow blanco se reemplaza
              en dark por el color de surface oscuro para que el "halo" no
              destaque como un parche claro sobre el fondo dark. */}
          <div
            className="absolute top-[-3px] h-[18px] w-[3px] rounded-sm shadow-[0_0_0_2px_#ffffff] dark:shadow-[0_0_0_2px_#161d2f]"
            style={{
              left: `calc(${posicionPct}% - 1.5px)`,
              backgroundColor: color,
            }}
          />
        </div>

        <div className="mt-1 flex justify-between text-[10px] text-neutral-muted dark:text-dk-muted">
          <span>{MIN_RATIO.toFixed(1)}</span>
          <span>0.9</span>
          <span>1.1</span>
          <span>{MAX_RATIO.toFixed(1)}</span>
        </div>

        <p className="mt-3 text-xs font-medium text-primary dark:text-dk-primary">
          {etiqueta}
        </p>
        <p className="mt-1 text-[11px] text-neutral-muted dark:text-dk-muted">
          Concentración medida: {formatoCientifico(ultima.no2_mean_mol_m2)}{" "}
          mol/m{"²"} ({ultima.anio}). <em>Datos: Sentinel-5P TROPOMI, ESA</em>.
        </p>
      </div>
    </div>
  );
}
