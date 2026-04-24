"""Sincroniza los datos reales del pipeline con el frontend (webapp/frontend/public/data/).

Problema: el frontend fue scaffoldeado antes de definir el schema final de los
CSVs que produce el pipeline. Hay mismatch:

- Frontend espera `anio` como entero; pipeline emite `fecha` (YYYY-MM).
- Frontend espera `edificios_total`; pipeline emite `n_edificios_estimado`.
- Frontend espera `cobertura_pct` por servicio; pipeline emite distancias y conteos.
- Frontend espera desglose explícito de vulnerabilidad; pipeline emite JSON.

En lugar de refactorizar el frontend (lo hacemos en Fase 2 cuando tengamos más
datos), este script traduce los CSVs reales al schema que el frontend espera,
y copia los recursos multimedia (PDFs, timelapses, comparaciones HD) a
`webapp/frontend/public/data/media/` para servirse como archivos estáticos.

Uso:
    python scripts/80_sync_webapp.py
"""
from __future__ import annotations

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------
import sys as _sys
from pathlib import Path as _Path
_p = _Path(__file__).resolve().parent
while _p != _p.parent:
    if (_p / "pyproject.toml").exists():
        if str(_p) not in _sys.path:
            _sys.path.insert(0, str(_p))
        break
    _p = _p.parent
# --- fin del parche ---------------------------------------------------------

import json
import shutil
from datetime import datetime

import click
import geopandas as gpd
import pandas as pd
from loguru import logger

from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path


# --- Mappings -----------------------------------------------------------------

CATEGORIAS_A_FRONTEND = {
    # slugs del GeoJSON → valores que acepta types.ts:CategoriaPoligono
    "asentamiento_crecimiento_rapido": "expansion_activa",
    "consolidado_crecimiento": "emergente",
    "control_consolidado": "consolidado",
    "zona_sensible": "expansion_activa",
}

SERVICIOS_A_FRONTEND = {
    # familia nuestra → nombre legible para el frontend
    "caps_clinic": "Salud primaria (CAPS)",
    "hospital": "Hospitales",
    "escuela": "Escuelas",
    "jardin": "Jardines",
    "universidad": "Universidades",
    "farmacia": "Farmacias",
    "parada_colectivo": "Transporte público",
    "policia": "Policía",
    "bomberos": "Bomberos",
    "supermercado": "Supermercados",
    "mercado": "Mercados",
    "banco_atm": "Bancos / cajeros",
    "plaza_parque": "Espacios verdes",
}


# --- Transformaciones ---------------------------------------------------------


def transformar_poligonos(
    geojson_in: Path, serie_df: pd.DataFrame, pob_df: pd.DataFrame, vuln_df: pd.DataFrame
) -> dict:
    """Convierte el GeoJSON del pipeline al schema PoligonosCollection del frontend.

    Agrega a cada feature las properties derivadas (poblacion_estimada,
    edificios_2018, edificios_2026, score_expansion, superficie_km2).
    """
    gdf = gpd.read_file(geojson_in)
    # Área en km² vía UTM 21S.
    gdf_m = gdf.to_crs("EPSG:32721")
    areas = (gdf_m.geometry.area / 1e6).tolist()

    # Mapeo de scores de vulnerabilidad por polígono para usarlo como score_expansion.
    # (El frontend llama "score_expansion" pero semánticamente es un ranking 0-100.)
    vuln_por_id = {}
    for _, r in vuln_df.iterrows():
        vuln_por_id[str(r["poligono_id"])] = float(r.get("score") or 0.0)

    features_out = []
    for (_, row), area_km2 in zip(gdf.iterrows(), areas):
        pid = str(row.get("id") or row.get("poligono_id"))

        # Serie de conteo de ese polígono, para sacar edificios inicial y final.
        serie_pol = serie_df[serie_df["poligono_id"] == pid].sort_values("fecha")
        edif_ini = int(serie_pol.iloc[0]["n_edificios_estimado"]) if not serie_pol.empty else 0
        edif_fin = int(serie_pol.iloc[-1]["n_edificios_estimado"]) if not serie_pol.empty else 0

        # Población más reciente.
        pob_pol = pob_df[pob_df["poligono_id"] == pid].sort_values("fecha")
        pob_act = int(pob_pol.iloc[-1]["poblacion_estimada"]) if not pob_pol.empty else 0

        cat_slug = str(row.get("categoria") or "")
        categoria_frontend = CATEGORIAS_A_FRONTEND.get(cat_slug, "desconocido")

        props_out = {
            "id": pid,
            "nombre": str(row.get("nombre") or pid),
            "categoria": categoria_frontend,
            "categoria_original": cat_slug,  # por trazabilidad
            "score_expansion": vuln_por_id.get(pid, 0.0),
            "superficie_km2": round(float(area_km2), 3),
            "poblacion_estimada": pob_act,
            "edificios_2018": edif_ini,
            "edificios_2026": edif_fin,  # realmente es última fecha, no 2026
            "_synthetic": False,
            "descripcion": str(row.get("descripcion") or ""),
            "prioridad": int(row.get("prioridad") or 0),
            "publicar_en_sitio": bool(row.get("publicar_en_sitio", True)),
        }
        # Respetar sensible: no publicar detalle de polígonos marcados sensibles.
        if row.get("sensible"):
            props_out["_sensible"] = True

        features_out.append({
            "type": "Feature",
            "properties": props_out,
            "geometry": json.loads(gpd.GeoSeries([row.geometry]).to_json())["features"][0]["geometry"],
        })

    return {
        "type": "FeatureCollection",
        "features": features_out,
        "_synthetic": False,
        "_generated_at": datetime.now().isoformat(timespec="seconds"),
        "_note": (
            "Datos reales del Observatorio Urbano Posadas. "
            "Los polígonos de 'control_consolidado' y 'consolidado_crecimiento' se "
            "proyectan a la categoría genérica del frontend por compatibilidad."
        ),
    }


