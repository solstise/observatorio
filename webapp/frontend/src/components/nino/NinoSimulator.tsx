"use client";

import type { NinoHydro, NinoRain, NinoWrf } from "@/lib/nino-types";
import type { SmnAlert } from "@/lib/nino-live/parse";
import { type Amc, barrioRunoff, cityRunoff } from "@/lib/nino-escurrimiento";
import { formatNinoNumber as num } from "@/lib/nino-presentation";
import styles from "./nino.module.css";

const POOL_M3 = 2500; // pileta olímpica: 50 × 25 × 2 m
const SOIL_COPY: Record<Amc, { label: string; fill: number }> = {
  I: { label: "Seco", fill: 0.22 },
  II: { label: "Normal", fill: 0.55 },
  III: { label: "Muy mojado", fill: 0.9 },
};

// Esponja de suelo: cuanto más mojada, menos agua puede absorber.
function SoilSponge({ amc }: { amc: Amc }) {
  const fill = SOIL_COPY[amc].fill;
  return <svg className={styles.sponge} viewBox="0 0 160 90" aria-hidden="true">
    <defs><clipPath id="sponge-clip"><rect x="4" y="18" width="152" height="68" rx="10" /></clipPath></defs>
    <rect x="4" y="18" width="152" height="68" rx="10" className={styles.spongeSoil} />
    <g clipPath="url(#sponge-clip)">
      <g className={styles.gaugeWater} style={{ transform: `translateY(${(1 - fill) * 68 + 18}px)` }}>
        <path className={styles.gaugeWave} d="M-40 0 q10 -5 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 V90 H-40 Z" opacity=".75" />
      </g>
      {Array.from({ length: 18 }, (_, i) => <circle key={i} cx={14 + (i % 6) * 26 + (Math.floor(i / 6) % 2) * 12} cy={32 + Math.floor(i / 6) * 18} r="4" className={styles.spongePore} />)}
    </g>
    {[0, 1, 2].map(i => <path key={i} className={styles.spongeDrop} style={{ animationDelay: `${i * 0.5}s` }} d={`M${50 + i * 30} 2 q4 6 0 10 q-4 -4 0 -10`} />)}
  </svg>;
}

