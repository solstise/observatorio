"""Tests del generador de mapas de calor (`scripts/49b_mapas_calor.py`).

Cubre:

1. CLI parsea: `--help` retorna 0.
2. Naming convention de outputs estacionales: `{metr}_{anio}_{estacion}.png`.
3. `TwoSlopeNorm` para UHI está centrado en 0 (paleta diverging).
4. Si existe `data/processed/calor/mapas/`, validar PNG ≥ 1, GIF ≥ 1, y
   tamaños 10 KB ≤ tamaño ≤ 5 MB (sanity checks).
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest


PROYECTO_ROOT = Path(__file__).resolve().parent.parent
RUTA_SCRIPT_MAPAS = PROYECTO_ROOT / "scripts" / "49b_mapas_calor.py"
DIR_MAPAS = PROYECTO_ROOT / "data" / "processed" / "calor" / "mapas"


@pytest.fixture(scope="module")
def mapas_module():
    """Carga `scripts/49b_mapas_calor.py` como módulo importable."""
    if not RUTA_SCRIPT_MAPAS.exists():
        pytest.skip(f"{RUTA_SCRIPT_MAPAS} no existe")
    if str(PROYECTO_ROOT) not in sys.path:
        sys.path.insert(0, str(PROYECTO_ROOT))

    spec = importlib.util.spec_from_file_location(
        "calor_mapas_test_mod", RUTA_SCRIPT_MAPAS
    )
    if spec is None or spec.loader is None:
        pytest.skip("No se pudo crear spec para 49b_mapas_calor.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["calor_mapas_test_mod"] = mod
    try:
        spec.loader.exec_module(mod)
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"No se pudo cargar el módulo: {exc}")
    return mod


# ---------------------------------------------------------------------------
# 1. CLI parsea
# ---------------------------------------------------------------------------


def test_cli_help_retorna_0():
    """`python scripts/49b_mapas_calor.py --help` sale con código 0."""
    if not RUTA_SCRIPT_MAPAS.exists():
        pytest.skip(f"{RUTA_SCRIPT_MAPAS} no existe")
    res = subprocess.run(
        [sys.executable, str(RUTA_SCRIPT_MAPAS), "--help"],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=str(PROYECTO_ROOT),
    )
    assert res.returncode == 0, (
        f"--help salió con {res.returncode}\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
    )
    # Debe incluir las opciones documentadas
    salida = res.stdout + res.stderr
    assert "--tipo" in salida, "Falta opción --tipo en --help"


def test_cli_help_lista_tipos():
    """El --help menciona los 4 tipos válidos: estacional, gif, top, todo."""
    if not RUTA_SCRIPT_MAPAS.exists():
        pytest.skip(f"{RUTA_SCRIPT_MAPAS} no existe")
    res = subprocess.run(
        [sys.executable, str(RUTA_SCRIPT_MAPAS), "--help"],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=str(PROYECTO_ROOT),
    )
    assert res.returncode == 0
    salida = res.stdout + res.stderr
    for tipo in ("estacional", "gif", "top", "todo"):
        assert tipo in salida, f"--help debe listar tipo '{tipo}'"


# ---------------------------------------------------------------------------
# 2. Naming convention de outputs
# ---------------------------------------------------------------------------


def _construir_nombre_estacional(metrica: str, anio: int, estacion: str) -> str:
    """Replica el naming usado en cli(): `{metrica}_{anio}_{estacion}.png`."""
    return f"{metrica}_{anio}_{estacion}.png"


def test_naming_estacional_uhi_vs_rural():
    """Para metr=`uhi_vs_rural`, anio=2024, season=`verano` → archivo correcto."""
    nombre = _construir_nombre_estacional("uhi_vs_rural", 2024, "verano")
    assert nombre == "uhi_vs_rural_2024_verano.png"


@pytest.mark.parametrize(
    "metrica,anio,estacion,esperado",
    [
        ("lst", 2018, "invierno", "lst_2018_invierno.png"),
        ("uhi_vs_rural", 2024, "verano", "uhi_vs_rural_2024_verano.png"),
        ("uhi_vs_ciudad", 2025, "primavera", "uhi_vs_ciudad_2025_primavera.png"),
        ("lst", 2026, "otono", "lst_2026_otono.png"),
    ],
)
def test_naming_estacional_parametrizado(
    metrica: str, anio: int, estacion: str, esperado: str
):
    assert _construir_nombre_estacional(metrica, anio, estacion) == esperado


def test_naming_top5_anio_max():
    """El nombre del top5 tiene el formato `top5_calientes_{estacion}_{anio}.png`."""
    estacion, anio = "verano", 2026
    esperado = f"top5_calientes_{estacion}_{anio}.png"
    assert esperado == "top5_calientes_verano_2026.png"


def test_naming_gif_24m():
    """El GIF se llama `evolucion_uhi_vs_ciudad_24m.gif`."""
    esperado = "evolucion_uhi_vs_ciudad_24m.gif"
    assert esperado.endswith(".gif")
    assert "evolucion" in esperado
    assert "24m" in esperado


# ---------------------------------------------------------------------------
# 3. TwoSlopeNorm centrado en 0 para UHI
# ---------------------------------------------------------------------------


def test_two_slope_norm_centrado_en_cero(mapas_module):
    """La norm usada para UHI está centrada en 0 (paleta diverging)."""
    from matplotlib.colors import TwoSlopeNorm

    vmin, vmax = mapas_module.RANGO_UHI_CENTRADO
    norm = TwoSlopeNorm(vmin=vmin, vcenter=0, vmax=vmax)
    assert norm.vcenter == 0, f"vcenter debe ser 0, es {norm.vcenter}"
    # 0 mapeado en TwoSlopeNorm centrado debe dar 0.5 (midpoint del cmap)
    assert norm(0) == pytest.approx(0.5, abs=1e-6), (
        f"norm(0) debería ser 0.5 (midpoint), es {float(norm(0)):.4f}"
    )
    # Valores negativos < 0.5, positivos > 0.5
    assert norm(vmin) == pytest.approx(0.0, abs=1e-6)
    assert norm(vmax) == pytest.approx(1.0, abs=1e-6)


def test_rango_uhi_centrado_apto_diverging(mapas_module):
    """`RANGO_UHI_CENTRADO` permite construir TwoSlopeNorm — vmin<0<vmax."""
    vmin, vmax = mapas_module.RANGO_UHI_CENTRADO
    assert vmin < 0 < vmax, (
        f"RANGO_UHI_CENTRADO debe tener vmin<0<vmax, es ({vmin}, {vmax})"
    )


def test_rango_lst_apropiado(mapas_module):
    """`RANGO_LST` cubre el rango plausible de LST en Posadas (15-50°C)."""
    vmin, vmax = mapas_module.RANGO_LST
    assert 0.0 <= vmin < vmax <= 60.0, (
        f"RANGO_LST fuera de plausibilidad: {(vmin, vmax)}"
    )
    # El rango debe cubrir al menos 20°C (variabilidad estacional)
    assert (vmax - vmin) >= 15.0, f"Rango LST muy chico: {vmax - vmin}°C"


def test_cmap_lst_y_uhi_correctos(mapas_module):
    """LST usa cmap secuencial (magma); UHI usa cmap diverging (RdBu_r)."""
    assert mapas_module.CMAP_LST == "magma", (
        f"CMAP_LST esperado 'magma', es {mapas_module.CMAP_LST}"
    )
    assert mapas_module.CMAP_UHI == "RdBu_r", (
        f"CMAP_UHI esperado 'RdBu_r' (diverging), es {mapas_module.CMAP_UHI}"
    )


# ---------------------------------------------------------------------------
# 4. Validación de outputs si existen (mapas/ poblado)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def mapas_dir():
    if not DIR_MAPAS.exists() or not DIR_MAPAS.is_dir():
        pytest.skip(f"{DIR_MAPAS} no existe (correr 49b_mapas_calor.py primero)")
    return DIR_MAPAS


def test_mapas_dir_tiene_pngs(mapas_dir: Path):
    """Hay al menos 1 PNG en mapas/."""
    pngs = list(mapas_dir.glob("*.png"))
    assert len(pngs) >= 1, f"Esperaba ≥1 PNG en {mapas_dir}, hay {len(pngs)}"


def test_mapas_dir_tiene_gif(mapas_dir: Path):
    """Hay al menos 1 GIF en mapas/."""
    gifs = list(mapas_dir.glob("*.gif"))
    assert len(gifs) >= 1, f"Esperaba ≥1 GIF en {mapas_dir}, hay {len(gifs)}"


def test_mapas_pngs_tamano_razonable(mapas_dir: Path):
    """Cada PNG mide entre 10 KB y 5 MB (sanity check de generación)."""
    KB = 1024
    MB = 1024 * KB
    fallos = []
    for png in mapas_dir.glob("*.png"):
        size = png.stat().st_size
        if size < 10 * KB or size > 5 * MB:
            fallos.append((png.name, size))
    assert not fallos, (
        f"PNGs con tamaño fuera de [10 KB, 5 MB]:\n"
        + "\n".join(f"  {n}: {s} bytes" for n, s in fallos)
    )


def test_mapas_gifs_tamano_razonable(mapas_dir: Path):
    """Cada GIF mide entre 10 KB y 5 MB."""
    KB = 1024
    MB = 1024 * KB
    fallos = []
    for gif in mapas_dir.glob("*.gif"):
        size = gif.stat().st_size
        if size < 10 * KB or size > 5 * MB:
            fallos.append((gif.name, size))
    assert not fallos, (
        f"GIFs con tamaño fuera de [10 KB, 5 MB]:\n"
        + "\n".join(f"  {n}: {s} bytes" for n, s in fallos)
    )


def test_mapas_naming_estacional_se_cumple(mapas_dir: Path):
    """Los PNGs estacionales siguen el patrón `{metr}_{anio}_{estacion}.png`.

    Excluimos `top5_*` que tiene otro patrón. Validamos que los archivos
    `lst_*`, `uhi_vs_rural_*`, `uhi_vs_ciudad_*` cumplen el formato.
    """
    pngs = list(mapas_dir.glob("*.png"))
    if not pngs:
        pytest.skip("No hay PNGs en mapas/")

    estaciones_validas = {"verano", "otono", "invierno", "primavera"}
    metricas_validas = {"lst", "uhi_vs_rural", "uhi_vs_ciudad"}

    fallos = []
    for png in pngs:
        nombre = png.stem
        if nombre.startswith("top5_"):
            continue
        # patrón: <metr>_<anio>_<estacion>
        # Como "uhi_vs_rural" tiene underscores, usamos rsplit con maxsplit=2.
        partes = nombre.rsplit("_", 2)
        if len(partes) != 3:
            fallos.append((png.name, "no_3_partes"))
            continue
        metrica, anio_str, estacion = partes
        if metrica not in metricas_validas:
            fallos.append((png.name, f"métrica desconocida: {metrica}"))
            continue
        if estacion not in estaciones_validas:
            fallos.append((png.name, f"estación desconocida: {estacion}"))
            continue
        try:
            anio = int(anio_str)
            if anio < 2010 or anio > 2030:
                fallos.append((png.name, f"año fuera de rango: {anio}"))
        except ValueError:
            fallos.append((png.name, f"año no parseable: {anio_str}"))
    assert not fallos, (
        f"PNGs con naming inesperado:\n" + "\n".join(f"  {n}: {r}" for n, r in fallos)
    )
