"use client";

import type { NinoHydro, NinoRain, NinoWrf } from "@/lib/nino-types";
import type { SmnAlert } from "@/lib/nino-live/parse";
import { type Amc, barrioRunoff, cityRunoff } from "@/lib/nino-escurrimiento";
import { formatNinoNumber as num } from "@/lib/nino-presentation";
import styles from "./nino.module.css";

const SOIL_TODAY: Record<Amc, string> = { I: "seco", II: "normal", III: "saturado" };

// De cada 10 litros: cuántos van seguro a la calle, cuántos dependen de lo que no sabemos
// (cuánto suelo está cubierto) y cuántos absorbe la tierra.
function tenths(pct: [number, number]) {
  const low = Math.round(pct[0] / 10);
  const high = Math.max(low, Math.round(pct[1] / 10));
  return { low, high, text: low === high ? `Unos ${low}` : `Entre ${low} y ${high}` };
}

function Drops({ low, high }: { low: number; high: number }) {
  return <div className={styles.drops} aria-hidden="true">
    {Array.from({ length: 10 }, (_, i) => <svg key={i} viewBox="0 0 24 32" data-kind={i < low ? "calle" : i < high ? "quizas" : "suelo"}>
      <defs><pattern id={`rayas-${i}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.5" height="5" /></pattern></defs>
      <path d="M12 2c5 7 9 12.5 9 18a9 9 0 0 1-18 0c0-5.5 4-11 9-18Z" fill={i >= low && i < high ? `url(#rayas-${i})` : undefined} />
    </svg>)}
  </div>;
}

export function NinoSimulator({ hydro, rain, wrf, alert, mm5days, amc, mm, onMm, selectedId, onSelect, onShowPaths }: {
  hydro: NinoHydro | null; rain: NinoRain | undefined; wrf: NinoWrf | undefined; alert: SmnAlert | undefined;
  mm5days: number | null; amc: Amc | null; mm: number; onMm: (mm: number) => void;
  selectedId: string; onSelect: (id: string) => void; onShowPaths: () => void;
}) {
  if (!hydro?.barrios.length) return null;
  const barrios = hydro.barrios;
  const soil: Amc = amc ?? "II";
  const selected = barrios.find(b => b.poligono_id === selectedId) ?? null;
  const cityArea = barrios.reduce((s, b) => s + b.area_m2, 0);
  // Porcentaje que corre por la superficie, en un barrio o en toda la ciudad.
  const share = (level: Amc): { pct: [number, number]; mm: [number, number] } => {
    if (selected) {
      const r = barrioRunoff(selected, mm, level);
      return { pct: r.porcentaje, mm: r.mm };
    }
    const m3 = cityRunoff(barrios, mm, level);
    const depth = m3.map(q => (q / cityArea) * 1000) as [number, number];
    return { pct: depth.map(d => (mm > 0 ? Math.round((d / mm) * 100) : 0)) as [number, number], mm: depth };
  };
  const now = share(soil);
  const parts = tenths(now.pct);
  // El suelo solo dice algo en comparación: la misma lluvia con el suelo al revés.
  const other: Amc = soil === "I" ? "III" : "I";
  const otherParts = tenths(share(other).pct);
  // Una manzana es más o menos una hectárea: 1 mm sobre 1 ha son 10 tanques de 1.000 litros
  // (redondeado a decenas).
  const tanks = now.mm.map(d => Math.round(d) * 10);
  const middle = (b: (typeof barrios)[number]) => barrioRunoff(b, mm, soil).porcentaje.reduce((s, v) => s + v, 0) / 2;
  const rank = selected ? barrios.filter(b => middle(b) < middle(selected)).length / (barrios.length - 1) : null;
  const wrfMax = wrf?.estado === "disponible" ? Math.max(0, ...(wrf.dias ?? []).filter(d => d.horas >= 12).map(d => d.max_zona)) : 0;
  const presets: Array<{ label: string; value: number; kind: string }> = [
    rain ? { label: "Lo más probable", value: Math.round(rain.lluvia_24h), kind: "central" } : null,
    rain?.lluvia_24h_p90 ? { label: "Si viene fuerte", value: Math.round(rain.lluvia_24h_p90), kind: "alto" } : null,
    alert?.lluvia_mm ? { label: "Lo que avisa el SMN", value: alert.lluvia_mm[1], kind: "smn" }
      : wrfMax ? { label: "Modelo del SMN", value: Math.round(wrfMax), kind: "wrf" } : null,
  ].filter((p): p is { label: string; value: number; kind: string } => !!p && p.value > 0);
  const pct = (v: number) => `${Math.min(100, (v / 150) * 100)}%`;
  const where = selected ? `en ${selected.nombre}` : "en Posadas";

  return <section id="simulador" className={styles.card} aria-labelledby="sim-title">
    <div className={styles.cardHead}>
      <h2 id="sim-title" className={styles.cardTitle}>¿A dónde va la lluvia?</h2>
      <span className={styles.cardMeta}>estimación, no pronóstico</span>
    </div>

    <div className={styles.simSentence}>
      <label htmlFor="sim-mm">Si caen <strong>{mm} mm</strong> en un día</label>
      <select id="sim-barrio" aria-label="Barrio" value={selected?.poligono_id ?? ""} onChange={event => onSelect(event.target.value)} className={styles.select}>
        <option value="">en toda la ciudad</option>
        {[...barrios].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map(b => <option key={b.poligono_id} value={b.poligono_id}>en {b.nombre}</option>)}
      </select>
    </div>
    <div className={styles.sliderWrap}>
      {alert?.lluvia_mm && <span className={styles.sliderBand} style={{ left: pct(alert.lluvia_mm[0]), width: `calc(${pct(alert.lluvia_mm[1])} - ${pct(alert.lluvia_mm[0])})` }} title="Rango que anuncia el SMN" />}
      <input id="sim-mm" type="range" min={0} max={150} step={1} value={mm} onChange={event => onMm(Number(event.target.value))} className={styles.slider} />
    </div>
    <div className={styles.presets}>{presets.map(p => <button key={p.kind} type="button" className={styles.preset} data-kind={p.kind} aria-pressed={mm === p.value} onClick={() => onMm(p.value)}>{p.label}<strong>{p.value} mm</strong></button>)}</div>

    <div className={styles.simAnswer} role="img" aria-label={`${parts.text} de cada 10 litros van a la calle ${where}.`}>
      <p className={styles.bigLine}>{parts.text} de cada 10 litros van a la calle</p>
      <Drops low={parts.low} high={parts.high} />
      <p className={styles.dropsKey}>
        <span><i data-kind="calle" />a la calle</span>
        {parts.high > parts.low && <span><i data-kind="quizas" />depende de cuánto suelo está cubierto</span>}
        <span><i data-kind="suelo" />los absorbe la tierra</span>
      </p>
      {mm > 0 && <p className={styles.smallLine}>En una manzana son {tanks[0] === tanks[1] ? `unos ${num(tanks[0])}` : `entre ${num(tanks[0])} y ${num(tanks[1])}`} tanques de 1.000 litros.</p>}
    </div>
    <div className={styles.simNotes}>
      <p className={styles.smallLine}>
        {amc ? `El suelo está ${SOIL_TODAY[soil]}: ${num(Math.round(mm5days ?? 0))} mm en los últimos 5 días. ` : "No tenemos la lluvia de los últimos días: suponemos el suelo normal. "}
        {amc && <>Con el suelo {other === "I" ? "seco" : "saturado"}, la misma lluvia mandaría {otherParts.text.toLowerCase()} de cada 10.</>}
      </p>
      {rank != null && <p className={styles.smallLine}>{rank >= 2 / 3 ? `${selected!.nombre} está entre los barrios que más agua mandan a la calle.` : rank <= 1 / 3 ? `${selected!.nombre} está entre los barrios que menos agua mandan a la calle.` : `${selected!.nombre} manda a la calle más o menos lo que el promedio de la ciudad.`}</p>}
      <button type="button" className={styles.textLink} onClick={onShowPaths}>Ver en el mapa por dónde baja el agua</button>
    </div>

    <details className={styles.details}>
      <summary>Cómo se calcula y qué no sabemos</summary>
      <div className={styles.detailsBody}>
        <p>Usamos el método del número de curva del Servicio de Conservación de Suelos de EE. UU. (USDA, TR-55), un estándar de hidrología urbana. Para cada barrio combina cuánto suelo está techado o construido con el tipo de suelo, y lo ajusta según lo que llovió en los últimos 5 días.</p>
        <p>Damos un rango porque no hay mapas oficiales de suelo ni de superficie impermeable para Posadas. El extremo bajo cuenta solo los techos (huellas de edificios de Google y Microsoft); el alto, el tamaño de los lotes y un suelo más arcilloso.</p>
        <p><strong>Lo que no sabemos:</strong> la capacidad de los desagües pluviales de la ciudad no es pública, así que no podemos decir si la red alcanza. Sirve para comparar barrios y escenarios, no para predecir una inundación en una calle.</p>
      </div>
    </details>
  </section>;
}