export function NinoSimulator({ hydro, rain, wrf, alert, mm5days, todayAmc, amc, onAmc, mm, onMm, selectedId, onSelect }: {
  hydro: NinoHydro | null; rain: NinoRain | undefined; wrf: NinoWrf | undefined; alert: SmnAlert | undefined;
  mm5days: number | null; todayAmc: Amc | null; amc: Amc; onAmc: (amc: Amc) => void;
  mm: number; onMm: (mm: number) => void; selectedId: string; onSelect: (id: string) => void;
}) {
  if (!hydro?.barrios.length) return null;
  const barrios = hydro.barrios;
  const city = cityRunoff(barrios, mm, amc);
  const cityArea = barrios.reduce((s, b) => s + b.area_m2, 0);
  const cityPct = (q: number) => (mm > 0 ? Math.round((((q / cityArea) * 1000) / mm) * 100) : 0);
  const selected = barrios.find(b => b.poligono_id === selectedId) ?? [...barrios].sort((a, b) => barrioRunoff(b, mm, amc).porcentaje[1] - barrioRunoff(a, mm, amc).porcentaje[1])[0];
  const r = barrioRunoff(selected, mm, amc);
  const ranking = [...barrios].map(b => ({ b, r: barrioRunoff(b, mm, amc) })).sort((x, y) => y.r.porcentaje[1] - x.r.porcentaje[1]).slice(0, 5);
  const wrfMax = wrf?.estado === "disponible" ? Math.max(0, ...(wrf.dias ?? []).filter(d => d.horas >= 12).map(d => d.max_zona)) : 0;
  const presets: Array<{ label: string; value: number; kind: string }> = [
    rain ? { label: "Pronóstico central", value: Math.round(rain.lluvia_24h), kind: "central" } : null,
    rain?.lluvia_24h_p90 ? { label: "Escenario alto", value: Math.round(rain.lluvia_24h_p90), kind: "alto" } : null,
    alert?.lluvia_mm ? { label: `SMN: hasta ${alert.lluvia_mm[1]} mm`, value: alert.lluvia_mm[1], kind: "smn" } : null,
    wrfMax ? { label: "Modelo del SMN", value: Math.round(wrfMax), kind: "wrf" } : null,
    mm5days != null ? { label: "Lo que llovió en 5 días", value: Math.round(mm5days), kind: "medido" } : null,
  ].filter((p): p is { label: string; value: number; kind: string } => !!p && p.value > 0);
  const pct = (v: number) => `${Math.min(100, (v / 150) * 100)}%`;

  return <section id="simulador" className={styles.card} aria-labelledby="sim-title">
    <div className={styles.cardHead}>
      <h2 id="sim-title" className={styles.cardTitle}>¿Y si llueve más?</h2>
      <span className={styles.cardMeta}>estimación, no pronóstico</span>
    </div>

    <div className={styles.soilRow}>
      <SoilSponge amc={amc} />
      <div>
        <p className={styles.smallLine}>El suelo {todayAmc === amc ? "hoy" : "en esta prueba"}</p>
        <p className={styles.bigLine}>{SOIL_COPY[amc].label}</p>
        {todayAmc && <p className={styles.smallLine}>{num(Math.round(mm5days ?? 0))} mm medidos en 5 días.</p>}
      </div>
    </div>
    <div className={styles.segmented} role="group" aria-label="Probá con otro estado del suelo">
      {(["I", "II", "III"] as const).map(level => <button key={level} type="button" aria-pressed={amc === level} onClick={() => onAmc(level)}>{SOIL_COPY[level].label}{todayAmc === level ? " (hoy)" : ""}</button>)}
    </div>

    <div className={styles.sliderBlock}>
      <label htmlFor="sim-mm" className={styles.sliderLabel}>Lluvia en un día: <strong>{mm} mm</strong></label>
      <div className={styles.sliderWrap}>
        {alert?.lluvia_mm && <span className={styles.sliderBand} style={{ left: pct(alert.lluvia_mm[0]), width: `calc(${pct(alert.lluvia_mm[1])} - ${pct(alert.lluvia_mm[0])})` }} title="Rango que anuncia el SMN" />}
        <input id="sim-mm" type="range" min={0} max={150} step={1} value={mm} onChange={event => onMm(Number(event.target.value))} className={styles.slider} />
      </div>
      <div className={styles.presets}>{presets.map(p => <button key={p.kind} type="button" className={styles.preset} data-kind={p.kind} aria-pressed={mm === p.value} onClick={() => onMm(p.value)}>{p.label}<strong>{p.value} mm</strong></button>)}</div>
    </div>

    <div className={styles.simResults}>
      <div className={styles.simCity}>
        <p className={styles.smallLine}>En toda la ciudad correrían por calles y arroyos</p>
        <p className={styles.bigLine}>{num(Math.round(city[0] / POOL_M3))} a {num(Math.round(city[1] / POOL_M3))} piletas olímpicas</p>
        <p className={styles.smallLine}>De cada 100 litros que caen, entre {cityPct(city[0])} y {cityPct(city[1])} no los absorbe el suelo.</p>
        <div className={styles.flowBar} aria-hidden="true"><span style={{ width: `${cityPct(city[0])}%` }} /><span style={{ width: `${Math.max(0, cityPct(city[1]) - cityPct(city[0]))}%` }} data-range="1" /></div>
      </div>
      <div className={styles.simBarrio}>
        <label htmlFor="sim-barrio" className={styles.smallLine}>En el barrio</label>
        <select id="sim-barrio" value={selected.poligono_id} onChange={event => onSelect(event.target.value)} className={styles.select}>
          {[...barrios].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map(b => <option key={b.poligono_id} value={b.poligono_id}>{b.nombre}</option>)}
        </select>
        <p className={styles.bigLine}>{r.porcentaje[0] === r.porcentaje[1] ? r.porcentaje[0] : `${r.porcentaje[0]} a ${r.porcentaje[1]}`} de cada 100 litros</p>
        <p className={styles.smallLine}>corren por la superficie ({num(Math.round(r.mm[0]))}–{num(Math.round(r.mm[1]))} mm).</p>
        <div className={styles.flowBar} aria-hidden="true"><span style={{ width: `${r.porcentaje[0]}%` }} /><span style={{ width: `${Math.max(0, r.porcentaje[1] - r.porcentaje[0])}%` }} data-range="1" /></div>
      </div>
    </div>
    <ol className={styles.ranking} aria-label="Barrios donde más agua escurre">
      {ranking.map(({ b, r: rr }) => <li key={b.poligono_id}><button type="button" onClick={() => onSelect(b.poligono_id)} aria-pressed={b.poligono_id === selected.poligono_id}><span>{b.nombre}</span><span className={styles.rankBar}><i style={{ width: `${rr.porcentaje[1]}%` }} /></span><strong>{rr.porcentaje[1]}%</strong></button></li>)}
    </ol>

    <details className={styles.details}>
      <summary>Cómo se calcula y qué no sabemos</summary>
      <div className={styles.detailsBody}>
        <p>Usamos el método del número de curva del Servicio de Conservación de Suelos de EE. UU. (USDA, TR-55), un estándar de hidrología urbana. Para cada barrio combina cuánto suelo está techado o construido con el tipo de suelo, y lo ajusta según lo que llovió en los últimos 5 días.</p>
        <p>Damos un rango porque no hay mapas oficiales de suelo ni de superficie impermeable para Posadas. El extremo bajo cuenta solo los techos (huellas de edificios de Google y Microsoft); el alto, el tamaño de los lotes y un suelo más arcilloso.</p>
        <p><strong>Lo que no sabemos:</strong> la capacidad de los desagües pluviales de la ciudad no es pública, así que no podemos decir si la red alcanza. Tampoco modelamos hacia dónde corre el agua dentro de cada barrio. Sirve para comparar barrios y escenarios, no para predecir una inundación en una calle.</p>
      </div>
    </details>
  </section>;
}