def transformar_serie(serie_df: pd.DataFrame, poligonos_gdf: gpd.GeoDataFrame) -> pd.DataFrame:
    """Transforma la serie temporal: fecha YYYY-MM → anio (int), agrega campos.

    El frontend espera `superficie_construida_km2` y `superficie_vegetacion_km2`
    que nosotros no calculamos directamente. Los derivamos a partir de:
      superficie_construida ≈ n_edificios * 0.0001 km²  (100 m² promedio por edificio)
      superficie_vegetacion ≈ área_total - superficie_construida (aprox bruta)
    """
    gdf_m = poligonos_gdf.to_crs("EPSG:32721")
    areas_km2 = dict(
        zip(
            poligonos_gdf["id"].astype(str).tolist(),
            (gdf_m.geometry.area / 1e6).tolist(),
        )
    )

    rows = []
    for _, r in serie_df.iterrows():
        pid = str(r["poligono_id"])
        fecha = str(r["fecha"])  # "YYYY-MM"
        try:
            anio = int(fecha[:4])
        except ValueError:
            continue
        n_edif = float(r.get("n_edificios_estimado") or 0)
        n_min = float(r.get("n_edificios_min") or 0)
        n_max = float(r.get("n_edificios_max") or 0)
        area_total = areas_km2.get(pid, 0.0)
        sup_construida = round(n_edif * 0.0001, 4)
        sup_vegetacion = round(max(area_total - sup_construida, 0.0), 4)
        rows.append({
            "poligono_id": pid,
            "anio": anio,
            "superficie_construida_km2": sup_construida,
            "superficie_vegetacion_km2": sup_vegetacion,
            "edificios_total": int(n_edif),
            "confianza_inferior": int(n_min),
            "confianza_superior": int(n_max),
        })
    return pd.DataFrame(rows)


def transformar_poblacion(pob_df: pd.DataFrame, poligonos_gdf: gpd.GeoDataFrame) -> pd.DataFrame:
    gdf_m = poligonos_gdf.to_crs("EPSG:32721")
    areas_km2 = dict(
        zip(
            poligonos_gdf["id"].astype(str).tolist(),
            (gdf_m.geometry.area / 1e6).tolist(),
        )
    )
    rows = []
    for _, r in pob_df.iterrows():
        pid = str(r["poligono_id"])
        fecha = str(r["fecha"])
        try:
            anio = int(fecha[:4])
        except ValueError:
            continue
        pob = int(float(r.get("poblacion_estimada") or 0))
        pob_min = int(float(r.get("poblacion_min") or 0))
        pob_max = int(float(r.get("poblacion_max") or 0))
        area = areas_km2.get(pid, 1.0) or 1.0
        rows.append({
            "poligono_id": pid,
            "anio": anio,
            "poblacion_estimada": pob,
            "densidad_hab_km2": round(pob / area, 1),
            "confianza_inferior": pob_min,
            "confianza_superior": pob_max,
        })
    return pd.DataFrame(rows)


