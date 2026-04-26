"use client";

// Narrativa dinámica para el polígono seleccionado: redacta el dato clave
// con bandas de confianza explícitas.

import type { UhiMensualRow } from "@/lib/types";

interface Props {
  poligonoId: string | null;
  nombre: string | null;
  rows: UhiMensualRow[];
}

function confianza(n: number, std: number | null): {
  etiqueta: string;
  clase: string;
} {
  // Los colores semafóricos (verde/amarillo/naranja) aclaran su variante
  // en dark mode para mantener legibilidad sobre fondo oscuro sin perder
  // la convención cromática.
  const s = std ?? 99;
  if (n >= 12 && s < 1.5)
    return { etiqueta: "alta", clase: "text-green-700 dark:text-green-300" };
  if (n >= 6 && s < 3)
    return { etiqueta: "media", clase: "text-yellow-700 dark:text-yellow-300" };
  return {
    etiqueta: "preliminar",
    clase: "text-orange-700 dark:text-orange-300",
  };
}

function nombreMes(mes: number): string {
  return [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ][mes - 1];
}

export function NarrativaUHI({ poligonoId, nombre, rows }: Props) {
  if (!poligonoId || !nombre) {
    return (
      <div className="card">
        <p className="text-sm italic text-neutral-muted dark:text-dk-muted">
          Seleccioná un polígono en el mapa para ver su lectura térmica
          detallada.
        </p>
      </div>
    );
  }

  const sub = rows
    .filter((r) => r.poligono_id === poligonoId)
    .sort((a, b) => b.anio - a.anio || b.mes - a.mes);

  if (!sub.length) {
    return (
      <div className="card">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          {nombre}
        </h3>
        <p className="mt-2 text-sm text-neutral-muted dark:text-dk-muted">
          Aún no hay datos de UHI procesados para este polígono.
        </p>
      </div>
    );
  }

  const r = sub[0];
  const conf = confianza(
    r.n_observaciones_historico ?? 0,
    r.std_historico,
  );

  const vsRural = r.uhi_vs_rural;
  const vsCiudad = r.uhi_vs_ciudad;
  const anomalia = r.uhi_anomalia;

  return (
    <div className="card">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-primary dark:text-dk-primary">
          {nombre}
        </h3>
        <span className={`text-xs font-semibold ${conf.clase}`}>
          Confianza: {conf.etiqueta}
        </span>
      </header>
      <p className="mt-3 text-sm leading-relaxed text-neutral-text dark:text-dk-text">
        En <strong>{nombreMes(r.mes)} {r.anio}</strong>, la temperatura de
        superficie promedio fue de{" "}
        <strong className="text-primary dark:text-dk-primary">
          {r.lst_mean.toFixed(1)}°C
        </strong>.{" "}
        Eso representa una intensidad de isla de calor urbana de{" "}
        <strong
          className={
            vsRural > 0
              ? "text-accent dark:text-dk-accent"
              : "text-primary dark:text-dk-primary"
          }
        >
          {vsRural > 0 ? "+" : ""}
          {vsRural.toFixed(1)}°C
        </strong>{" "}
        respecto del campo, y{" "}
        <strong
          className={
            vsCiudad > 0
              ? "text-accent dark:text-dk-accent"
              : "text-primary dark:text-dk-primary"
          }
        >
          {vsCiudad > 0 ? "+" : ""}
          {vsCiudad.toFixed(1)}°C
        </strong>{" "}
        respecto del promedio urbano de Posadas.
        {anomalia !== null && Number.isFinite(anomalia)
          ? ` La anomalía histórica (comparada con el mismo mes de años anteriores) es ${
              anomalia > 0 ? "+" : ""
            }${anomalia.toFixed(1)}°C.`
          : ""}
      </p>
      <p className="mt-3 text-xs text-neutral-muted dark:text-dk-muted">
        Dato derivado de {r.n_observaciones_historico + 1} composites Landsat
        mensuales (medidos a ~10:30 AM hora local). Los valores son{" "}
        <em>temperatura de superficie</em> (LST), no temperatura del aire
        ambiente a 1,5 m. Ver metodología para detalles.
      </p>
    </div>
  );
}
