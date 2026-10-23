"""Registro automático de lluvia medida en la estación SMN Posadas Aero (87178).

Los reportes SYNOP son los mensajes oficiales que la estación del SMN envía a la
red de la OMM. Ogimet los redistribuye sin cambios y el ISD de la NOAA guarda el
texto original de cada uno: el historial se arma con el ISD (un archivo por año)
y lo reciente con Ogimet. El día pluviométrico va de las 9 a las 9 hora argentina
(12 a 12 UTC), igual que en los registros del SMN. Un día sin reporte de 24 h, o
con un total que no cuadra con los demás reportes del día, queda vacío: nunca se
completa ni se corrige.
"""

import argparse
import io
import re
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
OGIMET_METAR = "https://www.ogimet.com/cgi-bin/getmetar"
ISD = "https://noaa-global-hourly-pds.s3.amazonaws.com/{anio}/87178099999.csv"
DESTINO = ROOT / "webapp/frontend/public/data/nino/lluvia_observada_diaria.csv"
COLUMNAS = ["fecha", "mm", "control", "tormenta", "granizo", "reportes", "fuente"]
FUENTES = {
    "ogimet": "SMN, estación Posadas Aero (SYNOP 87178 vía Ogimet)",
    "isd": "SMN, estación Posadas Aero (SYNOP 87178 vía NOAA ISD)",
}
# Tiempo presente (ww) de la tabla 4677 de la OMM.
WW_TORMENTA = {17, 29, *range(91, 100)}
WW_GRANIZO = {27, 87, 88, 89, 90, 93, 94, 96, 99}
# Lluvia, llovizna, chaparrón o tormenta, en el momento o en la última hora.
WW_LLUVIA = {17, *range(20, 28), 29, *range(50, 100)}
# Lluvia fuerte: continua o intermitente, chaparrón violento o tormenta fuerte.
WW_FUERTE = {64, 65, 81, 82, 92, 97, 99}
# Tope de intensidad por hora según lo que informa el METAR: límite superior de
# las clases de la OMM (débil 2,5, moderada 10 y fuerte 50 mm/h; OMM-N.º 8) por
# un margen amplio, porque el METAR describe un instante. Sin lluvia ni grupo RE
# pudo haber, a lo sumo, lluvia débil entre dos observaciones.
INTENSIDAD_MM_H = {"": 2.5, "-": 2.5, "moderada": 10, "RE": 50, "+": float("inf")}
MARGEN_INTENSIDAD = 10
# Duración del grupo 6RRRtR (tabla 4019 de la OMM), en horas.
TR_HORAS = {"1": 6, "2": 12, "3": 18, "4": 24, "5": 1, "6": 2, "7": 3, "8": 9, "9": 15}
# Tramos de 6 h de un día pluviométrico, por hora UTC de cierre.
TRAMOS = (18, 0, 6, 12)
# Control de calidad del total de 24 h contra los demás reportes del día. Los
# grupos de 6 h vienen en mm enteros: de ahí la tolerancia.
TOLERANCIA_MM = 2
# Si el total supera a sus partes de 6 h en más que esto, algún reporte de esos
# tramos tiene que indicar lluvia o tormenta.
MAX_SIN_EXPLICAR = 25
# Un total mayor solo se acepta si las cuatro partes de 6 h lo confirman.
MAX_DIA_SIN_PARTES = 300


def _rrr(code):
    """Tabla 3590 de la OMM: 990 es lluvia inapreciable, 991-999 décimas."""
    value = int(code)
    if value == 990:
        return 0.0
    return (value - 990) / 10 if value > 990 else float(value)


def _en_orden(grupos, primero):
    """Grupos de una sección con su indicador en orden creciente; el resto se descarta."""
    siguiente = primero
    for grupo in grupos:
        if len(grupo) != 5 or not grupo[0].isdigit() or int(grupo[0]) < siguiente:
            continue
        siguiente = int(grupo[0])
        yield grupo


