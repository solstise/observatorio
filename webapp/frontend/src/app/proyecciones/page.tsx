// Página /proyecciones — proyecciones a 2027 / 2030 / 2035 por barrio.
//
// Server Component que carga en paralelo:
//   - Las proyecciones (data/processed/proyecciones/proyecciones.csv)
//   - El histórico necesario (serie_temporal, poblacion, mapbiomas, uhi)
//   - El GeoJSON de polígonos para resolver nombres legibles
//
// La interactividad (selector de métrica + barrio + render del chart)
// vive en `ClientProyecciones.tsx`.
//
// El CSV detrás de esta página lo produce scripts/59_proyecciones_futuras.py
// con una regresión lineal y otra exponencial por (polígono × métrica),
// eligiendo el modelo de mayor R² (con bonus por simplicidad para el
// lineal cuando Δ R² < 0.05). El IC del 95 % se computa con la fórmula
// analítica de prediction-interval OLS y un factor Student-t (n-2 g.l.).
//
// Importante: la página comunica explícitamente las limitaciones del
// modelo. Series cortas (8 años) no soportan extrapolar 10 años a
// 2035 con seguridad — la idea es exponer la incertidumbre, no
// disfrazarla.

import Link from "next/link";
import type { Metadata } from "next";

import { Disclaimer } from "@/components/Disclaimer";
import {
  getMapBiomas,
  getPoblacion,
  getPoligonosBarrios,
  getProyecciones,
  getSerieTemporal,
  getUhiEstacional,
} from "@/lib/data.server";
import type {
  MapBiomasRow,
  PoblacionRow,
  PoligonoFeature,
  ProyeccionMetrica,
  ProyeccionRow,
  SerieTemporalRow,
  UhiEstacionalRow,
} from "@/lib/types";

import { ClientProyecciones } from "./ClientProyecciones";

export const metadata: Metadata = {
  title: "Proyecciones a 2027 / 2030 / 2035",
  description:
    "Proyecciones a futuro por barrio en Posadas: viviendas, población, cobertura urbana y UHI verano. Modelos lineal/exponencial con intervalo de confianza 95 % calibrado sobre el histórico.",
};

// Construye el "histórico" para una métrica/polígono dado, en formato
// {anio, valor} — homogéneo y reutilizable por el chart.
function historicoViviendas(
  serie: SerieTemporalRow[],
  poligonoId: string,
): Array<{ anio: number; valor: number }> {
  return serie
    .filter((r) => r.poligono_id === poligonoId)
    .map((r) => ({ anio: r.anio, valor: r.edificios_total }))
    .sort((a, b) => a.anio - b.anio);
}

function historicoPoblacion(
  pob: PoblacionRow[],
  poligonoId: string,
): Array<{ anio: number; valor: number }> {
  return pob
    .filter((r) => r.poligono_id === poligonoId)
    .map((r) => ({ anio: r.anio, valor: r.poblacion_estimada }))
    .sort((a, b) => a.anio - b.anio);
}

function historicoUrbano(
  mb: MapBiomasRow[],
  poligonoId: string,
): Array<{ anio: number; valor: number }> {
  return mb
    .filter((r) => r.poligono_id === poligonoId)
    .map((r) => ({ anio: r.anio, valor: r.pct_urbano }))
    .sort((a, b) => a.anio - b.anio);
}

function historicoUhi(
  uhi: UhiEstacionalRow[],
  poligonoId: string,
): Array<{ anio: number; valor: number }> {
  return uhi
    .filter((r) => r.poligono_id === poligonoId && r.estacion === "verano")
    .map((r) => ({ anio: r.anio, valor: r.uhi_vs_rural_mean }))
    .sort((a, b) => a.anio - b.anio);
}

