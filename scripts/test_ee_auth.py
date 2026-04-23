"""Verificación de autenticación con Google Earth Engine.

Corresponde a la Tarea 1.2 del PROMPT_OBSERVATORIO_POSADAS.md. Sirve para
validar, antes de cualquier descarga real, que:

1. La credencial de Earth Engine está disponible (archivo token o service account).
2. El project ID está correctamente configurado (vía `--project` o `EE_PROJECT_ID`).
3. La API responde a una query trivial (el área de Misiones en FAO/GAUL).

Ejemplo de uso:
    # Usando EE_PROJECT_ID del .env
    python scripts/test_ee_auth.py

    # Forzando un project ID
    python scripts/test_ee_auth.py --project mi-proyecto-gee

Si falla, imprime un mensaje claro con links a la documentación oficial:
- https://code.earthengine.google.com/  — para aceptar términos.
- https://developers.google.com/earth-engine/guides/python_install
- https://console.cloud.google.com/apis/library/earthengine.googleapis.com
"""

from __future__ import annotations

import sys
import traceback
from typing import Optional

import click
from loguru import logger

from scripts.utils.config import load_settings
from scripts.utils.logger import setup_logger


# Links que repetimos en varios mensajes de error.
LINK_EE_CODE = "https://code.earthengine.google.com/"
LINK_EE_INSTALL = "https://developers.google.com/earth-engine/guides/python_install"
LINK_EE_API_CONSOLE = (
    "https://console.cloud.google.com/apis/library/earthengine.googleapis.com"
)


def inicializar_ee(project_id: Optional[str]) -> None:
    """Inicializa Earth Engine con el project ID dado.

    Intenta primero `ee.Initialize(project=...)` con el project ID. Si falla
    por credencial ausente, sugiere correr `earthengine authenticate`.

    Args:
        project_id: Project ID de Google Cloud. Si es None, EE puede intentar
            usar el project por default del ADC, pero en la práctica para usos
            no-default conviene siempre pasar uno explícito.

    Raises:
        SystemExit: con mensaje humano si falla la inicialización.
    """
    try:
        import ee  # import diferido para que --help no requiera earthengine-api
    except ImportError as exc:
        logger.error(
            "No se pudo importar earthengine-api. "
            "Instalalo con: pip install earthengine-api"
        )
        logger.error(f"Detalle: {exc}")
        logger.info(f"Docs: {LINK_EE_INSTALL}")
        raise SystemExit(1) from exc

    logger.info(
        f"Inicializando Earth Engine "
        f"{'con proyecto ' + project_id if project_id else '(sin proyecto explícito)'}..."
    )

    try:
        if project_id:
            ee.Initialize(project=project_id)
        else:
            ee.Initialize()
    except Exception as exc:  # noqa: BLE001 — EE levanta varias clases distintas
        mensaje = str(exc).lower()
        logger.error(f"Falló ee.Initialize(): {exc}")
        logger.error("Pistas para resolverlo:")

        if "credential" in mensaje or "authentic" in mensaje or "refresh" in mensaje:
            logger.error(
                "  > Parece faltar credencial. Corré en una terminal: "
                "`earthengine authenticate` y seguí las instrucciones del navegador."
            )
        if "not signed up" in mensaje or "registration" in mensaje:
            logger.error(
                f"  > Tu cuenta de Google aún no está dada de alta en Earth Engine. "
                f"Ingresá a {LINK_EE_CODE} y aceptá los términos."
            )
        if "api" in mensaje and "not enabled" in mensaje:
            logger.error(
                f"  > La API de Earth Engine no está habilitada en tu proyecto. "
                f"Habilitala en: {LINK_EE_API_CONSOLE}"
            )
        if "project" in mensaje:
            logger.error(
                "  > Revisá que el project ID sea válido y que tu cuenta tenga "
                "permisos sobre él. Podés pasarlo con --project PROYECTO."
            )

        logger.info(f"Docs oficiales: {LINK_EE_INSTALL}")
        logger.debug(traceback.format_exc())
        raise SystemExit(1) from exc

    logger.success("Earth Engine inicializado correctamente.")


def query_trivial_misiones() -> None:
    """Ejecuta una query trivial para verificar que EE responde.

    Pide a FAO/GAUL/2015/level1 la feature 'Misiones' y cuenta cuántas
    features tiene (esperado: 1). Si la respuesta tarda o falla, el
    problema es de red, cuota o permisos del proyecto.

    Raises:
        SystemExit: si la query falla o devuelve algo inesperado.
    """
    import ee  # import diferido

    logger.info(
        "Consultando FAO/GAUL/2015/level1 filtrado por ADM1_NAME='Misiones'..."
    )
    try:
        misiones = ee.FeatureCollection("FAO/GAUL/2015/level1").filter(
            ee.Filter.eq("ADM1_NAME", "Misiones")
        )
        size = misiones.size().getInfo()
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Falló la query trivial: {exc}")
        logger.info(f"Si el problema persiste, revisá {LINK_EE_INSTALL}")
        logger.debug(traceback.format_exc())
        raise SystemExit(1) from exc

    logger.info(f"Cantidad de features 'Misiones' en FAO/GAUL: {size}")
    if size < 1:
        logger.warning(
            "La query no devolvió resultados. Puede ser un problema de filtros, "
            "o que el dataset esté caído en EE. Revisá en el editor: "
            f"{LINK_EE_CODE}"
        )
        raise SystemExit(1)

    # Segunda verificación liviana: obtener el área total.
    try:
        first = ee.Feature(misiones.first())
        area_km2 = first.geometry().area(maxError=1).divide(1e6).getInfo()
        logger.info(f"Área estimada de Misiones según FAO/GAUL: {area_km2:,.0f} km²")
    except Exception as exc:  # noqa: BLE001
        # No es crítico, solo informativo.
        logger.warning(f"No se pudo calcular área de Misiones: {exc}")


@click.command()
@click.option(
    "--project",
    "project_id",
    default=None,
    help=(
        "Project ID de Google Cloud con Earth Engine habilitado. "
        "Si se omite, se usa EE_PROJECT_ID del .env."
    ),
)
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    help="Nivel de logging (default INFO).",
)
def main(project_id: Optional[str], nivel_log: str) -> None:
    """Verifica autenticación y conectividad con Google Earth Engine (Tarea 1.2)."""
    setup_logger(nivel=nivel_log.upper())
    settings = load_settings()

    # Resolver project: CLI > env (vía settings.env).
    resolved = project_id or settings.env.ee_project_id
    if resolved is None:
        logger.warning(
            "No se recibió --project ni EE_PROJECT_ID en .env. "
            "Earth Engine puede requerir un proyecto explícito para descargas."
        )

    inicializar_ee(resolved)
    query_trivial_misiones()

    logger.success("Test de autenticación EE OK. Listo para usar los scripts de descarga.")
    sys.exit(0)


if __name__ == "__main__":
    main()
