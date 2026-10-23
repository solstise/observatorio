"""Pronóstico de alta resolución del SMN (WRF 4 km) para la zona de Posadas.

El SMN publica el modelo WRF determinístico en el registro de datos abiertos de
AWS (bucket ``smn-ar-wrf``), cuatro corridas por día y 72 horas de plazo. Cada
archivo horario pesa unos 37 MB; se leen por rangos HTTP solo la variable de
lluvia horaria (``PP``) y las coordenadas, sin descargar el archivo completo.
Si no hay una corrida completa, se publica el estado "no_disponible": la página
no inventa valores ni reutiliza corridas viejas como si fueran nuevas.
"""

import io
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np
import requests
import yaml

BUCKET = "https://smn-ar-wrf.s3.amazonaws.com/"
DESTINO = ROOT / "webapp/frontend/public/data/nino/wrf_smn.json"
POSADAS = (-27.3667, -55.8967)
HORAS = 72
LOCAL = timezone(timedelta(hours=-3))
BLOQUE = 1 << 18


def _pedir(sesion, metodo, url, intentos=4, **kwargs):
    """S3 corta conexiones largas de vez en cuando: reintentar con espera creciente."""
    for intento in range(intentos):
        try:
            r = sesion.request(metodo, url, timeout=60, **kwargs)
            r.raise_for_status()
            return r
        except requests.RequestException:
            if intento == intentos - 1:
                raise
            time.sleep(2 ** (intento + 1))


