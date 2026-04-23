# Observatorio Urbano Posadas - Frontend

Dashboard publico construido con **Next.js 14 (App Router)**, **TypeScript**, **Tailwind CSS**, **react-leaflet** y **Recharts**.

## Requisitos

- Node.js 18.17 o superior
- npm 9 o superior (tambien funciona con pnpm y yarn)

## Instalacion

```bash
cd webapp/frontend
npm install
```

## Desarrollo

```bash
npm run dev
# http://localhost:3000
```

## Build de produccion

```bash
npm run build
npm start
```

## Estructura

```
src/
  app/                 # App Router (Next.js 14)
    layout.tsx         # Layout global con header/footer
    page.tsx           # Home con mapa interactivo
    poligono/[id]/     # Pagina de detalle
    comparar/          # Comparador 2-4 poligonos
    metodologia/       # Metodologia (placeholder MDX)
    descargas/         # Lista PDFs y CSVs
  components/          # Componentes React (Map, Sidebar, Charts, etc.)
  lib/
    data.ts            # Fetch y parseo de CSV/GeoJSON
    colors.ts          # Paleta institucional
    types.ts           # Tipos TypeScript
  styles/
    leaflet.css        # Overrides de Leaflet

public/
  data/                # Datos estaticos (GeoJSON + CSVs de prueba)
```

## Datos

El frontend puede consumir datos de dos formas:

1. **Estaticos** (default): lee archivos de `public/data/*.geojson` y `public/data/*.csv`.
   Estos archivos se sincronizan desde `data/outputs/` del repo raiz. Ver `public/data/README.md`.

2. **API**: si la variable `NEXT_PUBLIC_API_BASE` esta definida, el frontend consulta el
   backend FastAPI (`webapp/backend/`). Para Fase 3 publica.

Los CSVs y GeoJSONs incluidos aca son **sinteticos de prueba** y vienen marcados con
`_synthetic: true` en el GeoJSON y un header `# SYNTHETIC` en los CSVs.

## Paleta

- Primario: `#1a3a5c`
- Secundario: `#5a7a9c`
- Acento: `#c97d3c`
- Fondo: `#ffffff`
- Texto: `#222222`

No se usan rojos para evitar connotaciones negativas. Diseno sobrio tipo ONU/BID/Banco Mundial.

## Accesibilidad

Cumple WCAG AA: contraste alto, aria-labels en interactivos, foco visible, alt text en
imagenes, navegacion por teclado.

## Proteccion Fase 2

Para uso interno durante Fase 2, se recomienda proteger el sitio con **Basic Auth a
nivel Nginx** o la funcion **password** de Vercel. No se implementa login propio dentro
del webapp: manteniendo el sitio estatico se aumenta la seguridad y se reduce superficie.

Ejemplo Nginx:

```
location / {
  auth_basic "Observatorio - acceso restringido";
  auth_basic_user_file /etc/nginx/.htpasswd;
  proxy_pass http://localhost:3000;
}
```

## Licencias

- Codigo: MIT
- Datos mostrados: CC BY 4.0 (referidos a las fuentes originales)

## Variables de entorno

Ver `.env.example`.

## Scripts

- `npm run dev` - servidor desarrollo con hot reload
- `npm run build` - build produccion
- `npm start` - servidor produccion
- `npm run lint` - ESLint
- `npm run typecheck` - chequeo TypeScript sin emitir
