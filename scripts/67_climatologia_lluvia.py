"""Climatología de lluvia de la estación SMN Posadas Aero a partir del registro diario.

Responde "¿es mucho?" sin modelos: cuántas veces por año la estación midió un día (o
tres días seguidos) con al menos tanta lluvia, y cuánto llueve en un mes típico.
Solo se usan años con al menos 90 % de los días informados, para que los huecos no
hagan parecer raras lluvias que no lo son. El tamaño de la muestra se publica.
"""

import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pandas as pd

REGISTRO = ROOT / "webapp/frontend/public/data/nino/lluvia_observada_diaria.csv"
DESTINO = ROOT / "webapp/frontend/public/data/nino/climatologia.json"
COMPLETITUD = 0.9
UMBRAL_GUARDADO = 10  # mm: los valores menores no hacen falta para frecuencias de lluvia fuerte


def anios_completos(serie):
    """Años calendario con ≥ 90 % de días con dato (el año en curso queda afuera)."""
    hoy = date.today()
    resultado = []
    for anio, grupo in serie.groupby(serie.index.year):
        if anio >= hoy.year:
            continue
        dias = 366 if pd.Timestamp(anio, 12, 31).dayofyear == 366 else 365
        if grupo.notna().sum() / dias >= COMPLETITUD:
            resultado.append(int(anio))
    return resultado


def eventos_tres_dias(serie):
    """Sumas de 3 días sin solapar: se toma la mayor y se descartan sus vecinas."""
    suma = serie.rolling(3, min_periods=3).sum().dropna().sort_values(ascending=False)
    tomados, usados = [], set()
    for fin, valor in suma.items():
        dias = {fin - pd.Timedelta(days=k) for k in range(3)}
        if dias & usados:
            continue
        usados |= dias
        tomados.append(round(float(valor), 1))
    return tomados


def climatologia(tabla):
    serie = tabla.set_index(pd.to_datetime(tabla.fecha))["mm"].astype(float).sort_index()
    serie = serie.asfreq("D")
    completos = anios_completos(serie)
    en_completos = serie[serie.index.year.isin(completos)]
    diarios = sorted(
        (round(float(v), 1) for v in en_completos.dropna() if v >= UMBRAL_GUARDADO), reverse=True
    )
    tres = [v for v in eventos_tres_dias(en_completos) if v >= 2 * UMBRAL_GUARDADO]
    mensual = {}
    for mes in range(1, 13):
        totales = []
        for anio in completos:
            dias_mes = en_completos[
                (en_completos.index.year == anio) & (en_completos.index.month == mes)
            ]
            if len(dias_mes) and dias_mes.notna().mean() >= COMPLETITUD:
                totales.append(float(dias_mes.sum()))
        if totales:
            s = pd.Series(totales)
            mensual[f"{mes:02d}"] = {
                "mediana": round(float(s.median()), 1),
                "p25": round(float(s.quantile(0.25)), 1),
                "p75": round(float(s.quantile(0.75)), 1),
                "maximo": round(float(s.max()), 1),
                "n_anios": len(totales),
            }
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fuente": "SMN, estación Posadas Aero (SYNOP 87178 vía NOAA ISD y Ogimet), día de 9 a 9 h",
        "primer_dato": str(serie.first_valid_index().date()),
        "anios_completos": completos,
        "n_anios": len(completos),
        "completitud_minima": COMPLETITUD,
        "diarios_desde_10mm": diarios,
        "tres_dias_desde_20mm": tres,
        "mensual": mensual,
    }


def main():
    if not REGISTRO.exists():
        raise SystemExit("No hay registro de lluvia medida: correr antes 63_lluvia_observada.py")
    datos = climatologia(pd.read_csv(REGISTRO))
    if datos["n_anios"] < 5:
        print(f"Climatología: solo {datos['n_anios']} años completos; no se publica.")
        DESTINO.unlink(missing_ok=True)
        return
    DESTINO.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    por_anio = len([v for v in datos["diarios_desde_10mm"] if v >= 50]) / datos["n_anios"]
    print(
        f"Climatología: {datos['n_anios']} años completos desde {datos['primer_dato']}; "
        f"días con 50 mm o más: {por_anio:.1f} por año."
    )


if __name__ == "__main__":
    main()
