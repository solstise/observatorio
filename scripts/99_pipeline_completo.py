"""Orquestador del pipeline completo (Tarea 1.9).

Corre, en orden, las etapas de Fase 1 del Observatorio Urbano Posadas:

1. Validación de configuración (polígonos, .env, autenticación Earth Engine).
2. ``test_ee_auth`` — sanity check de EE.
3. ``01_descarga_sentinel`` — imágenes Sentinel-2 por polígono y fecha.
4. ``03_descarga_buildings`` — Google Open Buildings v3.
5. ``05_descarga_worldpop`` — raster de población.
6. ``10_recortar_por_poligono`` — si aplica, recortes auxiliares.
7. ``20_contar_techos`` — inferencia de fecha de aparición + serie temporal.
8. ``30_estimar_poblacion`` — estimación poblacional Fase 1.
9. ``50_generar_timelapse`` — por polígono, paralelizado I/O-bound.
10. ``60_generar_pdf`` — por polígono, paralelizado I/O-bound.

Reglas:

- Etapas críticas (las de descarga inicial): si fallan completamente, se
  aborta el pipeline con resumen; si fallan parcial, se continúa con lo
  que haya.
- Etapas por-polígono (timelapse, PDF) corren con ``ThreadPoolExecutor``
  (I/O bound) con ``max_workers=3`` por default.
- Resumen final en consola con tabla Markdown polígono × etapa × estado
  × duración. También se loguea a archivo.

CLI::

    python scripts/99_pipeline_completo.py
    python scripts/99_pipeline_completo.py --dry-run
    python scripts/99_pipeline_completo.py --skip-descargas --poligonos itaembe_mini,el_brete
"""

from __future__ import annotations

import datetime as dt
import importlib
import logging
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

import click

try:
    from scripts.utils.logger import get_logger  # type: ignore
except Exception:
    try:
        from scripts.utils.logger import setup_logger as _setup

        def get_logger(name: str) -> logging.Logger:
            return _setup(name) if callable(_setup) else logging.getLogger(name)
    except Exception:
        def get_logger(name: str) -> logging.Logger:
            logging.basicConfig(
                level=logging.INFO,
                format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
            )
            return logging.getLogger(name)


logger = get_logger(__name__)


# --- Estructuras -------------------------------------------------------------


@dataclass
class ResultadoEtapa:
    nombre: str
    poligono: str | None
    ok: bool
    duracion_s: float
    mensaje: str


@dataclass
class ResumenPipeline:
    etapas: list[ResultadoEtapa] = field(default_factory=list)

    def agregar(self, r: ResultadoEtapa) -> None:
        self.etapas.append(r)

    def como_markdown(self) -> str:
        if not self.etapas:
            return "_(sin etapas)_"
        filas = ["| Polígono | Etapa | Estado | Duración | Mensaje |",
                 "|---|---|---|---|---|"]
        for r in self.etapas:
            estado = "OK" if r.ok else ("SKIP" if r.mensaje.startswith("SKIP") else "FALLO")
            filas.append(
                f"| {r.poligono or '-'} | {r.nombre} | {estado} "
                f"| {r.duracion_s:.1f}s | {r.mensaje or '-'} |"
            )
        return "\n".join(filas)


# --- Helpers de ejecución ----------------------------------------------------


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _run_subprocess(
    script_rel: str, args: list[str], etapa: str, poligono: str | None = None
) -> ResultadoEtapa:
    """Ejecuta un script con subprocess y registra tiempo/salida."""
    script = PROJECT_ROOT / script_rel
    t0 = time.time()
    if not script.exists():
        return ResultadoEtapa(etapa, poligono, False, 0.0,
                              f"FALLO: script no encontrado: {script_rel}")
    cmd = [sys.executable, str(script), *args]
    logger.info("▶ %s%s", etapa, f" ({poligono})" if poligono else "")
    logger.info("  cmd: %s", " ".join(cmd))
    try:
        proc = subprocess.run(
            cmd, cwd=str(PROJECT_ROOT), check=False,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
    except Exception as exc:  # noqa: BLE001
        return ResultadoEtapa(etapa, poligono, False, time.time() - t0,
                              f"FALLO: excepción {exc}")
    dur = time.time() - t0
    if proc.returncode == 0:
        return ResultadoEtapa(etapa, poligono, True, dur, "OK")
    tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-3:]
    return ResultadoEtapa(
        etapa, poligono, False, dur,
        f"FALLO rc={proc.returncode}: {' | '.join(tail)}",
    )


def _cargar_poligonos_ids(poligonos_path: Path) -> list[str]:
    import json
    with poligonos_path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    ids = []
    for feat in data.get("features", []):
        props = feat.get("properties", {})
        if "id" in props:
            ids.append(str(props["id"]))
    return ids


def _existe_cualquier(path_dir: Path, glob_pat: str) -> bool:
    if not path_dir.exists():
        return False
    return any(path_dir.glob(glob_pat))


# --- Validación inicial ------------------------------------------------------


