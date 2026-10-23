// Escurrimiento estimado por barrio con el método del número de curva (SCS).
// Funciones puras: se usan en el simulador y se prueban con `node --test`.
//
// Referencias: USDA-NRCS, TR-55 "Urban Hydrology for Small Watersheds" (1986);
// NEH-4 cap. 4 y 10 (condición de humedad antecedente); Chow, Maidment y Mays,
// "Applied Hydrology" (1988), ecs. 5.5.5 y 5.5.6.

export type Amc = "I" | "II" | "III";

export interface BarrioHidro {
  poligono_id: string;
  nombre: string;
  area_m2: number;
  cn_ii_min: number;
  cn_ii_max: number;
}

// Temporada de crecimiento (todo el año en Posadas): < 35,6 mm en 5 días = seco (I),
// > 53,3 mm = húmedo (III). Sin dato no se elige una condición.
export function amcFromAntecedent(mm5days: number | null | undefined): Amc | null {
  if (mm5days == null || !Number.isFinite(mm5days)) return null;
  if (mm5days < 35.6) return "I";
  return mm5days > 53.3 ? "III" : "II";
}

export function adjustCn(cn2: number, amc: Amc) {
  if (amc === "I") return (4.2 * cn2) / (10 - 0.058 * cn2);
  if (amc === "III") return (23 * cn2) / (10 + 0.13 * cn2);
  return cn2;
}

// Escurrimiento directo en mm para una lluvia P (mm) y un número de curva.
export function scsRunoff(p: number, cn: number) {
  if (!(p > 0) || !(cn > 0)) return 0;
  const s = 25400 / Math.min(cn, 99.9) - 254;
  const ia = 0.2 * s;
  return p <= ia ? 0 : (p - ia) ** 2 / (p + 0.8 * s);
}

export interface RunoffRange {
  mm: [number, number];
  // De cada 100 litros que caen, cuántos corren por la superficie.
  porcentaje: [number, number];
  m3: [number, number];
}

export function barrioRunoff(barrio: BarrioHidro, p: number, amc: Amc): RunoffRange {
  const low = scsRunoff(p, adjustCn(barrio.cn_ii_min, amc));
  const high = scsRunoff(p, adjustCn(barrio.cn_ii_max, amc));
  const pct = (q: number) => (p > 0 ? Math.round((q / p) * 100) : 0);
  const m3 = (q: number) => Math.round((q / 1000) * barrio.area_m2);
  return { mm: [low, high], porcentaje: [pct(low), pct(high)], m3: [m3(low), m3(high)] };
}

export function cityRunoff(barrios: BarrioHidro[], p: number, amc: Amc) {
  return barrios.reduce<[number, number]>((acc, b) => {
    const r = barrioRunoff(b, p, amc);
    return [acc[0] + r.m3[0], acc[1] + r.m3[1]];
  }, [0, 0]);
}

// Frecuencia empírica: cuántas veces por año la estación midió al menos ese valor.
export function timesPerYear(value: number, sortedDesc: number[], years: number) {
  if (!years || !Number.isFinite(value)) return null;
  const count = sortedDesc.filter(v => v >= value).length;
  return { count, porAnio: count / years };
}

export function frequencyText(value: number, sortedDesc: number[], years: number) {
  const f = timesPerYear(value, sortedDesc, years);
  if (!f) return null;
  if (f.count === 0) return `No pasó en los ${years} años con registro completo`;
  if (f.porAnio >= 1.5) return `Pasa unas ${Math.round(f.porAnio)} veces por año`;
  if (f.porAnio >= 0.75) return "Pasa más o menos una vez por año";
  const every = Math.round(1 / f.porAnio);
  return `Pasa en promedio una vez cada ${every} años`;
}
