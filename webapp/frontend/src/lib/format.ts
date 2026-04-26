// Helpers de formato compartidos para el frontend.
//
// El centro de este módulo es distinguir "no hay dato" de "el dato es 0".
// Cuando el CSV no tiene una fila para un polígono, los getters devuelven
// `null` o `undefined`. En ese caso queremos mostrar "s/d", no "0", para
// no confundir al usuario con un valor real cero.
//
// Convención:
//   - `null | undefined | NaN`            → fallback ("s/d" por defecto)
//   - `0` numérico                        → se muestra como "0" (es un dato real)
//   - número finito                       → se formatea con locale es-AR
//
// Para casos específicos donde 0 también es ausencia de dato (ej. población
// estimada sintética) los componentes pueden pasar `treatZeroAsMissing: true`.

/**
 * Devuelve `true` si el valor representa "no hay dato" (null/undefined/NaN).
 * Por contrato, 0 es un dato real, no ausencia.
 */
export function isMissing(
  n: number | null | undefined,
): n is null | undefined {
  if (n === null || n === undefined) return true;
  if (typeof n !== "number") return true;
  if (Number.isNaN(n)) return true;
  return false;
}

interface FormatNumberOptions {
  /** Locale para `toLocaleString`. Default es-AR. */
  locale?: string;
  /** Cantidad fija de decimales (ej. 2 para "0.00"). */
  decimals?: number;
  /** Sufijo opcional, ej. "%", " km²", "°C". */
  suffix?: string;
  /**
   * Si `true`, considera 0 como "no hay dato" y devuelve fallback.
   * Útil para campos como `poblacion_estimada` o `edificios_2026` cuando el
   * polígono no tiene fila en el CSV y el geojson rellena con 0.
   */
  treatZeroAsMissing?: boolean;
}

/**
 * Formatea un número, devolviendo `fallback` ("s/d" por defecto) cuando no
 * hay dato. Distingue null/undefined/NaN (sin dato) de 0 (dato real).
 */
export function formatNumber(
  n: number | null | undefined,
  fallback: string = "s/d",
  options: FormatNumberOptions = {},
): string {
  if (isMissing(n)) return fallback;
  const value = n as number;
  if (options.treatZeroAsMissing && value === 0) return fallback;

  const locale = options.locale ?? "es-AR";
  let formatted: string;
  if (typeof options.decimals === "number") {
    formatted = value.toLocaleString(locale, {
      minimumFractionDigits: options.decimals,
      maximumFractionDigits: options.decimals,
    });
  } else {
    formatted = value.toLocaleString(locale, { maximumFractionDigits: 0 });
  }
  return options.suffix ? `${formatted}${options.suffix}` : formatted;
}

/**
 * Variante específica para porcentajes 0–100. Si el valor es null/undefined
 * o NaN, devuelve fallback. 0% es válido.
 *
 * Para servicios donde 0 también puede significar "fila ausente" (ej. cuando
 * el script no encontró cobertura registrada), pasar `treatZeroAsMissing: true`
 * es responsabilidad del consumidor — por defecto 0% se muestra.
 */
export function formatPercent(
  n: number | null | undefined,
  fallback: string = "s/d",
  decimals: number = 0,
): string {
  if (isMissing(n)) return fallback;
  const value = n as number;
  return `${value.toFixed(decimals)}%`;
}

/**
 * Variante para valores de tipo "índice 0..1". Multiplica por 1 (ya viene
 * en escala) y formatea con dos decimales.
 */
export function formatIndice(
  n: number | null | undefined,
  fallback: string = "s/d",
): string {
  if (isMissing(n)) return fallback;
  return (n as number).toFixed(2);
}