def _validar_setup(poligonos_path: Path) -> ResultadoEtapa:
    t0 = time.time()
    mensajes: list[str] = []

    if not poligonos_path.exists():
        return ResultadoEtapa(
            "validar", None, False, time.time() - t0,
            f"FALLO: no existe {poligonos_path}",
        )
    ids = _cargar_poligonos_ids(poligonos_path)
    if not ids:
        return ResultadoEtapa(
            "validar", None, False, time.time() - t0,
            "FALLO: poligonos.geojson sin features válidas",
        )

    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        mensajes.append(".env ausente (no crítico si EE ya está autenticado)")

    # Check autenticación Earth Engine (no crítico, solo warn).
    try:
        ee = importlib.import_module("ee")
        try:
            ee.Initialize()
            mensajes.append("EE ok")
        except Exception as exc:  # noqa: BLE001
            mensajes.append(f"EE no inicializado: {exc}")
    except ImportError:
        mensajes.append("earthengine-api no instalado")

    return ResultadoEtapa(
        "validar", None, True, time.time() - t0,
        f"{len(ids)} polígonos; {'; '.join(mensajes) if mensajes else 'OK'}",
    )


# --- Etapas críticas (globales) ---------------------------------------------


def _etapa_test_ee(dry: bool) -> ResultadoEtapa:
    if dry:
        return ResultadoEtapa("test_ee_auth", None, True, 0.0, "SKIP (dry-run)")
    candidatos = ["scripts/test_ee_auth.py", "scripts/utils/test_ee_auth.py"]
    for rel in candidatos:
        if (PROJECT_ROOT / rel).exists():
            return _run_subprocess(rel, [], "test_ee_auth")
    return ResultadoEtapa("test_ee_auth", None, True, 0.0,
                          "SKIP: script no encontrado")


def _etapa_descarga(
    script_rel: str, etapa: str, poligonos_path: Path, dry: bool,
) -> ResultadoEtapa:
    if dry:
        return ResultadoEtapa(etapa, None, True, 0.0, "SKIP (dry-run)")
    if not (PROJECT_ROOT / script_rel).exists():
        return ResultadoEtapa(etapa, None, True, 0.0,
                              f"SKIP: {script_rel} no existe (lo crea otro agente)")
    args = ["--poligonos", str(poligonos_path)]
    return _run_subprocess(script_rel, args, etapa)


def _etapa_contar(poligonos_path: Path, dry: bool) -> ResultadoEtapa:
    if dry:
        return ResultadoEtapa("contar_techos", None, True, 0.0, "SKIP (dry-run)")
    args = ["--poligonos", str(poligonos_path)]
    return _run_subprocess("scripts/20_contar_techos.py", args, "contar_techos")


def _etapa_poblacion(poligonos_path: Path, dry: bool) -> ResultadoEtapa:
    if dry:
        return ResultadoEtapa("estimar_poblacion", None, True, 0.0, "SKIP (dry-run)")
    args = ["--poligonos", str(poligonos_path)]
    return _run_subprocess("scripts/30_estimar_poblacion.py", args, "estimar_poblacion")


# --- Etapas por polígono ----------------------------------------------------


def _etapa_timelapse(poligono_id: str, dry: bool) -> ResultadoEtapa:
    if dry:
        return ResultadoEtapa("timelapse", poligono_id, True, 0.0, "SKIP (dry-run)")
    return _run_subprocess(
        "scripts/50_generar_timelapse.py",
        ["--poligono", poligono_id, "--formato", "both"],
        "timelapse", poligono_id,
    )


def _etapa_pdf(poligono_id: str, dry: bool) -> ResultadoEtapa:
    if dry:
        return ResultadoEtapa("pdf", poligono_id, True, 0.0, "SKIP (dry-run)")
    return _run_subprocess(
        "scripts/60_generar_pdf.py",
        ["--poligono", poligono_id],
        "pdf", poligono_id,
    )


def _ejecutar_por_poligono(
    fn: Callable[[str, bool], ResultadoEtapa],
    poligonos: Iterable[str],
    max_workers: int,
    dry: bool,
) -> list[ResultadoEtapa]:
    poligonos = list(poligonos)
    resultados: list[ResultadoEtapa] = []
    if not poligonos:
        return resultados
    with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
        futs = {pool.submit(fn, pid, dry): pid for pid in poligonos}
        for fut in as_completed(futs):
            pid = futs[fut]
            try:
                resultados.append(fut.result())
            except Exception as exc:  # noqa: BLE001
                resultados.append(ResultadoEtapa(
                    fn.__name__, pid, False, 0.0, f"FALLO excepción: {exc}",
                ))
    return resultados


# --- CLI ---------------------------------------------------------------------


