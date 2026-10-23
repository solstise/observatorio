"""Registro automático de lluvia medida en la estación SMN Posadas Aero (87178).

Los reportes SYNOP son los mensajes oficiales que la estación del SMN envía a la
red de la OMM. Ogimet los redistribuye sin cambios. El día pluviométrico va de
las 9 a las 9 hora argentina (12 a 12 UTC), igual que en los registros del SMN.
Un día sin reporte de 24 h queda vacío: nunca se completa con cero.
"""

import argparse
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pandas as pd
import requests
import yaml

ESTACION = "87178"
OGIMET = "https://www.ogimet.com/cgi-bin/getsynop"
DESTINO = ROOT / "webapp/frontend/public/data/nino/lluvia_observada_diaria.csv"
COLUMNAS = ["fecha", "mm", "tormenta", "granizo", "reportes", "fuente"]
FUENTE = "SMN, estación Posadas Aero (SYNOP 87178 vía Ogimet)"
# Tiempo presente (ww) de la tabla 4677 de la OMM.
WW_TORMENTA = {17, 29, *range(91, 100)}
WW_GRANIZO = {27, 87, 88, 89, 90, 93, 94, 96, 99}
# Control de calidad: la parte de 06 a 12 UTC que se deduce del total de 24 h no
# puede superar este valor, ni el total puede ser menor que sus partes.
MAX_BLOQUE_6H = 200
# Sin partes para comparar, un total mayor se descarta como dudoso.
MAX_DIA_SIN_PARTES = 300


def _rrr(code):
    """Tabla 3590 de la OMM: 990 es lluvia inapreciable, 991-999 décimas."""
    value = int(code)
    if value == 990:
        return 0.0
    return (value - 990) / 10 if value > 990 else float(value)


def decodificar(linea):
    """Devuelve hora UTC, lluvia de 24 h (si se informa) y tiempo presente."""
    partes = linea.strip().rstrip("=").split(",")
    if len(partes) < 7 or partes[0] != ESTACION:
        return None
    y, m, d, h = (int(x) for x in partes[1:5])
    grupos = partes[6].split()
    if len(grupos) < 5 or grupos[0] != "AAXX":
        return None
    cuerpo = grupos[3:]
    # Secciones: 1 hasta "333", 3 hasta "444" o "555" (la 555 es nacional y su
    # grupo 7 no es lluvia: leerlo así inventaba 251,8 mm el 02/03/2017).
    fin1 = next((i for i, g in enumerate(cuerpo) if g in ("333", "444", "555")), len(cuerpo))
    seccion1 = cuerpo[:fin1]
    seccion3 = []
    if "333" in cuerpo:
        resto = cuerpo[cuerpo.index("333") + 1 :]
        seccion3 = resto[
            : next((i for i, g in enumerate(resto) if g in ("444", "555")), len(resto))
        ]
    ir = seccion1[0][0] if seccion1 and seccion1[0] else "/"
    lluvia = {}
    ww = None
    siguiente = 1
    # Grupos de la sección 1 en orden 1..9; los dos primeros son obligatorios.
    for grupo in seccion1[2:]:
        if len(grupo) != 5 or not grupo[0].isdigit() or int(grupo[0]) < siguiente:
            continue
        siguiente = int(grupo[0]) + 1
        if grupo[0] == "6" and grupo[1:4].isdigit() and grupo[4] in "1234":
            lluvia[{"1": 6, "2": 12, "3": 18, "4": 24}[grupo[4]]] = _rrr(grupo[1:4])
        if grupo[0] == "7" and grupo[1:3].isdigit():
            ww = int(grupo[1:3])
    for grupo in seccion3:
        if len(grupo) == 5 and grupo[0] == "7" and grupo[1:].isdigit() and 24 not in lluvia:
            valor = int(grupo[1:])
            lluvia[24] = 0.0 if valor == 9999 else valor / 10
    # iR=3: la estación no tuvo lluvia y omite el grupo.
    if ir == "3" and h % 6 == 0:
        lluvia.setdefault(24 if h == 12 else 6, 0.0)
    return {
        "utc": datetime(y, m, d, h, tzinfo=timezone.utc),
        "mm_24h": lluvia.get(24) if h == 12 else None,
        "mm_6h": lluvia.get(6) if h in (0, 6, 18) else None,
        "ww": ww,
    }


def control_dia(total, partes, completas=True):
    """Total de 24 h contra los grupos de 6 h del mismo día (18, 00 y 06 UTC).

    Devuelve el total si es coherente o None si es dudoso (error de tipeo en el
    mensaje original: el 12/05/2004 informa 919 mm con 0,3 mm en sus partes).
    Con partes incompletas (día partido entre consultas) solo se exige que el
    total no sea menor que lo informado y se aplica el tope general.
    """
    if total is None:
        return None
    suma = sum(partes)
    if partes and total < suma - 1:
        return None
    if partes and completas:
        return None if total - suma > MAX_BLOQUE_6H else total
    return None if total > MAX_DIA_SIN_PARTES else total


def resumir_por_dia(reportes):
    """Un día pluviométrico termina a las 12 UTC de su fecha (12 UTC incluido)."""
    dias = {}
    for r in reportes:
        fin = r["utc"].date() + timedelta(days=0 if r["utc"].hour <= 12 else 1)
        dia = dias.setdefault(
            fin, {"mm": None, "tormenta": False, "granizo": False, "n": 0, "partes": {}}
        )
        dia["n"] += 1
        if r.get("mm_6h") is not None:
            dia["partes"][r["utc"].hour] = r["mm_6h"]
        if r["utc"].hour == 12 and r["mm_24h"] is not None:
            dia["total"] = r["mm_24h"]
        if r["ww"] in WW_TORMENTA:
            dia["tormenta"] = True
        if r["ww"] in WW_GRANIZO:
            dia["granizo"] = True
    for dia in dias.values():
        partes = dia["partes"]
        dia["mm"] = control_dia(dia.get("total"), list(partes.values()), set(partes) == {0, 6, 18})
    return [
        {
            "fecha": fecha.isoformat(),
            "mm": valores["mm"],
            "tormenta": valores["tormenta"],
            "granizo": valores["granizo"],
            "reportes": valores["n"],
            "fuente": FUENTE,
        }
        for fecha, valores in sorted(dias.items())
    ]