def decodificar(linea, fuente="ogimet"):
    """Hora UTC, lluvia de 6 y 24 h, tiempo presente y si el reporte indica lluvia."""
    partes = linea.strip().rstrip("=").split(",")
    if len(partes) < 7 or partes[0] != ESTACION:
        return None
    y, m, d, h = (int(x) for x in partes[1:5])
    grupos = partes[6].split()
    if len(grupos) < 5 or grupos[0] != "AAXX":
        return None
    cuerpo = grupos[3:]
    # Secciones: 1 hasta "333"; 3 hasta "444", "555" u otro "333" (mensajes pegados).
    # La 555 es nacional y su grupo 7 no es lluvia: leerlo así inventaba 251,8 mm
    # el 02/03/2017, y un segundo "333" pegado inventaba 181,7 mm el 11/05/2001.
    fin1 = next((i for i, g in enumerate(cuerpo) if g in ("333", "444", "555")), len(cuerpo))
    seccion1 = cuerpo[:fin1]
    seccion3 = []
    if "333" in cuerpo:
        resto = cuerpo[cuerpo.index("333") + 1 :]
        seccion3 = resto[
            : next((i for i, g in enumerate(resto) if g in ("333", "444", "555")), len(resto))
        ]
    ir = seccion1[0][0] if seccion1 and seccion1[0] else "/"
    lluvia, ww, pasado = {}, None, []
    # Sección 1: los dos primeros grupos son obligatorios; el resto va de 1 a 9.
    for grupo in _en_orden(seccion1[2:], 1):
        if grupo[0] == "6" and grupo[1:4].isdigit() and grupo[4] in TR_HORAS:
            lluvia.setdefault(TR_HORAS[grupo[4]], _rrr(grupo[1:4]))
        if grupo[0] == "7" and grupo[1:3].isdigit():
            ww = int(grupo[1:3])
            pasado = [int(c) for c in grupo[3:5] if c.isdigit()]
    total_seccion3 = None
    for grupo in _en_orden(seccion3, 0):
        if grupo[0] == "6" and grupo[1:4].isdigit() and grupo[4] in TR_HORAS:
            lluvia.setdefault(TR_HORAS[grupo[4]], _rrr(grupo[1:4]))
        if grupo[0] == "7" and grupo[1:].isdigit():
            valor = int(grupo[1:])
            total_seccion3 = 0.0 if valor == 9999 else valor / 10
    if total_seccion3 is not None:
        lluvia.setdefault(24, total_seccion3)
    # iR=3: no llovió y la estación omite los grupos de lluvia (tabla 1819 de la OMM).
    # Si aun así informa un total de 24 h positivo, el mensaje se contradice.
    if ir == "3":
        lluvia = {6: 0.0, 24: None if total_seccion3 else 0.0}
    # Evidencia de lluvia en el tramo del reporte: el total de 24 h no cuenta.
    llovio = (
        ww in WW_LLUVIA
        or any(w >= 5 for w in pasado)
        or any(v for horas, v in lluvia.items() if horas <= 6 and v)
    )
    return {
        "utc": datetime(y, m, d, h, tzinfo=timezone.utc),
        "mm_24h": lluvia.get(24) if h == 12 else None,
        "mm_6h": lluvia.get(6) if h % 6 == 0 else None,
        "ww": ww,
        "llovio": llovio,
        "fuente": fuente,
    }


def decodificar_metar(linea):
    """METAR o SPECI en formato Ogimet: hora, si informa lluvia y su intensidad máxima.

    Cuenta la precipitación en la estación, actual o reciente (RE); no la de las
    inmediaciones (VC). Las observaciones (RMK) no se leen.
    """
    partes = linea.strip().split(",", 6)
    if len(partes) < 7 or not partes[1].isdigit():
        return None
    y, m, d, h, mi = (int(x) for x in partes[1:6])
    texto = re.split(r"\s(?:RMK|REMK)\s", f" {partes[6]} ")[0]
    tiempo = re.findall(r"(?<=\s)(\+|-|RE)?((?:TS|SH)?(?:RA|DZ|GR|GS)+)(?=[\s=])", texto)
    return {
        "utc": datetime(y, m, d, h, mi, tzinfo=timezone.utc),
        "llovio": bool(tiempo),
        "mm_h": max([INTENSIDAD_MM_H[signo or "moderada"] for signo, _ in tiempo] or [2.5]),
    }


