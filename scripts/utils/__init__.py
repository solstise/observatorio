"""Paquete de utilidades compartidas del Observatorio Urbano Posadas.

Reúne configuración, logging, manejo de paths, I/O geoespacial y
captura de interrupciones. Cada submódulo se importa explícitamente
para no cargar dependencias pesadas (yaml, geopandas, rasterio) cuando
solo se necesita uno de los helpers.

Ejemplo:
    from scripts.utils.config import load_settings
    from scripts.utils.logger import setup_logger
    from scripts.utils.paths import ensure_dir, project_root
"""

__all__: list[str] = []
