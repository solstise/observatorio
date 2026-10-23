"use client";

import Link from "next/link";
import { useState } from "react";
import type { NinoRow } from "@/lib/nino-types";
import { IMPACT_LABEL, formatNinoNumber as num, normalizeBarrio } from "@/lib/nino-presentation";
import styles from "./nino.module.css";

type Order = "impacto" | "nombre" | "cantidad" | "proporcion";

export function NinoBarrios({ rows, fresh, onLocate }: { rows: NinoRow[]; fresh: boolean; onLocate: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<Order>("impacto");
  const [visible, setVisible] = useState(8);
  const filtered = rows.filter(row => normalizeBarrio(row.nombre).includes(normalizeBarrio(query)));
  filtered.sort((a, b) => {
    if (order === "nombre") return a.nombre.localeCompare(b.nombre, "es");
    // Sin pronóstico vigente no ordenar ni sugerir prioridad por un score viejo.
    const key = order === "cantidad" ? "viviendas_expuestas" : order === "proporcion" ? "pct_viviendas_expuestas" : fresh ? "score_anegamiento" : "viviendas_expuestas";
    const av = a.estado === "calculado" ? a[key] : null;
    const bv = b.estado === "calculado" ? b[key] : null;
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    return (bv ?? -1) - (av ?? -1) || b.viviendas_expuestas - a.viviendas_expuestas || a.nombre.localeCompare(b.nombre, "es");
  });
  return <section id="barrios" className={styles.section} aria-labelledby="barrios-heading">
    <p className={styles.eyebrow}>Tu barrio</p>
    <h2 id="barrios-heading" className={styles.sectionTitle}>Buscá tu barrio</h2>
    <p className={styles.intro}>La lluvia cambia de un día a otro. La cercanía a arroyos y las zonas bajas cambian mucho menos. Combinamos ambos datos para estimar dónde podría haber más problemas.</p>
    <div className={styles.searchControls}>
      <div><label htmlFor="nino-barrio-search">Nombre del barrio</label><input id="nino-barrio-search" type="search" value={query} placeholder="Por ejemplo, Santa Rita" onChange={event => { setQuery(event.target.value); setVisible(8); }} aria-controls="nino-barrio-list" /></div>
      <div><label htmlFor="nino-barrio-order">Ordenar barrios</label><select id="nino-barrio-order" value={order} onChange={event => { setOrder(event.target.value as Order); setVisible(8); }}>
        <option value="impacto">{fresh ? "Mayor impacto estimado" : "Más edificios en zonas expuestas"}</option>
        <option value="nombre">Nombre, de A a Z</option><option value="cantidad">Más edificios en zonas expuestas</option><option value="proporcion">Mayor proporción de edificios expuestos</option>
      </select></div>
    </div>
    <p className={styles.results} role="status">{filtered.length ? `${filtered.length} ${filtered.length === 1 ? "barrio encontrado" : "barrios encontrados"}${filtered.length > visible ? ` · Mostrando ${visible}` : ""}` : "No encontramos barrios con ese nombre."}</p>
    <div className={styles.barrioColumns} aria-hidden="true"><span>Barrio</span><span>Edificios en zonas expuestas</span><span>Personas estimadas</span><span>Impacto con la lluvia prevista</span></div>
    <ul id="nino-barrio-list" className={styles.barrioList}>
      {filtered.slice(0, visible).map(row => {
        const complete = row.estado === "calculado" && row.pct_viviendas_expuestas != null;
        const level = fresh && complete && row.score_anegamiento != null ? row.nivel : "a_verificar";
        const percentage = row.pct_viviendas_expuestas;
        return <li key={row.poligono_id} data-barrio={row.poligono_id} className={styles.barrioRow}>
          <div className={styles.barrioName}><h3><Link href={`/poligono/${row.poligono_id}`}>{row.nombre}</Link></h3><a href="#mapa" onClick={() => onLocate(row.poligono_id)}>Ver en el mapa <span aria-hidden="true">↗</span></a></div>
          <div><p className={styles.mobileLabel}>Edificios en zonas expuestas</p><p className={styles.barrioValue}>{complete ? `${num(row.viviendas_expuestas)}${row.edificios_total != null ? ` de ${num(row.edificios_total)}` : ""}` : "Faltan datos"}</p>
            {complete && percentage != null ? <><svg className={styles.exposureBar} viewBox="0 0 180 6" preserveAspectRatio="none" role="img" aria-label={`${num(percentage)} por ciento de los edificios en zonas expuestas`}><rect width="180" height="6" rx="3" fill="var(--color-border)" /><rect width={Math.max(0, Math.min(100, percentage)) * 1.8} height="6" rx="3" fill="#147caa" /></svg><p className={styles.caption}>{percentage > 0 && percentage < .1 ? "Menos del 0,1" : num(percentage)}% de los edificios · {num(row.viviendas_muy_expuestas)} en la categoría más expuesta</p></> : <p className={styles.caption}>No se interpreta la falta de datos como cero exposición.</p>}
          </div>
          <div><p className={styles.mobileLabel}>Personas estimadas</p><p className={styles.barrioValue}>{row.poblacion_expuesta_estimada == null ? "Sin estimación" : `≈ ${num(row.poblacion_expuesta_estimada)}`}</p><p className={styles.caption}>{row.poblacion_expuesta_estimada == null ? "Faltan datos de población." : `Rango orientativo: ${num(row.poblacion_expuesta_min)}–${num(row.poblacion_expuesta_max)}`}</p></div>
          <div><p className={styles.mobileLabel}>Impacto con la lluvia prevista</p><span className={`${styles.badge} ${styles[level]}`}>{fresh ? IMPACT_LABEL[level] : "Sin pronóstico vigente"}</span></div>
        </li>;
      })}
    </ul>
    {!filtered.length && <div className={styles.empty}><p>Probá con una parte del nombre o revisá cómo lo escribiste.</p><button className={styles.secondaryButton} onClick={() => { setQuery(""); setVisible(8); }}>Ver todos los barrios</button></div>}
    {filtered.length > visible && <button className={styles.secondaryButton} onClick={() => setVisible(visible + 8)}>Ver más barrios ({filtered.length - visible} restantes)</button>}
    <details className={styles.details}><summary>Qué significan los edificios, las personas y el impacto</summary><div className={styles.detailsBody}>
      <p><strong>Edificios en zonas expuestas:</strong> construcciones cerca de cursos de agua o en terreno bajo según el modelo. Incluyen viviendas y otros edificios. No significa que estén inundados ni que vayan a inundarse.</p>
      <p><strong>La barra azul:</strong> muestra qué proporción de los edificios del barrio está en esas zonas. Un barrio grande puede tener más edificios expuestos y una proporción menor que uno pequeño.</p>
      <p><strong>Personas estimadas:</strong> aproximación con datos de población de 2020 (WorldPop) y la proporción de edificios expuestos. El símbolo ≈ significa “aproximadamente”. La banda de ±20% es orientativa; no es un recuento de vecinos ni un intervalo estadístico validado. Si faltan datos no mostramos una cifra.</p>
      <p><strong>Impacto:</strong> combina la lluvia prevista y la proporción de edificios expuestos. Bajo no significa riesgo cero. El índice interno va de 0 a 100; no representa la probabilidad de que tu casa se inunde. Se usa el mismo pronóstico de lluvia para todos los barrios.</p>
      <Link href="/datos/metodologia#anegamiento-v2" className="underline">Ver las fórmulas y las limitaciones del cálculo</Link>
    </div></details>
  </section>;
}
