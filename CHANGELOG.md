# Changelog

Todos los cambios notables a este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado cumple [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### En desarrollo

- Implementación de scripts Fase 1 (descarga, conteo, timelapse, PDF).

## [0.1.0] - 2026-04-22

### Added

- Scaffold inicial del repositorio Observatorio Urbano Posadas.
- Estructura de carpetas: `config/`, `scripts/`, `data/`, `docs/`,
  `templates/`, `webapp/`, `notebooks/`, `tests/`, `logs/`, `models/`.
- Archivos de proyecto raíz: `README.md`, `METODOLOGIA.md`, `CHANGELOG.md`,
  `LICENSE` (MIT), `CASOS_DE_USO.md`.
- Configuración inicial: `config/poligonos.geojson` con 5 polígonos piloto
  (Itaembé Miní, Itaembé Guazú, Chacra 32, Villa Cabello, El Brete),
  `config/servicios.geojson` con placeholders, `config/settings.yaml` con
  parámetros globales.
- Dependencias declaradas: `requirements.txt` (runtime), `requirements-dev.txt`
  (desarrollo), `pyproject.toml` (black, ruff, mypy, pytest).
- Plantilla PDF: `templates/reporte_poligono.html` con CSS para WeasyPrint
  (A4, paleta corporativa sobria, tipografía Inter).
- Documentación Fase 1:
  - `docs/poligonos_sugeridos.md` — lista ampliada de candidatos Fase 2.
  - `docs/fuentes_datos.md` — tabla de fuentes con licencias y citas APA.
  - `docs/interpretacion_resultados.md` — guía para funcionarios no técnicos.
  - `docs/faq.md` — preguntas frecuentes.
  - `docs/lecturas.md` — referencias académicas.
  - `docs/politica_publicacion.md` — criterios para polígonos sensibles.
- `.env.example` con variables documentadas.
- `.gitignore` adaptado al stack Python + Node + datos pesados.
- Webapp scaffold (estructura vacía en `webapp/frontend/` y `webapp/backend/`).

### Notes

- Los scripts de Fase 1 (`scripts/01_*` a `scripts/99_*`) se implementan en
  la iteración siguiente.
- Licencia: código MIT, datos derivados CC BY 4.0.