@click.command(help="Orquesta el pipeline completo Fase 1 (Tarea 1.9).")
@click.option("--fase", type=int, default=1, show_default=True)
@click.option(
    "--poligonos",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=Path("config/poligonos.geojson"),
    show_default=True,
)
@click.option(
    "--poligonos-subset", "--polígonos",
    "poligonos_subset",
    type=str, default=None,
    help="Subset CSV de IDs, ej: 'itaembe_mini,el_brete'",
)
@click.option(
    "--skip-descargas", is_flag=True, default=False,
    help="Saltea etapas 01/03/05/10 y re-procesa a partir del conteo.",
)
@click.option(
    "--dry-run", is_flag=True, default=False,
    help="No ejecuta nada, solo imprime el plan.",
)
@click.option("--workers-poligono", type=int, default=3, show_default=True)
def cli(
    fase: int,
    poligonos: Path,
    poligonos_subset: str | None,
    skip_descargas: bool,
    dry_run: bool,
    workers_poligono: int,
) -> None:
    """Entry point orquestador."""
    if fase != 1:
        raise click.UsageError("Este orquestador cubre Fase 1. Fase 2 está en otro script.")

    t0 = time.time()
    log_dir = PROJECT_ROOT / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = log_dir / f"pipeline_{stamp}.log"
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setFormatter(logging.Formatter(
        "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
    ))
    logging.getLogger().addHandler(fh)

    logger.info("=" * 60)
    logger.info("Observatorio Posadas — Pipeline Fase %d %s",
                fase, "(DRY-RUN)" if dry_run else "")
    logger.info("=" * 60)

    resumen = ResumenPipeline()

    # 1. Validación
    r = _validar_setup(poligonos)
    resumen.agregar(r)
    logger.info("Validación: %s (%s)", "OK" if r.ok else "FALLO", r.mensaje)
    if not r.ok:
        logger.error("Validación falló — aborto.")
        print("\n" + resumen.como_markdown())
        sys.exit(1)

    ids_todos = _cargar_poligonos_ids(poligonos)
    if poligonos_subset:
        seleccion = [p.strip() for p in poligonos_subset.split(",") if p.strip()]
        desconocidos = set(seleccion) - set(ids_todos)
        if desconocidos:
            logger.warning("IDs desconocidos en subset: %s", sorted(desconocidos))
        poligonos_ids = [p for p in seleccion if p in ids_todos]
    else:
        poligonos_ids = ids_todos
    logger.info("Polígonos a procesar: %s", poligonos_ids)

    # 2. Sanity EE
    resumen.agregar(_etapa_test_ee(dry_run))

    # 3-6. Etapas de descarga (críticas)
    etapas_descarga = [
        ("scripts/01_descarga_sentinel.py", "descarga_sentinel"),
        ("scripts/03_descarga_buildings.py", "descarga_buildings"),
        ("scripts/05_descarga_worldpop.py", "descarga_worldpop"),
        ("scripts/10_recortar_por_poligono.py", "recortar_por_poligono"),
    ]
    if skip_descargas:
        logger.info("--skip-descargas activo: se saltean 01/03/05/10.")
        for _, etapa in etapas_descarga:
            resumen.agregar(ResultadoEtapa(etapa, None, True, 0.0, "SKIP (flag)"))
    else:
        for script_rel, etapa in etapas_descarga:
            r = _etapa_descarga(script_rel, etapa, poligonos, dry_run)
            resumen.agregar(r)
            if not r.ok and not r.mensaje.startswith("SKIP"):
                logger.warning("Etapa %s falló: %s (continuamos con lo que haya)",
                               etapa, r.mensaje)

    # 7. Conteo
    r_cont = _etapa_contar(poligonos, dry_run)
    resumen.agregar(r_cont)
    if not r_cont.ok and not r_cont.mensaje.startswith("SKIP"):
        logger.error("Conteo de techos falló críticamente — aborto.")
        print("\n" + resumen.como_markdown())
        sys.exit(2)

    # 8. Población
    r_pob = _etapa_poblacion(poligonos, dry_run)
    resumen.agregar(r_pob)
    if not r_pob.ok and not r_pob.mensaje.startswith("SKIP"):
        logger.warning("Estimación de población falló: %s (continuamos)", r_pob.mensaje)

    # 9. Timelapses (paralelo por polígono, I/O bound)
    logger.info("Generando timelapses en paralelo (workers=%d)...", workers_poligono)
    resumen.etapas.extend(_ejecutar_por_poligono(
        _etapa_timelapse, poligonos_ids, workers_poligono, dry_run,
    ))

    # 10. PDFs
    logger.info("Generando PDFs en paralelo (workers=%d)...", workers_poligono)
    resumen.etapas.extend(_ejecutar_por_poligono(
        _etapa_pdf, poligonos_ids, workers_poligono, dry_run,
    ))

    # Resumen final
    total_s = time.time() - t0
    logger.info("Duración total pipeline: %.1fs", total_s)
    markdown = resumen.como_markdown()
    logger.info("\nResumen final:\n%s", markdown)
    print("\n================ RESUMEN PIPELINE FASE 1 ================\n")
    print(markdown)
    print(f"\nTiempo total: {total_s:.1f}s. Log: {log_file}\n")

    # Exit code != 0 si alguna etapa crítica falló.
    criticos_fallados = [
        r for r in resumen.etapas
        if not r.ok and not r.mensaje.startswith("SKIP")
        and r.nombre in ("contar_techos", "validar")
    ]
    if criticos_fallados:
        sys.exit(3)


if __name__ == "__main__":
    cli()