// Genera el set completo de históricos por (poligono × métrica) para
// pasarlo serializado al cliente. Le ahorra al cliente cargar 4 CSV
// adicionales — todo viaja en el HTML inicial.
function buildHistoricos(
  features: PoligonoFeature[],
  serie: SerieTemporalRow[],
  pob: PoblacionRow[],
  mb: MapBiomasRow[],
  uhi: UhiEstacionalRow[],
): Record<string, Record<ProyeccionMetrica, Array<{ anio: number; valor: number }>>> {
  const out: Record<
    string,
    Record<ProyeccionMetrica, Array<{ anio: number; valor: number }>>
  > = {};
  for (const f of features) {
    const id = f.properties.id;
    out[id] = {
      viviendas: historicoViviendas(serie, id),
      poblacion: historicoPoblacion(pob, id),
      urbano: historicoUrbano(mb, id),
      uhi_verano: historicoUhi(uhi, id),
    };
  }
  return out;
}

// Helpers para los cuadros de honor (top 5).
interface FilaCrecimiento {
  poligono_id: string;
  nombre: string;
  base_2026: number | null;
  proyeccion_2035: number;
  delta_abs: number;
  delta_pct: number | null;
  confianza: string;
  modelo: string;
}

function topCrecimientoViviendas(
  proyecciones: ProyeccionRow[],
  serie: SerieTemporalRow[],
  features: PoligonoFeature[],
  limite = 5,
): FilaCrecimiento[] {
  const byId = new Map(features.map((f) => [f.properties.id, f]));
  // Última observación real disponible por polígono (típicamente 2025).
  const ultViv = new Map<string, number>();
  for (const r of serie) {
    const prev = ultViv.get(r.poligono_id);
    // Nos quedamos con el valor de mayor año.
    if (prev === undefined) {
      ultViv.set(r.poligono_id, r.edificios_total);
    }
  }
  // Recorremos serie ordenada para asegurar el último valor (no el primero).
  const sorted = [...serie].sort((a, b) => a.anio - b.anio);
  for (const r of sorted) {
    ultViv.set(r.poligono_id, r.edificios_total);
  }

  const proy2035 = proyecciones.filter(
    (r) => r.metrica === "viviendas" && r.anio_proyeccion === 2035,
  );
  const filas: FilaCrecimiento[] = proy2035.map((p) => {
    const base = ultViv.get(p.poligono_id) ?? null;
    const delta = base !== null ? p.valor_pred - base : p.valor_pred;
    const deltaPct = base && base > 0 ? (delta / base) * 100 : null;
    return {
      poligono_id: p.poligono_id,
      nombre: byId.get(p.poligono_id)?.properties.nombre ?? p.poligono_id,
      base_2026: base,
      proyeccion_2035: p.valor_pred,
      delta_abs: delta,
      delta_pct: deltaPct,
      confianza: p.confianza,
      modelo: p.modelo,
    };
  });
  // Ordenamos por delta absoluto desc (crecimiento neto, no porcentual —
  // un barrio que pasa de 50 a 200 tiene 300 % pero menos impacto que
  // uno que pasa de 4000 a 8000 con 100 %).
  return filas
    .sort((a, b) => b.delta_abs - a.delta_abs)
    .slice(0, limite);
}

function topCalentamientoUhi(
  proyecciones: ProyeccionRow[],
  features: PoligonoFeature[],
  limite = 5,
): FilaCrecimiento[] {
  const byId = new Map(features.map((f) => [f.properties.id, f]));
  // Para UHI mostramos directamente el valor proyectado (no un delta);
  // el "riesgo" se interpreta como UHI alto en absoluto.
  const proy2035 = proyecciones.filter(
    (r) => r.metrica === "uhi_verano" && r.anio_proyeccion === 2035,
  );
  // Si no hay suficientes a 2035 (UHI baja confianza filtra), caemos a 2030.
  const proy = proy2035.length >= limite
    ? proy2035
    : proyecciones.filter(
        (r) => r.metrica === "uhi_verano" && r.anio_proyeccion === 2030,
      );

  const filas: FilaCrecimiento[] = proy.map((p) => ({
    poligono_id: p.poligono_id,
    nombre: byId.get(p.poligono_id)?.properties.nombre ?? p.poligono_id,
    base_2026: null,
    proyeccion_2035: p.valor_pred,
    delta_abs: p.valor_pred,
    delta_pct: null,
    confianza: p.confianza,
    modelo: p.modelo,
  }));
  return filas
    .sort((a, b) => b.proyeccion_2035 - a.proyeccion_2035)
    .slice(0, limite);
}