def control_dia(total, partes, con_lluvia=frozenset(), topes=None):
    """Contrasta el total de 24 h con lo que informan los demás reportes del día.

    partes: lluvia de 6 h por hora UTC de cierre del tramo (18, 0, 6 y 12).
    con_lluvia: cierres de los tramos en que algún SYNOP o METAR indicó lluvia,
    llovizna o tormenta. topes: lo máximo que pudo llover en cada tramo según la
    intensidad de los METAR (sin tope si faltan observaciones). Devuelve (total,
    "ok") o, si no cuadra, (None, "dudoso"): un error en el mensaje original (919
    mm el 12/05/2004 con 0,9 mm en sus partes) no se corrige, se descarta.
    """
    if total is None:
        return None, "sin_total"
    topes = topes or {}
    resto = total - sum(partes.values())
    faltan = set(TRAMOS) - set(partes)
    if faltan:
        cuadra = (
            -TOLERANCIA_MM <= resto
            and total <= MAX_DIA_SIN_PARTES
            and (resto <= MAX_SIN_EXPLICAR or bool(faltan & set(con_lluvia)))
            and resto <= sum(topes.get(t, float("inf")) for t in faltan) + TOLERANCIA_MM
        )
    else:
        cuadra = abs(resto) <= max(TOLERANCIA_MM, 0.1 * total)
    posibles = all(mm <= topes.get(t, float("inf")) + TOLERANCIA_MM for t, mm in partes.items())
    return (total, "ok") if cuadra and posibles else (None, "dudoso")


def _hora_de_cierre(utc):
    """Fin de la hora (h-1, h] a la que pertenece una observación."""
    base = utc.replace(minute=0, second=0, microsecond=0)
    return base + timedelta(hours=1) if utc != base else base


