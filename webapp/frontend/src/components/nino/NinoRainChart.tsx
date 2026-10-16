"use client";

import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NinoRain } from "@/lib/nino-types";
import { formatRain, formatNinoNumber as num, ninoDate, ninoHour } from "@/lib/nino-presentation";
import styles from "./nino.module.css";

function RainTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: NinoRain["horas"][number] }> }) {
  const hour = payload?.[0]?.payload;
  if (!active || !hour) return null;
  return <div className={styles.tooltip}>
    <p className="font-semibold">{ninoDate(hour.time)}</p>
    <p>{formatRain(hour.p50)} mm de lluvia estimada</p>
    <p className="mt-1 text-sm">Otros escenarios: {formatRain(hour.p10)}–{formatRain(hour.p90)} mm.</p>
    <p className="mt-1 text-xs">Durante la hora que termina a esa hora.</p>
  </div>;
}

export function NinoRainChart({ rain, fresh }: { rain: NinoRain | undefined; fresh: boolean }) {
  const [compare, setCompare] = useState(false);
  const data = rain?.horas.map(hour => ({ ...hour, range: [hour.p10, hour.p90] }));
  const peak = Math.max(0, ...(rain?.horas.flatMap(h => [h.p50, h.p90]).filter(Number.isFinite) ?? []));
  const levels = Object.entries(rain?.umbrales ?? {});
  const highest = Math.max(1, ...levels.map(([, threshold]) => threshold.mm_1h));
  // En la vista de lluvia se adapta la escala; los umbrales nunca expanden esa vista.
  const ceiling = compare ? Math.ceil(Math.max(peak, highest) * 1.12) : Math.max(1, Math.ceil(peak * 1.15 * 10) / 10);
  const referenceNames: Record<string, string> = { atencion: "Atención", alto: "Alto", muy_alto: "Muy alto" };
  return <section id="lluvia" className={styles.section} aria-labelledby="lluvia-heading">
    <p className={styles.eyebrow}>01 · El pronóstico</p>
    <h2 id="lluvia-heading" className={styles.sectionTitle}>¿Cuándo y cuánto puede llover?</h2>
    <p className={styles.intro}>Cada punto muestra la lluvia estimada para una hora. El pronóstico es el mismo para toda Posadas: no distingue una tormenta calle por calle.</p>
    {!fresh && <p className={styles.notice}>Este gráfico muestra un pronóstico anterior. No lo uses para saber qué va a pasar ahora.</p>}
    {data?.length ? <>
      <div className={styles.chartToolbar}>
        <div className={styles.segmented} role="group" aria-label="Escala del gráfico de lluvia">
          <button type="button" aria-pressed={!compare} onClick={() => setCompare(false)}>Ver lluvia prevista</button>
          <button type="button" aria-pressed={compare} onClick={() => setCompare(true)}>Comparar niveles</button>
        </div>
        <span className={styles.muted}>Lluvia en una hora · milímetros (mm)</span>
      </div>
      <div className={styles.chart} role="img" aria-label={`Lluvia estimada por hora. Escala de 0 a ${num(ceiling)} milímetros. Línea azul: estimación central. Franja celeste: variación entre escenarios.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 24, right: 12, left: -12, bottom: 8 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 4" />
            <XAxis dataKey="time" minTickGap={45} tickFormatter={ninoHour} tick={{ fontSize: 12, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} dy={8} />
            <YAxis domain={[0, ceiling]} tickFormatter={v => num(Number(v))} tickCount={5} tick={{ fontSize: 12, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} allowDataOverflow />
            <Tooltip content={<RainTooltip />} />
            <Area dataKey="range" name="Variación entre escenarios" stroke="none" fill="#38a3cd" fillOpacity={.22} isAnimationActive={false} />
            <Line dataKey="p50" name="Lluvia estimada" dot={false} activeDot={{ r: 5 }} stroke="#147caa" strokeWidth={3} isAnimationActive={false} />
            {levels.filter(([, threshold]) => threshold.mm_1h <= ceiling).map(([level, threshold]) => <ReferenceLine key={level} y={threshold.mm_1h} stroke={level === "muy_alto" ? "#b91c1c" : "#a15c13"} strokeDasharray="6 4" label={{ value: `${referenceNames[level] ?? level}: ${num(threshold.mm_1h)} mm`, fontSize: 12, fill: "var(--color-text)", position: "insideTopRight" }} />)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className={styles.chartLegend}><span><i className={styles.lineSwatch} />Línea azul: estimación central</span><span><i className={styles.rangeSwatch} />Franja celeste: variación entre escenarios</span></div>
      <p className={styles.chartHelp}>{compare ? "Las líneas punteadas marcan los niveles de atención por lluvia en una hora. También se evalúa la lluvia acumulada en 24 horas." : `La escala se adapta a la lluvia prevista para que puedas ver incluso cantidades pequeñas. El primer nivel de atención empieza en ${num(rain?.umbrales.atencion?.mm_1h)} mm en una hora.`} Tocá el gráfico para ver una hora.</p>
    </> : <p className={styles.notice}>No hay datos horarios suficientes para dibujar el gráfico.</p>}

    <p className={styles.rainMeaning}><strong>¿Qué significa “mm”?</strong> Un milímetro de lluvia equivale a un litro de agua sobre cada metro cuadrado.</p>
    <dl className={styles.rainTotals}>{[
      ["En la hora con más lluvia", rain?.lluvia_max_1h],
      ["En las 3 horas más lluviosas", rain?.lluvia_max_3h],
      ["En las 24 horas más lluviosas", rain?.lluvia_24h],
      ["En las 48 horas más lluviosas", rain?.lluvia_48h],
    ].map(([label, amount]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{fresh ? formatRain(amount as number | undefined) : "Sin dato vigente"}{fresh && amount != null && <span> mm</span>}</dd></div>)}</dl>
    <p className={styles.caption}>Son los períodos consecutivos con más lluvia dentro de las próximas 72 horas. No sumes estas cifras: los períodos pueden superponerse.</p>

    <details className={styles.details}>
      <summary>Cómo se calculan los niveles y cuánto puede variar el pronóstico</summary>
      <div className={styles.detailsBody}>
        <p>Se comparan varios escenarios meteorológicos. La línea azul es el valor central (mediana); la franja muestra el rango entre los percentiles 10 y 90. No es una garantía de que la lluvia quede dentro de ese rango.</p>
        <div className={styles.thresholdList}>{levels.map(([level, threshold]) => <p key={level}><strong>{referenceNames[level] ?? level}:</strong> {num(threshold.mm_1h)} mm en una hora <strong>o</strong> {num(threshold.mm_24h)} mm en 24 horas.</p>)}</div>
        <p>Entre los {rain?.n_miembros ?? "—"} escenarios completos del modelo, estos porcentajes superan al menos uno de los límites de cada nivel durante las próximas 72 horas:</p>
        <ul className={styles.scenarios}>{Object.entries(rain?.probabilidades ?? {}).map(([level, value]) => <li key={level}><span>{referenceNames[level] ?? level}</span><strong>{fresh ? `${formatRain(value)} %` : "Sin dato vigente"}</strong></li>)}</ul>
        <p>No sumes los porcentajes: un mismo escenario puede superar varios niveles. Son frecuencias del modelo, sin calibración probabilística local. Los límites son iniciales y están sujetos a revisión.</p>
      </div>
    </details>
  </section>;
}