function fmtInt(n: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "s/d";
  return Math.round(n).toLocaleString("es-AR");
}

function fmtPct(n: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "s/d";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)} %`;
}

function fmtUhi(n: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "s/d";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)} °C`;
}

export default async function ProyeccionesPage() {
  const [proyecciones, collection, serie, pob, mb, uhi] = await Promise.all([
    getProyecciones(),
    getPoligonosBarrios(),
    getSerieTemporal(),
    getPoblacion(),
    getMapBiomas(),
    getUhiEstacional(),
  ]);

  const tieneDatos = proyecciones.length > 0;
  const features = collection.features;

  const historicos = buildHistoricos(features, serie, pob, mb, uhi);
  const topViv = tieneDatos
    ? topCrecimientoViviendas(proyecciones, serie, features)
    : [];
  const topUhi = tieneDatos
    ? topCalentamientoUhi(proyecciones, features)
    : [];

  // Estadísticas resumen para el header.
  const nFilas = proyecciones.length;
  const nPolUnicos = new Set(proyecciones.map((r) => r.poligono_id)).size;
  const distModelo = proyecciones.reduce<Record<string, number>>((acc, r) => {
    acc[r.modelo] = (acc[r.modelo] ?? 0) + 1;
    return acc;
  }, {});
  const distConfianza = proyecciones.reduce<Record<string, number>>((acc, r) => {
    acc[r.confianza] = (acc[r.confianza] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <Disclaimer />
      <main className="container-obs py-8">
        <nav
          aria-label="Migas"
          className="mb-4 text-sm text-secondary dark:text-dk-muted"
        >
          <Link href="/" className="hover:underline">
            Mapa
          </Link>{" "}
          <span aria-hidden>/</span>{" "}
          <span className="text-neutral-muted dark:text-dk-muted">
            Proyecciones
          </span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Proyecciones — modelo estadístico
          </p>
          <h1
            className="mt-2 font-bold text-primary dark:text-dk-primary"
            style={{ fontSize: "var(--fs-h1)" }}
          >
            Proyecciones a 2027 / 2030 / 2035
          </h1>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Para cada barrio se ajusta una <strong>regresión lineal</strong> y
            otra <strong>exponencial</strong> sobre la serie histórica, y se
            elige el modelo con mayor R² (con bonus por simplicidad para el
            lineal cuando la diferencia es menor a 0.05). El intervalo de
            confianza del 95 % surge de la fórmula analítica de
            prediction-interval OLS — la banda se ensancha a medida que se
            extrapola más lejos del histórico.
          </p>
          <div className="mt-4 rounded-md border border-accent-200 bg-accent-50 p-3 text-sm text-neutral-text dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100">
            <strong>Importante:</strong> son proyecciones estadísticas que{" "}
            <em>asumen continuidad</em> de la tendencia histórica de 8 años.
            Cambios estructurales (políticas públicas, eventos climáticos,
            crisis económicas, migraciones masivas) <strong>NO se modelan</strong>.
            El intervalo de confianza es el de la regresión y NO incluye la
            incertidumbre sobre la elección del modelo (epistemic uncertainty).
            Para 2035 (10 años de extrapolación) la incertidumbre real es
            mayor a la mostrada — usar con criterio.
          </div>
        </header>

        {!tieneDatos && (
          <div
            role="status"
            className="card border-accent-200 bg-accent-50 text-sm dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100"
          >
            Las proyecciones están en preparación. Corré{" "}
            <code>scripts/59_proyecciones_futuras.py</code> y luego{" "}
            <code>scripts/80_sync_webapp.py</code> para poblar los datos.
          </div>
        )}

        {tieneDatos && (
          <>
            {/* Resumen estadístico del set de proyecciones */}
            <section
              aria-label="Resumen estadístico de las proyecciones"
              className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4"
            >
              <ResumenTile
                label="Filas totales"
                valor={fmtInt(nFilas)}
                detalle={`${nPolUnicos} barrios`}
              />
              <ResumenTile
                label="Modelo lineal"
                valor={fmtInt(distModelo["lineal"] ?? 0)}
                detalle={
                  distModelo["exp"] !== undefined
                    ? `vs ${distModelo["exp"]} exp`
                    : "vs 0 exp"
                }
              />
              <ResumenTile
                label="Confianza alta/media"
                valor={fmtInt((distConfianza["alta"] ?? 0) + (distConfianza["media"] ?? 0))}
                detalle={`${distConfianza["baja"] ?? 0} en baja`}
              />
              <ResumenTile
                label="Horizonte"
                valor="2027–2035"
                detalle="3 años proyectados"
              />
            </section>

            {/* Selector + chart interactivo */}
            <section
              aria-label="Visor interactivo de proyecciones"
              className="mb-10"
            >
              <ClientProyecciones
                proyecciones={proyecciones}
                historicos={historicos}
                features={features}
              />
            </section>

            {/* Top 5 crecimiento viviendas + Top 5 UHI */}
            <section className="mb-10 grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border border-neutral-border bg-white p-4 shadow-sm dark:border-dk-border dark:bg-dk-surface">
                <h2 className="mb-3 text-base font-semibold text-primary dark:text-dk-primary">
                  Top 5 — mayor crecimiento de viviendas a 2035
                </h2>
                <p className="mb-3 text-xs text-neutral-text dark:text-dk-text">
                  Crecimiento absoluto desde el último valor real (≈ 2025)
                  hasta la proyección 2035. Ordenado por viviendas netas
                  ganadas — no por % — para reflejar el impacto territorial
                  real, no el efecto de bases pequeñas.
                </p>
                <ol className="space-y-2 text-sm">
                  {topViv.map((f, idx) => (
                    <li
                      key={f.poligono_id}
                      className="flex items-center justify-between gap-2 rounded border border-neutral-border/60 bg-primary-50/40 p-2 dark:border-dk-border/60 dark:bg-dk-elevated/40"
                    >
                      <div className="flex items-baseline gap-2 truncate">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">
                          {idx + 1}
                        </span>
                        <Link
                          href={`/poligono/${f.poligono_id}`}
                          className="truncate font-medium text-primary hover:underline dark:text-dk-primary"
                        >
                          {f.nombre}
                        </Link>
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        <span className="font-semibold tabular-nums text-primary dark:text-dk-primary">
                          +{fmtInt(f.delta_abs)} viv
                        </span>
                        {f.delta_pct !== null && (
                          <span className="ml-1 text-neutral-muted dark:text-dk-muted">
                            ({fmtPct(f.delta_pct)})
                          </span>
                        )}
                        <p className="text-[10px] text-neutral-muted dark:text-dk-muted">
                          {f.confianza}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-md border border-neutral-border bg-white p-4 shadow-sm dark:border-dk-border dark:bg-dk-surface">
                <h2 className="mb-3 text-base font-semibold text-primary dark:text-dk-primary">
                  Top 5 — mayor riesgo de calentamiento (UHI verano)
                </h2>
                <p className="mb-3 text-xs text-neutral-text dark:text-dk-text">
                  UHI verano vs rural proyectada al horizonte más lejano que
                  el modelo permita (2035 si la confianza alcanza, si no
                  2030). UHI alto = el barrio se calienta significativamente
                  más que el campo, riesgo creciente para salud.
                </p>
                <ol className="space-y-2 text-sm">
                  {topUhi.map((f, idx) => (
                    <li
                      key={f.poligono_id}
                      className="flex items-center justify-between gap-2 rounded border border-neutral-border/60 bg-primary-50/40 p-2 dark:border-dk-border/60 dark:bg-dk-elevated/40"
                    >
                      <div className="flex items-baseline gap-2 truncate">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">
                          {idx + 1}
                        </span>
                        <Link
                          href={`/poligono/${f.poligono_id}`}
                          className="truncate font-medium text-primary hover:underline dark:text-dk-primary"
                        >
                          {f.nombre}
                        </Link>
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        <span className="font-semibold tabular-nums text-primary dark:text-dk-primary">
                          {fmtUhi(f.proyeccion_2035)}
                        </span>
                        <p className="text-[10px] text-neutral-muted dark:text-dk-muted">
                          {f.confianza} · {f.modelo}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
                {topUhi.some((f) => f.confianza === "baja") && (
                  <p className="mt-3 text-[11px] italic text-rose-600 dark:text-rose-300">
                    UHI tiene tendencias ruidosas y muchos barrios caen en
                    confianza &quot;baja&quot;. Tomar como hipótesis, no como
                    predicción robusta.
                  </p>
                )}
              </div>
            </section>

            {/* Tabla resumen */}
            <section
              aria-labelledby="tabla-resumen"
              className="mb-10 rounded-md border border-neutral-border bg-white shadow-sm dark:border-dk-border dark:bg-dk-surface"
            >
              <header className="border-b border-neutral-border p-4 dark:border-dk-border">
                <h2
                  id="tabla-resumen"
                  className="text-base font-semibold text-primary dark:text-dk-primary"
                >
                  Tabla resumen — viviendas proyectadas
                </h2>
                <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
                  Valores 2027 / 2030 / 2035 (con IC 95 % entre paréntesis)
                  para todos los barrios.
                </p>
              </header>
              <TablaResumen
                proyecciones={proyecciones.filter(
                  (r) => r.metrica === "viviendas",
                )}
                features={features}
              />
            </section>
          </>
        )}

        <section className="mt-10 space-y-3 border-t border-neutral-border pt-6 text-sm text-neutral-text dark:border-dk-border dark:text-dk-text">
          <h2 className="text-lg font-semibold text-primary dark:text-dk-primary">
            Cómo se construye la proyección
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Series históricas</strong>: viviendas (2018–2025, Open
              Buildings + Microsoft + EE), población (estimación
              poblacional escalada con WorldPop), % cobertura urbana
              (MapBiomas Argentina Col.1, 1998–2022), UHI verano (Landsat
              C2L2, 2018–2025).{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Script: <code>59_proyecciones_futuras.py</code>.
              </span>
            </li>
            <li>
              <strong>Selección de modelo</strong>: para cada (barrio ×
              métrica) se ajustan dos regresiones por OLS — lineal{" "}
              <code>y = a + b·t</code> y log-lineal (exponencial){" "}
              <code>log(y) = a + b·t</code>. Se elige el de mayor R²
              calculado en escala original. Para empates dentro de 0.05 puntos
              se prefiere el lineal (Occam: ambos modelos cuentan
              esencialmente la misma historia, ganamos en interpretabilidad).
            </li>
            <li>
              <strong>Intervalo de confianza 95 %</strong>: usamos la fórmula
              analítica de prediction-interval OLS,{" "}
              <code>SE = √(s² · (1 + 1/n + (t − t̄)² / Sxx))</code>, con
              ampliación Student-t (n−2 grados de libertad) al percentil
              0.975. Para modelos exponenciales el cálculo se hace en
              log-espacio y luego se anti-loguea (banda asimétrica en escala
              original).
            </li>
            <li>
              <strong>Confianza por R²</strong>: alta si R² ≥ 0.85, media
              entre 0.55 y 0.85, baja por debajo. Para UHI con confianza
              baja NO proyectamos a 2035 — la extrapolación a 10 años con
              R² ruidoso es deshonesta.
            </li>
            <li>
              <strong>Limitaciones honestas</strong>: 8 años son pocos para
              proyectar 10 a futuro; el IC mostrado es solo el de la
              regresión (no captura epistemic uncertainty); los % saturados
              cerca de 100 generan pendientes cercanas a cero con R²
              inestable; cambios estructurales no se modelan.
            </li>
            <li>
              <strong>Para qué NO sirve</strong>: no es un instrumento de
              gestión individual ni un sustituto de planificación
              participativa. Es un insumo cuantitativo para diálogo
              técnico-político sobre el horizonte de 5–10 años.
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}

// Tile compacto del resumen estadístico al inicio.
function ResumenTile({
  label,
  valor,
  detalle,
}: {
  label: string;
  valor: string;
  detalle?: string;
}) {
  return (
    <div className="rounded-md border border-neutral-border bg-white p-3 shadow-sm dark:border-dk-border dark:bg-dk-surface">
      <p className="text-[11px] uppercase tracking-wider text-secondary dark:text-dk-muted">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-primary dark:text-dk-primary">
        {valor}
      </p>
      {detalle && (
        <p className="text-[10px] text-neutral-muted dark:text-dk-muted">
          {detalle}
        </p>
      )}
    </div>
  );
}

// Tabla resumen estática (server-rendered) — no es interactiva, solo
// muestra todos los barrios con sus 3 horizontes.
function TablaResumen({
  proyecciones,
  features,
}: {
  proyecciones: ProyeccionRow[];
  features: PoligonoFeature[];
}) {
  const byId = new Map(features.map((f) => [f.properties.id, f]));
  // Agrupamos por polígono y luego pivotamos por año.
  const porPoligono = new Map<string, Record<number, ProyeccionRow>>();
  for (const r of proyecciones) {
    const m = porPoligono.get(r.poligono_id) ?? {};
    m[r.anio_proyeccion] = r;
    porPoligono.set(r.poligono_id, m);
  }
  const filas = Array.from(porPoligono.entries())
    .map(([id, anios]) => ({
      poligono_id: id,
      nombre: byId.get(id)?.properties.nombre ?? id,
      a2027: anios[2027],
      a2030: anios[2030],
      a2035: anios[2035],
    }))
    .sort((a, b) => {
      const va = a.a2035?.valor_pred ?? 0;
      const vb = b.a2035?.valor_pred ?? 0;
      return vb - va;
    });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-border bg-neutral-50 text-left text-xs uppercase tracking-wider text-secondary dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted">
          <tr>
            <th scope="col" className="px-3 py-2">
              Polígono
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              2027
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              2030
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              2035
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Modelo / R²
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Confianza
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            // Tomamos un row "representativo" (preferentemente 2030) para
            // mostrar modelo/confianza — los tres años comparten estos.
            const ref = f.a2030 ?? f.a2027 ?? f.a2035;
            return (
              <tr
                key={f.poligono_id}
                className="border-b border-neutral-border/60 last:border-0 hover:bg-neutral-50 dark:border-dk-border/60 dark:hover:bg-dk-elevated/60"
              >
                <th
                  scope="row"
                  className="px-3 py-2 text-left font-medium text-primary dark:text-dk-primary"
                >
                  <Link
                    href={`/poligono/${f.poligono_id}`}
                    className="hover:underline"
                  >
                    {f.nombre}
                  </Link>
                </th>
                <td className="px-3 py-2 text-right tabular-nums">
                  <CeldaProyeccion row={f.a2027} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <CeldaProyeccion row={f.a2030} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <CeldaProyeccion row={f.a2035} />
                </td>
                <td className="px-3 py-2 text-right text-xs">
                  {ref ? (
                    <>
                      <span className="font-medium">{ref.modelo}</span>
                      {ref.r2 !== null && ref.r2 !== undefined && (
                        <span className="ml-1 text-neutral-muted dark:text-dk-muted">
                          {ref.r2.toFixed(3)}
                        </span>
                      )}
                    </>
                  ) : (
                    "s/d"
                  )}
                </td>
                <td className="px-3 py-2 text-right text-xs">
                  {ref ? (
                    <BadgeConfianza confianza={ref.confianza} />
                  ) : (
                    "s/d"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CeldaProyeccion({ row }: { row: ProyeccionRow | undefined }) {
  if (!row) return <span className="text-neutral-muted">—</span>;
  return (
    <div>
      <span className="font-semibold text-primary dark:text-dk-primary">
        {Math.round(row.valor_pred).toLocaleString("es-AR")}
      </span>
      <p className="text-[10px] text-neutral-muted dark:text-dk-muted">
        ({Math.round(row.ci_inferior).toLocaleString("es-AR")} –{" "}
        {Math.round(row.ci_superior).toLocaleString("es-AR")})
      </p>
    </div>
  );
}

function BadgeConfianza({ confianza }: { confianza: string }) {
  const cfg = {
    alta: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100",
    media: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100",
    baja: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-100",
  }[confianza] ?? "bg-neutral-100 text-neutral-700";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg}`}
    >
      {confianza}
    </span>
  );
}
