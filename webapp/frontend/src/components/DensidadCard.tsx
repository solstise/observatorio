// Card de densidad volumétrica (Capa 1).
//
// Datos: scripts/capas_avanzadas/compute_capas.cjs → tipologia/densidad_volumetrica.csv.
// `altura_estimada_m` se infiere por categoría urbana del barrio (consolidado,
// emergente, expansión) cruzada con la retrodispersión Sentinel-1 promedio
// (más backscatter ≈ más volumen edificado). `m3_total` = edificios_2026 *
// área_promedio_edificio * altura_estimada; `m3_por_km2` normaliza por área.
//
// Distribución en 3 buckets (baja <4m, media 4-6m, alta >6m) inspirada en
// tipologías típicas de Posadas: vivienda planta baja ~3m, dúplex/PA ~6m,
// edificios en altura >6m (mayormente en el centro y costanera).

import type { DensidadVolumetricaRow, PoligonoFeature } from "@/lib/types";

interface DensidadCardProps {
  rows: DensidadVolumetricaRow[];
  features: PoligonoFeature[];
}

interface Bucket {
  key: "baja" | "media" | "alta";
  label: string;
  rango: string;
  color: string;
}

const BUCKETS: Bucket[] = [
  { key: "baja", label: "Baja", rango: "<4 m", color: "#cbd7e4" },
  { key: "media", label: "Media", rango: "4-6 m", color: "#5a7a9c" },
  { key: "alta", label: "Alta", rango: ">6 m", color: "#1a3a5c" },
];

function clasificar(alturaM: number): Bucket["key"] {
  if (alturaM < 4) return "baja";
  if (alturaM <= 6) return "media";
  return "alta";
}

function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "s/d";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} k`;
  return n.toFixed(0);
}

export function DensidadCard({ rows, features }: DensidadCardProps) {
  const nombreById = new Map(
    features.map((f) => [f.properties.id, f.properties.nombre]),
  );

  const conDato = rows.filter((r) =>
    Number.isFinite(r.altura_estimada_m as number),
  );

  // Conteo por bucket de altura.
  const counts: Record<Bucket["key"], number> = { baja: 0, media: 0, alta: 0 };
  conDato.forEach((r) => {
    counts[clasificar(r.altura_estimada_m)]++;
  });
  const maxCount = Math.max(1, ...Object.values(counts));
  const totalBarrios = conDato.length;

  const top5Densos = [...rows]
    .filter((r) => Number.isFinite(r.m3_por_km2))
    .sort((a, b) => b.m3_por_km2 - a.m3_por_km2)
    .slice(0, 5);

  const alturaMax = conDato.length
    ? Math.max(...conDato.map((r) => r.altura_estimada_m))
    : 0;

  return (
    <section
      aria-labelledby="capa1-densidad-titulo"
      className="card flex flex-col dark:border-dk-border dark:bg-dk-surface"
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2
            id="capa1-densidad-titulo"
            className="text-sm font-semibold text-primary dark:text-dk-primary"
          >
            Densidad volumétrica
          </h2>
          <p className="mt-1 text-xs text-neutral-muted dark:text-dk-muted">
            Distribución de altura estimada y barrios más densos (m³/km²).
          </p>
        </div>
        <span
          title="La altura se estima cruzando la categoría urbana del barrio con la retrodispersión Sentinel-1 (SAR). Más backscatter ≈ más volumen edificado. NO es altura medida con LiDAR."
          className="inline-flex shrink-0 cursor-help items-center rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary dark:bg-dk-elevated dark:text-dk-primary"
          aria-label="Información sobre cómo se estima la altura"
        >
          Cat + S1
        </span>
      </header>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Distribución de altura ({totalBarrios} barrios)
        </h3>
        <div
          className="flex items-end gap-2 h-24"
          role="img"
          aria-label={`Histograma de altura: ${BUCKETS.map(
            (b) => `${b.label} ${counts[b.key]}`,
          ).join(", ")}`}
        >
          {BUCKETS.map((b) => {
            const c = counts[b.key];
            const h = (c / maxCount) * 100;
            return (
              <div
                key={b.key}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-[10px] font-bold tabular-nums text-primary dark:text-dk-primary">
                  {c}
                </span>
                <div
                  className="w-full rounded-t-md"
                  style={{
                    height: `${h}%`,
                    backgroundColor: b.color,
                    minHeight: c > 0 ? "4px" : "0",
                  }}
                  aria-hidden="true"
                />
                <span className="text-[10px] font-medium text-neutral-text dark:text-dk-text">
                  {b.label}
                </span>
                <span className="text-[9px] text-neutral-muted dark:text-dk-muted">
                  {b.rango}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 rounded-md border border-neutral-border bg-neutral-50 px-3 py-2 text-xs text-neutral-text dark:border-dk-border dark:bg-dk-elevated dark:text-dk-text">
        Altura máxima estimada en la ciudad:{" "}
        <strong className="tabular-nums">{alturaMax.toFixed(1)} m</strong>.
      </div>

      <div className="mt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Top 5 — barrios más densos (m³/km²)
        </h3>
        {top5Densos.length === 0 ? (
          <p className="text-xs italic text-neutral-muted dark:text-dk-muted">
            Sin datos suficientes todavía.
          </p>
        ) : (
          <ol className="space-y-1.5" aria-label="Ranking de densidad volumétrica">
            {top5Densos.map((r, i) => {
              const pct = top5Densos[0]
                ? (r.m3_por_km2 / top5Densos[0].m3_por_km2) * 100
                : 0;
              return (
                <li
                  key={r.poligono_id}
                  className="flex items-center gap-2 rounded bg-primary-50/60 px-2 py-1.5 text-xs dark:bg-dk-elevated/50"
                >
                  <span className="w-4 text-[10px] font-mono tabular-nums text-neutral-muted dark:text-dk-muted">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate font-medium text-primary dark:text-dk-primary">
                    {nombreById.get(r.poligono_id) ?? r.poligono_id}
                  </span>
                  <div
                    className="flex h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-primary-100 dark:bg-dk-border"
                    aria-hidden="true"
                  >
                    <span
                      className="h-full bg-primary dark:bg-dk-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="shrink-0 tabular-nums text-neutral-text dark:text-dk-text">
                    {fmtCompact(r.m3_por_km2)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <footer className="mt-auto pt-3 text-[10px] text-neutral-muted dark:text-dk-muted">
        Fuente: <strong>Microsoft Global ML Building Footprints v6</strong>{" "}
        (~93 mil edificios reales para Posadas) + Sentinel-1 SAR para la
        altura. Huella media empírica: ~146 m². Script:{" "}
        <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-dk-elevated">
          compute_real_buildings.cjs
        </code>
        .
      </footer>
    </section>
  );
}