def transformar_servicios(svc_df: pd.DataFrame) -> pd.DataFrame:
    """Mapea distancias a cobertura_pct 0-100 con heurística simple.

    - Si cobertura_adecuada=True → 100%
    - Si distancia_minima existe pero fuera del umbral → 50%
    - Si no hay servicio del tipo → 0%
    """
    rows = []
    for _, r in svc_df.iterrows():
        pid = str(r["poligono_id"])
        tipo_slug = str(r["tipo_servicio"])
        nombre = SERVICIOS_A_FRONTEND.get(tipo_slug, tipo_slug.replace("_", " ").capitalize())
        dist = r.get("distancia_minima_m")
        cob_ok = r.get("cobertura_adecuada")
        if pd.isna(dist) or dist is None or dist == "":
            cobertura_pct = 0.0
        elif str(cob_ok).lower() == "true" or cob_ok is True:
            cobertura_pct = 100.0
        else:
            cobertura_pct = 50.0
        rows.append({
            "poligono_id": pid,
            "servicio": nombre,
            "cobertura_pct": round(cobertura_pct, 1),
            "fuente": "OpenStreetMap",
            "anio_referencia": datetime.now().year,
        })
    return pd.DataFrame(rows)


def transformar_vulnerabilidad(vuln_df: pd.DataFrame) -> pd.DataFrame:
    """Expande el JSON de componentes al schema plano del frontend."""
    rows = []
    for _, r in vuln_df.iterrows():
        pid = str(r["poligono_id"])
        score_0_100 = float(r.get("score") or 0.0)
        comp = {}
        try:
            comp = json.loads(r.get("componentes_json") or "{}")
        except (TypeError, json.JSONDecodeError):
            pass

        def _norm(clave: str) -> float:
            c = comp.get(clave, {})
            return float(c.get("norm") or 0.0)

        rows.append({
            "poligono_id": pid,
            "indice_vulnerabilidad": round(score_0_100 / 100.0, 3),  # 0-1 como espera frontend
            "carencia_servicios": round((_norm("distancia_caps") + _norm("distancia_escuela")) / 2, 3),
            "riesgo_inundacion": round(_norm("inundacion"), 3),
            "accesibilidad_salud": round(1.0 - _norm("distancia_caps"), 3),
            "accesibilidad_educacion": round(1.0 - _norm("distancia_escuela"), 3),
            "confianza_inferior": round(max(score_0_100 - 15, 0) / 100.0, 3),
            "confianza_superior": round(min(score_0_100 + 15, 100) / 100.0, 3),
        })
    return pd.DataFrame(rows)


# --- Copia de media ----------------------------------------------------------


def copiar_media(src_outputs: Path, src_processed: Path, dest_media: Path) -> dict:
    """Copia PDFs, MP4s, GIFs y comparaciones HD al directorio servido por Next.

    Returns:
        Dict con contadores por tipo copiado.
    """
    ensure_dir(dest_media)
    contadores: dict[str, int] = {"pdfs": 0, "mp4": 0, "gif": 0, "comparacion_hd": 0, "comparacion_2x2": 0}

    # PDFs: copiamos con nombre original (para archivar historial) Y con alias
    # canónico `{poligono_id}.pdf` (para que el frontend los referencie estable).
    for pdf in (src_outputs / "pdfs").glob("*.pdf"):
        shutil.copy2(pdf, dest_media / pdf.name)
        contadores["pdfs"] += 1
        # Extraer poligono_id del nombre (antes del primer "_v").
        stem = pdf.stem
        if "_v" in stem:
            pid = stem.split("_v")[0]
            alias = dest_media / f"{pid}.pdf"
            shutil.copy2(pdf, alias)

    for hd in (src_outputs / "comparaciones_hd").glob("*.png"):
        shutil.copy2(hd, dest_media / hd.name)
        contadores["comparacion_hd"] += 1

    for archivo in (src_processed / "timelapses").glob("*.mp4"):
        shutil.copy2(archivo, dest_media / archivo.name)
        contadores["mp4"] += 1
    for archivo in (src_processed / "timelapses").glob("*.gif"):
        shutil.copy2(archivo, dest_media / archivo.name)
        contadores["gif"] += 1
    for archivo in (src_processed / "timelapses").glob("*_comparacion.png"):
        shutil.copy2(archivo, dest_media / archivo.name)
        contadores["comparacion_2x2"] += 1

    return contadores


# --- CLI ---------------------------------------------------------------------