class ArchivoRemoto(io.RawIOBase):
    """Archivo de solo lectura sobre HTTP Range.

    La metadata HDF5 se lee en lecturas chicas y dispersas: se cachea por bloques
    de 256 KB. El bloque comprimido de una variable se pide en un único rango.
    """

    def __init__(self, url, sesion):
        self.url, self.sesion, self.pos, self.bloques = url, sesion, 0, {}
        self.tamano = int(_pedir(sesion, "HEAD", url).headers["Content-Length"])

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.pos, io.SEEK_END: self.tamano}[whence]
        self.pos = base + offset
        return self.pos

    def _rango(self, inicio, fin):
        return _pedir(
            self.sesion, "GET", self.url, headers={"Range": f"bytes={inicio}-{fin}"}
        ).content

    def _bloque(self, n):
        if n not in self.bloques:
            self.bloques[n] = self._rango(n * BLOQUE, min((n + 1) * BLOQUE, self.tamano) - 1)
        return self.bloques[n]

    def readinto(self, buffer):
        fin = min(self.pos + len(buffer), self.tamano)
        if fin <= self.pos:
            return 0
        if fin - self.pos >= BLOQUE:
            datos = self._rango(self.pos, fin - 1)
        else:
            datos = b"".join(
                self._bloque(n) for n in range(self.pos // BLOQUE, (fin - 1) // BLOQUE + 1)
            )[self.pos % BLOQUE :][: fin - self.pos]
        buffer[: len(datos)] = datos
        self.pos += len(datos)
        return len(datos)


def listar(prefijo, sesion):
    claves, token = [], None
    while True:
        params = {"list-type": "2", "prefix": prefijo}
        if token:
            params["continuation-token"] = token
        r = sesion.get(BUCKET, params=params, timeout=30)
        r.raise_for_status()
        claves += re.findall(r"<Key>([^<]+)</Key>", r.text)
        siguiente = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", r.text)
        if not siguiente:
            return claves
        token = siguiente.group(1)


def ultima_corrida_completa(ahora, sesion):
    """Corrida más reciente con los 72 plazos horarios ya publicados."""
    for horas_atras in range(0, 48, 6):
        corrida = (ahora - timedelta(hours=horas_atras)).replace(minute=0, second=0, microsecond=0)
        corrida = corrida.replace(hour=corrida.hour - corrida.hour % 6)
        prefijo = corrida.strftime("DATA/WRF/DET/%Y/%m/%d/%H/")
        horarios = sorted(k for k in listar(prefijo, sesion) if "_01H_" in k)
        plazos = {int(k[-6:-3]) for k in horarios}
        if set(range(1, HORAS + 1)) <= plazos:
            return corrida, {int(k[-6:-3]): k for k in horarios}
    return None, {}


def indice_cercano(lat, lon, punto):
    d = (lat - punto[0]) ** 2 + ((lon - punto[1]) * np.cos(np.radians(punto[0]))) ** 2
    return np.unravel_index(int(np.nanargmin(d)), d.shape)


def resumir(corrida, cajas, ahora, radio):
    """cajas: {plazo: matriz (2r+1)² de lluvia horaria}. Solo horas futuras."""
    centro = radio
    horas, por_dia = [], {}
    for plazo in sorted(cajas):
        fin = corrida + timedelta(hours=plazo)
        if fin <= ahora:
            continue
        caja = cajas[plazo]
        horas.append(
            {
                "time": fin.astimezone(LOCAL).isoformat(),
                "centro": round(float(caja[centro, centro]), 1),
                "max_zona": round(float(np.nanmax(caja)), 1),
            }
        )
        dia = (fin.astimezone(LOCAL) - timedelta(hours=1)).date().isoformat()
        por_dia.setdefault(dia, []).append(caja)
    dias = []
    for dia, lista in sorted(por_dia.items()):
        total = np.nansum(np.stack(lista), axis=0)
        dias.append(
            {
                "fecha": dia,
                "horas": len(lista),
                "centro": round(float(total[centro, centro]), 1),
                "max_zona": round(float(np.nanmax(total)), 1),
            }
        )
    serie = np.array([h["centro"] for h in horas]) if horas else np.array([])
    ventana = min(24, len(serie))
    max_24h = float(np.convolve(serie, np.ones(ventana), "valid").max()) if ventana else None
    return {
        "estado": "disponible" if horas else "no_disponible",
        "corrida": corrida.isoformat(),
        "horas": horas,
        "dias": dias,
        "max_1h_centro": round(float(serie.max()), 1) if horas else None,
        "max_1h_zona": max((h["max_zona"] for h in horas), default=None),
        "max_24h_centro": round(max_24h, 1) if max_24h is not None else None,
    }


def main():
    cfg = yaml.safe_load((ROOT / "config/alertas.yaml").read_text(encoding="utf-8"))
    radio = int(cfg["nino_tiempo_real"]["wrf_radio_celdas"])
    ahora = datetime.now(timezone.utc)
    sesion = requests.Session()
    base = {
        "generated_at": ahora.isoformat(timespec="seconds"),
        "fuente": "SMN, modelo WRF determinístico 4 km (datos abiertos en AWS)",
        "fuente_url": "https://registry.opendata.aws/smn-ar-wrf-dataset/",
        "radio_km": radio * 4,
    }
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    try:
        import h5py

        corrida, claves = ultima_corrida_completa(ahora, sesion)
        if corrida is None:
            raise RuntimeError("No hay una corrida completa en las últimas 48 h")
        with h5py.File(ArchivoRemoto(BUCKET + claves[1], requests.Session()), "r") as f:
            j, i = indice_cercano(f["lat"][:], f["lon"][:], POSADAS)
            punto = (float(f["lat"][j, i]), float(f["lon"][j, i]))

        def leer(plazo):
            with h5py.File(ArchivoRemoto(BUCKET + claves[plazo], requests.Session()), "r") as f:
                caja = f["PP"][0, j - radio : j + radio + 1, i - radio : i + radio + 1]
                return plazo, np.where(caja > 1e19, np.nan, caja)

        with ThreadPoolExecutor(8) as ex:
            cajas = dict(ex.map(leer, range(1, HORAS + 1)))
        payload = {**base, **resumir(corrida, cajas, ahora, radio), "punto": punto}
    except Exception as exc:  # noqa: BLE001 — la página debe saber que falta el dato
        print(f"WRF SMN no disponible: {exc}")
        payload = {**base, "estado": "no_disponible", "motivo": str(exc)[:300]}
    DESTINO.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
    )
    print(
        f"WRF SMN: {payload['estado']}, corrida {payload.get('corrida')}, "
        f"máx 24 h centro {payload.get('max_24h_centro')} mm"
    )


if __name__ == "__main__":
    main()