def tramo(utc):
    """Hora UTC de cierre del tramo de 6 h (18, 0, 6 o 12) al que pertenece un reporte."""
    return (-(-_hora_de_cierre(utc).hour // 6) * 6) % 24


def intensidad_por_hora(reportes, metars):
    """Tope de lluvia (mm/h) de cada hora según el METAR más intenso de esa hora.

    Si un SYNOP de esa hora informa lluvia fuerte, la hora queda sin tope.
    """
    por_hora = {}
    for m in metars:
        hora = _hora_de_cierre(m["utc"])
        por_hora[hora] = max(por_hora.get(hora, 0), m["mm_h"])
    for r in reportes:
        if r["ww"] in WW_FUERTE:
            por_hora[_hora_de_cierre(r["utc"])] = float("inf")
    return por_hora


def tope_tramo(por_hora, fin):
    """Máximo de lluvia posible en las 6 h que terminan en fin (sin tope si falta una hora)."""
    horas = [por_hora.get(fin - timedelta(hours=k)) for k in range(6)]
    if any(h is None for h in horas):
        return float("inf")
    return MARGEN_INTENSIDAD * sum(horas)


def dia_pluviometrico(utc):
    """Fecha del día de 12 a 12 UTC al que pertenece un reporte (12 UTC incluido)."""
    return utc.date() + timedelta(days=0 if (utc.hour, utc.minute) <= (12, 0) else 1)


def resumir_por_dia(reportes, metars=()):
    """Un día pluviométrico termina a las 12 UTC de su fecha (12 UTC incluido)."""
    dias = {}
    for r in reportes:
        dia = dias.setdefault(
            dia_pluviometrico(r["utc"]),
            {"tormenta": False, "granizo": False, "n": 0, "partes": {}, "con_lluvia": set()},
        )
        dia["n"] += 1
        dia.setdefault("fuente", r.get("fuente", "ogimet"))
        if r["utc"].hour % 6 == 0 and r.get("mm_6h") is not None:
            dia["partes"][r["utc"].hour] = r["mm_6h"]
        if r["utc"].hour == 12:
            dia["total"] = r["mm_24h"]
            dia["fuente"] = r.get("fuente", "ogimet")
        if r["ww"] in WW_TORMENTA:
            dia["tormenta"] = True
        if r["ww"] in WW_GRANIZO:
            dia["granizo"] = True
    for r in [*reportes, *metars]:
        dia = dias.get(dia_pluviometrico(r["utc"]))
        if dia is not None and r.get("llovio"):
            dia["con_lluvia"].add(tramo(r["utc"]))
    por_hora = intensidad_por_hora(reportes, metars)
    filas = []
    for fecha, dia in sorted(dias.items()):
        cierre = datetime(fecha.year, fecha.month, fecha.day, 12, tzinfo=timezone.utc)
        topes = {
            (12 - atras) % 24: tope_tramo(por_hora, cierre - timedelta(hours=atras))
            for atras in (0, 6, 12, 18)
        }
        mm, control = control_dia(dia.get("total"), dia["partes"], dia["con_lluvia"], topes)
        filas.append(
            {
                "fecha": fecha.isoformat(),
                "mm": mm,
                "control": control,
                "tormenta": dia["tormenta"],
                "granizo": dia["granizo"],
                "reportes": dia["n"],
                "fuente": FUENTES[dia["fuente"]],
            }
        )
    return filas


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


def lineas_isd(texto):
    """Mensajes SYNOP y METAR originales que el ISD guarda en la columna REM.

    Se devuelven en formato Ogimet. Desde 2013 el ISD guarda el SYNOP sin su
    encabezado "AAXX YYGGi": se repone con la fecha de la observación. Si hay
    correcciones de la misma hora, queda la última.
    """
    tabla = pd.read_csv(io.StringIO(texto), usecols=["DATE", "REM"], dtype=str)
    synop, metar = {}, {}
    for fecha, rem in zip(tabla["DATE"], tabla["REM"].fillna("")):
        t = datetime.fromisoformat(fecha)
        mensaje = re.search(rf"SYN\d{{3}}(?:AAXX\s+\S+\s+)?({ESTACION}\s[^;]*)", rem)
        if mensaje and not t.minute:
            cuerpo = " ".join(mensaje.group(1).rstrip("=").split())
            synop[t] = f"{ESTACION},{t:%Y,%m,%d,%H},00,AAXX {t:%d%H}/ {cuerpo}"
        for aviso in re.findall(r"MET\d{3}((?:METAR|SPECI)\s[^;]*)", rem):
            metar[t] = f"SARP,{t:%Y,%m,%d,%H,%M},{' '.join(aviso.split())}"
    return [synop[t] for t in sorted(synop)], [metar[t] for t in sorted(metar)]


def descargar_isd(anio, sesion):
    """SYNOP y METAR de un año del ISD de la NOAA (vacío si el año no está publicado)."""
    respuesta = sesion.get(ISD.format(anio=anio), timeout=300)
    if respuesta.status_code in (403, 404):
        return [], []
    respuesta.raise_for_status()
    synop, metar = lineas_isd(respuesta.text)
    return (
        [r for r in (decodificar(line, "isd") for line in synop) if r],
        [r for r in (decodificar_metar(line) for line in metar) if r],
    )


def descargar_metar(desde, hasta, sesion):
    """METAR y SPECI de Ogimet; si no responden, el control se hace sin ellos."""
    params = {
        "icao": "SARP",
        "begin": desde.strftime("%Y%m%d%H%M"),
        "end": hasta.strftime("%Y%m%d%H%M"),
    }
    try:
        respuesta = sesion.get(
            OGIMET_METAR, params=params, timeout=60, headers={"User-Agent": "sateliteposadas.com"}
        )
        respuesta.raise_for_status()
    except requests.RequestException:
        return []
    lineas = [line for line in respuesta.text.splitlines() if line.startswith("SARP,")]
    return [r for r in (decodificar_metar(line) for line in lineas) if r]


def fusionar(existente, nuevos):
    """Los valores nuevos reemplazan a los anteriores, salvo que no traigan total.

    Un día de 12 a 12 UTC puede llegar partido entre dos consultas: las marcas de
    tormenta y granizo se combinan, no se pisan. Un total dudoso sí reemplaza al
    anterior: el control vale también para lo ya registrado.
    """
    tabla = {row["fecha"]: row for row in existente}
    for row in nuevos:
        previo = tabla.get(row["fecha"])
        if previo is not None:
            sin_total = row["control"] == "sin_total"
            row = {
                **row,
                "mm": previo.get("mm") if sin_total else row["mm"],
                "control": previo.get("control") if sin_total else row["control"],
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


def inicio_de_dia(t):
    """13 UTC del día anterior a t: primera hora del día pluviométrico que termina en t."""
    return datetime(t.year, t.month, t.day, 13, tzinfo=timezone.utc) - timedelta(days=1)


def huecos(filas, desde, hasta, unir_dias=4):
    """Tramos de días pluviométricos sin total entre dos fechas, unidos si están cerca."""
    con_total = {f["fecha"] for f in filas if f["control"] != "sin_total"}
    rangos, dia = [], desde
    while dia <= hasta:
        if dia.isoformat() not in con_total:
            if rangos and (dia - rangos[-1][1]).days <= unir_dias:
                rangos[-1][1] = dia
            else:
                rangos.append([dia, dia])
        dia += timedelta(days=1)
    return [
        (inicio_de_dia(a), datetime(b.year, b.month, b.day, 12, 30, tzinfo=timezone.utc))
        for a, b in rangos
    ]


def bajar_ogimet(desde, hasta, sesion, tramo_dias, al_tramo):
    """SYNOP y METAR de Ogimet por tramos de días enteros (desde las 13 UTC), con pausa.

    Cada tramo se entrega a al_tramo apenas llega, para guardarlo: si la corrida se
    corta, lo bajado queda y la próxima sigue desde ahí. Devuelve la última hora.
    """
    inicio, ultimo = desde, None
    while inicio < hasta:
        fin = min(inicio + timedelta(days=tramo_dias), hasta)
        reportes = descargar_adaptativo(inicio, fin, sesion)
        if reportes:
            time.sleep(10)
            al_tramo(reportes, descargar_metar(inicio, fin, sesion))
            ultimo = max(r["utc"] for r in reportes)
        inicio = fin
        if inicio < hasta:
            time.sleep(20)
    return ultimo


def leer_registro():
    if not DESTINO.exists():
        return []
    filas = pd.read_csv(DESTINO).to_dict("records")
    for fila in filas:
        if pd.isna(fila["mm"]):
            fila["mm"] = None
        if pd.isna(fila.get("control")):
            fila["control"] = "sin_total" if fila["mm"] is None else "ok"
    return filas


def guardar(filas):
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(filas, columns=COLUMNAS).to_csv(DESTINO, index=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dias", type=int, default=10, help="días hacia atrás a consultar")
    parser.add_argument(
        "--historico",
        type=int,
        metavar="AAAA",
        help="rehace el registro desde ese año: ISD de la NOAA y, para lo reciente, Ogimet",
    )
    parser.add_argument(
        "--tramo-dias", type=int, default=60, help="días por consulta a Ogimet (acepta hasta ~180)"
    )
    args = parser.parse_args()
    cfg = yaml.safe_load((ROOT / "config/alertas.yaml").read_text(encoding="utf-8"))
    umbral = cfg["nino_tiempo_real"]["dia_fuerte_registro_mm"]
    ahora = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    sesion = requests.Session()
    filas, ultimo = [], None

    def al_tramo(reportes, metars):
        nonlocal filas
        filas = fusionar(filas, resumir_por_dia(reportes, metars))
        guardar(filas)

    if args.historico:
        reportes, metars = [], []
        for anio in range(args.historico, ahora.year + 1):
            synop, metar = descargar_isd(anio, sesion)
            reportes += synop
            metars += metar
        ultimo = max((r["utc"] for r in reportes), default=None)
        print(f"ISD de la NOAA: {len(reportes)} SYNOP y {len(metars)} METAR hasta {ultimo}.")
        filas = resumir_por_dia(reportes, metars)
        guardar(filas)
        # Lo que el ISD no tiene (días sin total y lo más reciente) se pide a Ogimet.
        tramos = [(datetime(args.historico, 1, 1, 13, tzinfo=timezone.utc), ahora)]
        if ultimo:
            hasta = ultimo.date() - timedelta(days=1)
            tramos = huecos(filas, date(args.historico, 1, 1), hasta)
            tramos.append((inicio_de_dia(ultimo), ahora))
        for desde, hasta in tramos:
            try:
                ultimo = bajar_ogimet(desde, hasta, sesion, args.tramo_dias, al_tramo) or ultimo
            except (requests.RequestException, RuntimeError) as error:
                print(f"Ogimet no respondió para {desde:%Y-%m-%d}: {error}")
            time.sleep(20)
    else:
        filas = leer_registro()
        # Si el registro quedó atrasado (corridas que fallaron), se completa desde su último día.
        desde = ahora - timedelta(days=args.dias)
        registrado = max((f["fecha"] for f in filas), default=None)
        if registrado:
            desde = min(desde, datetime.fromisoformat(registrado).replace(tzinfo=timezone.utc))
        ultimo = bajar_ogimet(inicio_de_dia(desde), ahora, sesion, args.tramo_dias, al_tramo)
        if ultimo is None:
            raise SystemExit("Ogimet no devolvió reportes; se conserva el registro anterior.")
    fuertes = [f for f in filas if pd.notna(f["mm"]) and f["mm"] >= umbral]
    dudosos = sum(f["control"] == "dudoso" for f in filas)
    print(
        f"Lluvia observada: {len(filas)} días en el registro, {len(fuertes)} con "
        f"{umbral} mm o más, {dudosos} descartados por control de calidad. "
        f"Último reporte: {ultimo.isoformat() if ultimo else 'ninguno'}"
    )


if __name__ == "__main__":
    main()