@click.command(help="Sincroniza datos reales a webapp/frontend/public/data/.")
@click.option("--poligonos", type=click.Path(exists=True), default="config/poligonos.geojson")
@click.option("--serie", type=click.Path(exists=True), default="data/processed/conteos/serie_temporal.csv")
@click.option("--poblacion", type=click.Path(exists=True), default="data/processed/poblacion_estimada.csv")
@click.option("--servicios", type=click.Path(exists=True), default="data/processed/servicios_por_poligono.csv")
@click.option("--vulnerabilidad", type=click.Path(exists=True), default="data/processed/vulnerabilidad_v0.csv")
@click.option("--webapp-data", type=click.Path(), default="webapp/frontend/public/data")
@click.option("--webapp-media", type=click.Path(), default="webapp/frontend/public/data/media")
@click.option("--nivel-log", type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"]), default="INFO")
def cli(
    poligonos: str, serie: str, poblacion: str, servicios: str,
    vulnerabilidad: str, webapp_data: str, webapp_media: str, nivel_log: str,
) -> None:
    setup_logger(nivel=nivel_log.upper())
    dest_data = ensure_dir(resolve_path(webapp_data))
    dest_media = ensure_dir(resolve_path(webapp_media))

    logger.info("=" * 60)
    logger.info("Sync webapp — Observatorio Urbano Posadas")
    logger.info("=" * 60)

    # Cargar fuentes.
    poligonos_gdf = gpd.read_file(poligonos)
    serie_df = pd.read_csv(serie, comment="#")
    pob_df = pd.read_csv(poblacion, comment="#")
    # Los CSVs generados por nuestros scripts no tienen comentarios pero toleramos.
    svc_df = pd.read_csv(servicios, comment="#") if _Path(servicios).exists() else pd.DataFrame()
    vuln_df = pd.read_csv(vulnerabilidad, comment="#") if _Path(vulnerabilidad).exists() else pd.DataFrame()

    # Transformar y guardar.
    fc = transformar_poligonos(_Path(poligonos), serie_df, pob_df, vuln_df)
    (dest_data / "poligonos.geojson").write_text(
        json.dumps(fc, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info(f"poligonos.geojson -> {dest_data / 'poligonos.geojson'}")

    serie_out = transformar_serie(serie_df, poligonos_gdf)
    serie_out.to_csv(dest_data / "serie_temporal.csv", index=False, encoding="utf-8")
    logger.info(f"serie_temporal.csv -> {len(serie_out)} filas")

    pob_out = transformar_poblacion(pob_df, poligonos_gdf)
    pob_out.to_csv(dest_data / "poblacion.csv", index=False, encoding="utf-8")
    logger.info(f"poblacion.csv -> {len(pob_out)} filas")

    svc_out = transformar_servicios(svc_df) if not svc_df.empty else pd.DataFrame(
        columns=["poligono_id", "servicio", "cobertura_pct", "fuente", "anio_referencia"]
    )
    svc_out.to_csv(dest_data / "servicios.csv", index=False, encoding="utf-8")
    logger.info(f"servicios.csv -> {len(svc_out)} filas")

    vuln_out = transformar_vulnerabilidad(vuln_df) if not vuln_df.empty else pd.DataFrame()
    vuln_out.to_csv(dest_data / "vulnerabilidad.csv", index=False, encoding="utf-8")
    logger.info(f"vulnerabilidad.csv -> {len(vuln_out)} filas")

    # ----- Copia pass-through de métricas complementarias (S2a/S3) -------
    # Estos CSVs salen de scripts nuevos (41, 43, 44) y se exponen al
    # frontend con nombres canónicos simples. El schema del CSV lo define
    # cada script; el frontend puede consumirlos con papaparse tal cual.
    extras: list[tuple[str, str]] = [
        ("data/processed/dynamic_world/dynamic_world_built.csv", "dynamic_world.csv"),
        ("data/processed/sentinel1/sentinel1_backscatter.csv", "sentinel1.csv"),
        ("data/processed/historia_larga/mapbiomas_por_poligono.csv", "mapbiomas.csv"),
        ("data/processed/historia_larga/ghsl_por_poligono.csv", "ghsl.csv"),
        ("data/processed/historia_larga/viirs_por_poligono.csv", "viirs.csv"),
    ]
    for src_rel, dest_name in extras:
        src = resolve_path(src_rel)
        if not src.exists():
            logger.warning(f"  - saltado {dest_name}: no existe {src_rel}")
            continue
        dest_path = dest_data / dest_name
        shutil.copy2(src, dest_path)
        try:
            import pandas as _pd
            n = len(_pd.read_csv(src))
            logger.info(f"{dest_name} -> {n} filas (pass-through)")
        except Exception:
            logger.info(f"{dest_name} -> copiado")

    # Timestamp de actualización.
    (dest_data / "updated_at.txt").write_text(
        datetime.now().isoformat(timespec="seconds"), encoding="utf-8"
    )

    # Media (PDFs, timelapses, comparaciones).
    src_outputs = resolve_path("data/outputs")
    src_processed = resolve_path("data/processed")
    cont = copiar_media(src_outputs, src_processed, dest_media)
    logger.info(f"Media copiada: {cont}")

    logger.info("=" * 60)
    logger.info("Sync completo.")
    logger.info("Para verificar el frontend:")
    logger.info("  cd webapp/frontend && npm install && npm run dev")
    logger.info("=" * 60)


if __name__ == "__main__":
    cli()
