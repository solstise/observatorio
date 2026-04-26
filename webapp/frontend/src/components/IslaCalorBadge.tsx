"use client";

// Badge de isla de calor urbana. Muestra hasta tres vistas complementarias:
// - MODIS LST diurno vs promedio bbox Posadas (8-daily, 1 km, histórico
//   desde 2000). Versión heredada, se mantiene por continuidad.
// - Landsat 8/9 LST vs baseline rural (mensual, 30 m, desde 2018). Es la
//   métrica estándar de la literatura UHI (Voogt & Oke 2003). Cuando
//   hay datos Landsat se muestra arriba como lectura principal.
// - CBERS-4 IRS LST como BACKUP térmico cuando Landsat no tiene dato del
//   mes más reciente (40 m TIR, mensual). Solo se activa si Landsat es
//   null/ausente; aparece con un badge "Fuente: CBERS-4 IRS (backup)"
//   y un tooltip explicando que es respaldo, no la fuente primaria.
//
// Rompe la regla "sin rojos" del resto del sitio: en climatología urbana
// el rojo/naranja/azul es convención estándar y la semántica gana peso
// sobre la paleta.

import Link from "next/link";

import { TerminoGlosario } from "@/components/TerminoGlosario";
import type { LstCbersRow, LstRow, UhiMensualRow } from "@/lib/types";

interface IslaCalorBadgeProps {
  rows: LstRow[];
  uhiLandsat?: UhiMensualRow[];
  /**
   * LST mensual derivado de CBERS-4 IRS (40 m TIR). Sirve como backup
   * cuando Landsat no tiene dato del mes más reciente. Las filas tienen
   * `lst_mean_cbers` en grados Celsius. Pasarlo es opcional — si está
   * ausente, el badge funciona como antes (Landsat + MODIS).
   */
  lstCbers?: LstCbersRow[];
}

// Umbrales por convención de la literatura UHI: delta > 2 C se considera
// isla de calor clara, 0-2 C es zona caliente moderada, negativo es
// enfriamiento neto (oasis urbano). Cruce en 2 C lo usan EPA y varios
// papers rioplatenses.
const COLOR_CALIENTE_FUERTE = "#dc2626";
const COLOR_CALIENTE_LEVE = "#c97d3c";
const COLOR_FRESCO = "#1a3a5c";

function tomarMasReciente(rows: LstRow[]): LstRow | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => b.anio - a.anio)[0];
}

// Selecciona la fila Landsat UHI del mes más reciente con valor válido.
// Si la fila más reciente trae lst_mean nulo (no esperado pero defendamos
// el invariant), seguimos buscando hacia atrás.
function tomarUhiMasReciente(rows: UhiMensualRow[]): UhiMensualRow | null {
  if (!rows.length) return null;
  const ord = [...rows].sort((a, b) => {
    if (b.anio !== a.anio) return b.anio - a.anio;
    return b.mes - a.mes;
  });
  for (const r of ord) {
    if (Number.isFinite(r.lst_mean) && Number.isFinite(r.uhi_vs_rural)) {
      return r;
    }
  }
  return null;
}

// Selecciona la fila CBERS LST del mes más reciente CON VALOR VÁLIDO.
// Si el CSV publica meses sin dato (lst_mean_cbers=null), los saltamos.
function tomarCbersMasReciente(rows: LstCbersRow[]): LstCbersRow | null {
  if (!rows.length) return null;
  const ord = [...rows].sort((a, b) => {
    if (b.anio !== a.anio) return b.anio - a.anio;
    return b.mes - a.mes;
  });
  for (const r of ord) {
    if (
      r.lst_mean_cbers !== null &&
      r.lst_mean_cbers !== undefined &&
      Number.isFinite(r.lst_mean_cbers)
    ) {
      return r;
    }
  }
  return null;
}

function colorYEtiqueta(delta: number, referencia: string) {
  if (delta > 2) {
    return {
      color: COLOR_CALIENTE_FUERTE,
      etiqueta: `Isla de calor marcada vs ${referencia}`,
    };
  }
  if (delta >= 0) {
    return {
      color: COLOR_CALIENTE_LEVE,
      etiqueta: `Isla de calor leve vs ${referencia}`,
    };
  }
  return {
    color: COLOR_FRESCO,
    etiqueta: `Enfriamiento neto vs ${referencia}`,
  };
}