def descargar(desde, hasta, sesion=None):
    sesion = sesion or requests.Session()
    params = {
        "block": ESTACION,
        "begin": desde.strftime("%Y%m%d%H%M"),
        "end": hasta.strftime("%Y%m%d%H%M"),
    }
    respuesta = sesion.get(
        OGIMET, params=params, timeout=60, headers={"User-Agent": "sateliteposadas.com"}
    )
    respuesta.raise_for_status()
    lineas = [line for line in respuesta.text.splitlines() if line.startswith(ESTACION + ",")]
    if not lineas and "Status" in respuesta.text:
        raise RuntimeError(f"Ogimet respondió sin datos: {respuesta.text[:200]}")
    return [r for r in (decodificar(line) for line in lineas) if r]


def fusionar(existente, nuevos):
    """Los valores nuevos reemplazan a los anteriores, salvo que vengan vacíos.

    Un día de 12 a 12 UTC puede llegar partido entre dos consultas: las marcas de
    tormenta y granizo se combinan, no se pisan.
    """
    tabla = {row["fecha"]: row for row in existente}
    for row in nuevos:
        previo = tabla.get(row["fecha"])
        if previo is not None:
            row = {
                **row,
                "mm": row["mm"] if row["mm"] is not None else previo.get("mm"),
                "tormenta": bool(row["tormenta"]) or bool(previo.get("tormenta")),
                "granizo": bool(row["granizo"]) or bool(previo.get("granizo")),
                "reportes": max(row["reportes"], int(previo.get("reportes") or 0)),
            }
            if pd.isna(row["mm"]):
                row["mm"] = None
        tabla[row["fecha"]] = row
    return [tabla[fecha] for fecha in sorted(tabla)]


def descargar_con_reintentos(desde, hasta, sesion, intentos=4):
    for intento in range(intentos):
        try:
            return descargar(desde, hasta, sesion)
        except (requests.RequestException, RuntimeError):
            if intento == intentos - 1:
                raise
            time.sleep(30 * 2**intento)


def descargar_adaptativo(desde, hasta, sesion, minimo_dias=10, pausa=10):
    """Ogimet devuelve vacío, sin error, los pedidos largos de algunos años.

    Si un tramo trae menos del 80 % de los días esperados se divide en dos y se
    vuelve a pedir, hasta tramos de 10 días: así un hueco real del archivo no se
    confunde con una respuesta recortada.
    """
    reportes = descargar_con_reintentos(desde, hasta, sesion)
    dias = (hasta - desde).total_seconds() / 86400
    cubiertos = len({r["utc"].date() for r in reportes})
    if dias <= minimo_dias or cubiertos >= 0.8 * dias:
        return reportes
    medio = desde + (hasta - desde) / 2
    time.sleep(pausa)
    primera = descargar_adaptativo(desde, medio, sesion, minimo_dias, pausa)
    time.sleep(pausa)
    return primera + descargar_adaptativo(medio, hasta, sesion, minimo_dias, pausa)


def guardar(filas):
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(filas, columns=COLUMNAS).to_csv(DESTINO, index=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dias", type=int, default=10, help="días hacia atrás a consultar")
    parser.add_argument("--desde", help="AAAA-MM-DD para completar el registro histórico")
    parser.add_argument(
        "--tramo-dias", type=int, default=25, help="días por consulta (Ogimet acepta hasta ~180)"
    )
    args = parser.parse_args()
    cfg = yaml.safe_load((ROOT / "config/alertas.yaml").read_text(encoding="utf-8"))
    umbral = cfg["nino_tiempo_real"]["dia_fuerte_registro_mm"]
    ahora = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    inicio = (
        datetime.combine(date.fromisoformat(args.desde), datetime.min.time(), timezone.utc)
        if args.desde
        else ahora - timedelta(days=args.dias)
    )
    # Ogimet limita el tamaño de cada consulta: se pide por tramos con pausa y se
    # guarda después de cada uno, para no perder lo bajado si una consulta falla.
    filas = pd.read_csv(DESTINO).to_dict("records") if DESTINO.exists() else []
    tramo, sesion, ultimo, nuevos = inicio, requests.Session(), None, 0
    while tramo < ahora:
        fin = min(tramo + timedelta(days=args.tramo_dias), ahora)
        reportes = descargar_adaptativo(tramo, fin, sesion)
        if reportes:
            filas = fusionar(filas, resumir_por_dia(reportes))
            guardar(filas)
            ultimo = max(r["utc"] for r in reportes)
            nuevos += len(reportes)
        tramo = fin
        if tramo < ahora:
            time.sleep(20)
    if not nuevos:
        raise SystemExit("Ogimet no devolvió reportes; se conserva el registro anterior.")
    fuertes = [f for f in filas if pd.notna(f["mm"]) and f["mm"] >= umbral]
    print(
        f"Lluvia observada: {len(filas)} días en el registro, {len(fuertes)} con "
        f"{umbral} mm o más. Último reporte: {ultimo.isoformat()}"
    )


if __name__ == "__main__":
    main()
