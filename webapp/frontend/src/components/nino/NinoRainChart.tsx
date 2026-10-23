"use client";

import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NinoRain } from "@/lib/nino-types";
import { formatRain, formatNinoNumber as num, ninoDate, ninoHour } from "@/lib/nino-presentation";
import styles from "./nino.module.css";

type Hour = NinoRain["horas"][number] & { line: number };

function RainTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: Hour }> }) {
  const hour = payload?.[0]?.payload;
  if (!active || !hour) return null;
  return <div className={styles.tooltip}>
    <p className="font-semibold">{ninoDate(hour.time)}</p>
    <p>{formatRain(hour.line)} mm en promedio</p>
    <p className="mt-1 text-sm">Escenarios: {formatRain(hour.p10)}–{formatRain(hour.p90)} mm.</p>
    <p className="mt-1 text-xs">Durante la hora que termina a esa hora.</p>
  </div>;
}

// Detalle hora por hora: vive dentro de "Lo que viene".
export function NinoRainChart({ rain, fresh }: { rain: NinoRain | undefined; fresh: boolean }) {
  const [compare, setCompare] = useState(false);
  const data: Hour[] | undefined = rain?.horas.map(hour => ({ ...hour, line: hour.media ?? hour.p50, range: [hour.p10, hour.p90] } as Hour));
  const peak = Math.max(0, ...(data?.flatMap(h => [h.line, h.p90]).filter(Number.isFinite) ?? []));
  const levels = Object.entries(rain?.umbrales ?? {});
  const highest = Math.max(1, ...levels.map(([, threshold]) => threshold.mm_1h));
  // En la vista de lluvia se adapta la escala; los umbrales nunca expanden esa vista.
  const ceiling = compare ? Math.ceil(Math.max(peak, highest) * 1.12) : Math.max(1, Math.ceil(peak * 1.15 * 10) / 10);
  const referenceNames: Record<string, string> = { atencion: "Atención", alto: "Alto", muy_alto: "Muy alto" };
  return <div className={styles.hourly}>
    {!fresh && <p className={styles.notice}>Este gráfico muestra un pronóstico anterior. No lo uses para saber qué va a pasar ahora.</p>}
    {data?.length ? <>
      <div className={styles.chartToolbar}>
        <div className={styles.segmented} role="group" aria-label="Escala del gráfico de lluvia">
          <button type="button" aria-pressed={!compare} onClick={() => setCompare(false)}>Ver lluvia prevista</button>
          <button type="button" aria-pressed={compare} onClick={() => setCompare(true)}>Comparar niveles</button>
        </div>
        <span className={styles.muted}>Lluvia en una hora · milímetros (mm)</span>
      </div>
      <div className={styles.chart} role="img" aria-label={`Lluvia estimada por hora. Escala de 0 a ${num(ceiling)} milímetros. Línea azul: promedio de los escenarios. Franja celeste: variación entre escenarios.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 24, right: 12, left: -12, bottom: 8 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--nino-grid)" />
            <XAxis dataKey="time" minTickGap={45} tickFormatter={ninoHour} tick={{ fontSize: 12, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} dy={8} />
            <YAxis domain={[0, ceiling]} tickFormatter={v => num(Number(v))} tickCount={5} tick={{ fontSize: 12, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} allowDataOverflow />
            <Tooltip content={<RainTooltip />} />
            <Area dataKey="range" name="Variación entre escenarios" stroke="none" fill="var(--nino-rain)" fillOpacity={.14} isAnimationActive={false} />
            <Line dataKey="line" name="Lluvia estimada" dot={false} activeDot={{ r: 5 }} stroke="var(--nino-rain)" strokeWidth={2} isAnimationActive={false} />
            {levels.filter(([, threshold]) => threshold.mm_1h <= ceiling).map(([level, threshold]) => <ReferenceLine key={level} y={threshold.mm_1h} stroke="var(--nino-threshold)" strokeDasharray="6 4" label={{ value: `${referenceNames[level] ?? level}: ${num(threshold.mm_1h)} mm`, fontSize: 12, fill: "var(--color-text)", position: "insideTopRight" }} />)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className={styles.chartKey}><span><i className={styles.keyLine} />Promedio de los escenarios</span><span><i className={styles.keyRange} />Variación entre escenarios</span></p>
      <p className={styles.chartHelp}>{compare ? "Las líneas punteadas marcan los niveles de atención por lluvia en una hora. También se evalúa la lluvia acumulada en 24 horas." : `La escala se adapta a la lluvia prevista para que puedas ver incluso cantidades pequeñas. El primer nivel de atención empieza en ${num(rain?.umbrales.atencion?.mm_1h)} mm en una hora.`} Tocá el gráfico para ver una hora.</p>
    </> : <p className={styles.notice}>No hay datos horarios suficientes para dibujar el gráfico.</p>}

    <p className={styles.rainMeaning}><strong>¿Qué significa “mm”?</strong> Un milímetro de lluvia equivale a un litro de agua sobre cada metro cuadrado.</p>
    <dl className={styles.rainTotals}>{[
      ["En la hora con más lluvia", rain?.lluvia_max_1h, rain?.lluvia_max_1h_p90],
      ["En las 3 horas más lluviosas", rain?.lluvia_max_3h, undefined],
      ["En las 24 horas más lluviosas", rain?.lluvia_24h, rain?.lluvia_24h_p90],
      ["En las 48 horas más lluviosas", rain?.lluvia_48h, rain?.lluvia_48h_p90],
    ].map(([label, amount, high]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{fresh ? formatRain(amount as number | undefined) : "Sin dato vigente"}{fresh && amount != null && <span> mm</span>}</dd>{fresh && high != null && <dd className={styles.totalHigh}>Escenario alto: {formatRain(high as number)} mm</dd>}</div>)}</dl>
    <p className={styles.caption}>Son los períodos consecutivos con más lluvia dentro de las próximas 72 horas. No sumes estas cifras: los períodos pueden superponerse.</p>

    <h3 className={styles.subTitle}>Cómo se calculan los niveles</h3>
    <p>Se comparan {rain?.n_miembros ?? "varios"} escenarios meteorológicos. Cada uno ubica las tormentas a una hora distinta: por eso primero se toma el pico de lluvia de cada escenario y después el valor central (mediana) de esos picos. El escenario alto es el percentil 90. La línea del gráfico es el promedio hora por hora: sirve para ver cuándo es más probable que llueva, y se ve más baja que los picos.</p>
    <div className={styles.thresholdList}>{levels.map(([level, threshold]) => <p key={level}><strong>{referenceNames[level] ?? level}:</strong> {num(threshold.mm_1h)} mm en una hora <strong>o</strong> {num(threshold.mm_24h)} mm en 24 horas.</p>)}</div>
    <p>Entre los escenarios completos del modelo, estos porcentajes superan al menos uno de los límites de cada nivel durante las próximas 72 horas:</p>
    <ul className={styles.scenarios}>{Object.entries(rain?.probabilidades ?? {}).map(([level, value]) => <li key={level}><span>{referenceNames[level] ?? level}</span><strong>{fresh ? `${formatRain(value)} %` : "Sin dato vigente"}</strong></li>)}</ul>
    <p>No sumes los porcentajes: un mismo escenario puede superar varios niveles. Son frecuencias del modelo, sin calibración probabilística local. Los límites son iniciales y están sujetos a revisión. Este observatorio no emite alertas: las oficiales son las del SMN.</p>
  </div>;
}