const MESES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function IslaCalorBadge({
  rows,
  uhiLandsat,
  lstCbers,
}: IslaCalorBadgeProps) {
  const ultimaLst = tomarMasReciente(rows);
  const ultimaUhi = uhiLandsat ? tomarUhiMasReciente(uhiLandsat) : null;
  const ultimaCbers = lstCbers ? tomarCbersMasReciente(lstCbers) : null;

  // Política de backup térmico:
  //   - Si Landsat tiene dato → siempre prevalece (BloqueLandsat).
  //   - Si Landsat es null AND CBERS existe → usamos CBERS como métrica
  //     principal con un badge "Fuente: CBERS-4 IRS (backup)". CBERS no
  //     tiene baseline rural calculado por T1 todavía, así que mostramos
  //     LST absoluta del mes y referimos al lector a /calor para más
  //     contexto comparativo.
  //   - Si ambos faltan pero MODIS está → cae al BloqueModis como antes.
  //   - Si nada existe → mensaje "Sin datos disponibles".
  const cbersEsBackup = !ultimaUhi && Boolean(ultimaCbers);

  if (!ultimaLst && !ultimaUhi && !ultimaCbers) {
    return (
      <div className="flex h-full min-h-[160px] flex-col items-start justify-center">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          Isla de calor urbana
        </h3>
        <p className="mt-2 text-sm italic text-neutral-muted dark:text-dk-muted">
          Sin datos térmicos disponibles todavía para este polígono.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          <TerminoGlosario id="uhi">Isla de calor urbana</TerminoGlosario>
        </h3>
        <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
          Cuánto más caliente está este barrio que el campo cercano. Identifica
          dónde la urbanización generó zonas térmicamente más estresadas.
        </p>
      </div>

      {ultimaUhi ? <BloqueLandsat ultima={ultimaUhi} /> : null}

      {cbersEsBackup && ultimaCbers ? (
        <BloqueCbersBackup ultima={ultimaCbers} />
      ) : null}

      {ultimaLst ? (
        <BloqueModis
          ultima={ultimaLst}
          subordinado={Boolean(ultimaUhi) || cbersEsBackup}
        />
      ) : null}

      <p className="text-[11px] text-neutral-muted dark:text-dk-muted">
        Datos: <TerminoGlosario id="landsat">Landsat 8/9</TerminoGlosario>{" "}
        (30 m, mensual)
        {lstCbers && lstCbers.length > 0 ? (
          <>
            ,{" "}
            <TerminoGlosario id="irs-cbers">CBERS-4 IRS</TerminoGlosario>{" "}
            (40 m, backup mensual)
          </>
        ) : null}{" "}
        y <TerminoGlosario id="modis">MODIS</TerminoGlosario> (1 km,
        día/noche). Detalle en{" "}
        <Link
          href="/calor"
          className="text-primary underline dark:text-dk-primary"
        >
          /calor
        </Link>
        .
      </p>
    </div>
  );
}

function BloqueCbersBackup({ ultima }: { ultima: LstCbersRow }) {
  // Backup: cuando Landsat no tiene dato del último mes y T1 publicó una
  // lectura CBERS-4 IRS, mostramos el LST absoluto de ese mes (CBERS no
  // tiene baseline rural calculado por T1 todavía, así que no podemos
  // mostrar un delta UHI). El badge de "fuente: CBERS-4 IRS (backup)"
  // es la indicación honesta para que el lector sepa qué está viendo.
  const lstC = ultima.lst_mean_cbers ?? 0;
  const mesNombre = MESES_ES[ultima.mes - 1] ?? `mes ${ultima.mes}`;
  const tooltip =
    "Backup térmico: CBERS-4 IRS, banda térmica 40 m. Se muestra cuando Landsat no tiene observación útil del mes (nubosidad sobre la ventana de pasada). LST absoluta del polígono — sin delta UHI calculado todavía.";

  // Color base usando la misma escala absoluta que MODIS para mantener
  // consistencia visual: >35 caliente, 28-35 templado, <28 fresco.
  let color = COLOR_FRESCO;
  if (lstC >= 35) color = COLOR_CALIENTE_FUERTE;
  else if (lstC >= 28) color = COLOR_CALIENTE_LEVE;

  return (
    <div
      className="flex items-center gap-4 rounded-md border-2 border-dashed border-amber-300 p-4 dark:border-amber-600/60 dark:bg-amber-900/20"
      title={tooltip}
      aria-label={`Backup CBERS IRS: temperatura superficial ${lstC.toFixed(1)} grados Celsius en ${mesNombre} ${ultima.anio}.`}
    >
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      >
        LST
      </div>
      <div className="flex flex-col">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-2xl font-bold" style={{ color }}>
            {lstC.toFixed(1)}
            {"°"}C
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900 dark:border-amber-500/60 dark:bg-amber-900/40 dark:text-amber-100"
            title="Lectura proveniente de CBERS-4 IRS porque Landsat no tuvo observación válida en este mes. Se reactiva la lectura Landsat cuando vuelva a haber escena clara."
          >
            Fuente:{" "}
            <TerminoGlosario id="irs-cbers">CBERS-4 IRS</TerminoGlosario>{" "}
            (backup)
          </span>
        </div>
        <span className="mt-0.5 text-xs font-medium text-primary dark:text-dk-primary">
          Temperatura superficial mensual
        </span>
        <span className="text-[11px] text-neutral-muted dark:text-dk-muted">
          {mesNombre} {ultima.anio} · {ultima.n_pixeles ?? "—"} píxeles
          válidos · calidad <strong>{ultima.calidad}</strong>
        </span>
      </div>
    </div>
  );
}

function BloqueLandsat({ ultima }: { ultima: UhiMensualRow }) {
  const delta = ultima.uhi_vs_rural;
  const { color, etiqueta } = colorYEtiqueta(delta, "baseline rural");
  const signo = delta > 0 ? "+" : "";
  const mesNombre = MESES_ES[ultima.mes - 1] ?? `mes ${ultima.mes}`;
  const tooltip =
    "Landsat 8/9 C2 L2, LST 30 m. Diferencia entre la LST mensual del poligono y el promedio de 4 poligonos rurales en 20 km a la redonda. Métrica UHI estándar Voogt & Oke 2003.";

  return (
    <div
      className="flex items-center gap-4 rounded-md border border-neutral-border p-4 dark:border-dk-border dark:bg-dk-elevated/40"
      title={tooltip}
      aria-label={`UHI Landsat vs rural: ${signo}${delta.toFixed(1)} grados celsius. ${etiqueta}.`}
    >
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      >
        ΔT
      </div>
      <div className="flex flex-col">
        <span className="text-2xl font-bold" style={{ color }}>
          {signo}
          {delta.toFixed(1)}
          {"°"}C
        </span>
        <span className="text-xs font-medium text-primary dark:text-dk-primary">
          {etiqueta}
        </span>
        <span className="text-[11px] text-neutral-muted dark:text-dk-muted">
          {mesNombre} {ultima.anio} · campo de referencia a{" "}
          {ultima.lst_rural_baseline.toFixed(1)}°C ·{" "}
          <em>
            Datos: <TerminoGlosario id="landsat">Landsat 8/9</TerminoGlosario>,
            30 m
          </em>
          .
        </span>
      </div>
    </div>
  );
}

function BloqueModis({
  ultima,
  subordinado,
}: {
  ultima: LstRow;
  subordinado: boolean;
}) {
  const delta = ultima.isla_calor_c;
  const lstDia = ultima.lst_dia_verano_c;
  const lstNoche = ultima.lst_noche_verano_c;
  const { color, etiqueta } = colorYEtiqueta(delta, "promedio Posadas");
  const signo = delta > 0 ? "+" : "";
  const tooltip =
    "MODIS MOD11A2 LST, resolución 1 km, 8-daily. Diferencia vs promedio del bbox Posadas, valores verano diurno.";

  if (subordinado) {
    return (
      <div
        className="rounded-md border border-dashed border-neutral-border bg-neutral-50 p-3 text-xs dark:border-dk-border dark:bg-dk-elevated/60"
        title={tooltip}
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-medium text-primary dark:text-dk-primary">
            Calor de día y de noche (vista{" "}
            <TerminoGlosario id="modis">MODIS</TerminoGlosario>)
          </span>
          <span className="text-sm font-semibold" style={{ color }}>
            {signo}
            {delta.toFixed(1)}
            {"°"}C vs promedio de la ciudad
          </span>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-neutral-muted dark:text-dk-muted">
          <div className="flex flex-col">
            <dt className="uppercase tracking-wider text-secondary dark:text-dk-muted">
              Día (verano)
            </dt>
            <dd className="text-sm font-semibold text-primary dark:text-dk-primary">
              {lstDia.toFixed(1)}
              {"°"}C
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="uppercase tracking-wider text-secondary dark:text-dk-muted">
              Noche (verano)
            </dt>
            <dd className="text-sm font-semibold text-primary dark:text-dk-primary">
              {lstNoche.toFixed(1)}
              {"°"}C
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[10px] italic text-neutral-muted dark:text-dk-muted">
          Datos: MODIS MOD11A2 (1 km, 8-daily). Complementa Landsat con la
          lectura nocturna.
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-2"
      title={tooltip}
      aria-label={`Isla de calor MODIS: delta ${signo}${delta.toFixed(1)} grados celsius. ${etiqueta}.`}
    >
      <div className="flex items-center gap-4 rounded-md border border-neutral-border p-4 dark:border-dk-border dark:bg-dk-elevated/40">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        >
          ΔT
        </div>
        <div className="flex flex-col">
          <span className="text-2xl font-bold" style={{ color }}>
            {signo}
            {delta.toFixed(1)}
            {"°"}C
          </span>
          <span className="text-xs font-medium text-primary dark:text-dk-primary">
            {etiqueta}
          </span>
          <span className="text-[11px] text-neutral-muted dark:text-dk-muted">
            Verano {ultima.anio} · día · <em>Datos: MODIS, 1 km</em>.
          </span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-1 text-[11px] text-neutral-muted dark:text-dk-muted">
        <div className="flex flex-col">
          <dt className="uppercase tracking-wider text-secondary dark:text-dk-muted">
            Día (verano)
          </dt>
          <dd className="text-sm font-semibold text-primary dark:text-dk-primary">
            {lstDia.toFixed(1)}
            {"°"}C
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="uppercase tracking-wider text-secondary dark:text-dk-muted">
            Noche (verano)
          </dt>
          <dd className="text-sm font-semibold text-primary dark:text-dk-primary">
            {lstNoche.toFixed(1)}
            {"°"}C
          </dd>
        </div>
      </dl>
    </div>
  );
}
