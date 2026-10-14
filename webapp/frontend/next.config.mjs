// Configuración Next.js del Observatorio Urbano Posadas.

import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  // Generamos HTML en .next/analyze. El script de auditoría copia los
  // outputs a docs/bundle_analysis_<timestamp>.html cuando se invoca con
  // `ANALYZE=true npm run build`.
  openAnalyzer: false,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output: genera .next/standalone/ con todo lo necesario para
  // correr el server en producción con `node server.js`. Imprescindible para
  // el Dockerfile multi-stage (ver webapp/frontend/Dockerfile).
  output: "standalone",
  // ESLint corre como check separado (`npm run lint`) y como pre-commit hook;
  // durante `next build` lo desactivamos para que un warning estilístico en
  // una página no bloquee el deploy. La calidad de código sigue garantizada
  // por `npm run lint` ejecutado explícitamente en CI/dev.
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    // Servimos AVIF y WebP a browsers que las soporten (Chrome/FF/Edge
    // ≥ últimas 4 versiones). Next negocia vía `Accept` del request y cae
    // al PNG/JPG original si el cliente no soporta. Recortes típicos en
    // los _comparacion_hd.png de 1-4 MB → 200-700 KB en AVIF.
    formats: ["image/avif", "image/webp"],
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // Cache headers para los datasets servidos desde /public. Next ya cachea
  // /_next/static/ con immutable + 1 año, así que solo declaramos los path
  // que viven fuera de la pipeline build.
  async headers() {
    return [
      {
        // CSVs: sync de la pipeline corre cada 6h; un cache de 5 min en
        // browser y 10 min en CDN da margen a refrescar sin tirar la
        // experiencia de usuario.
        source: "/data/:path*.csv",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=300, s-maxage=600",
          },
        ],
      },
      {
        // GeoJSON de polígonos: cambia muy raro (estructura de barrios).
        // 1h browser permite que un usuario que vuelve a la home no haga
        // refetch. La pipeline manda 304 si no cambió de todas formas.
        source: "/data/:path*.geojson",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, s-maxage=3600",
          },
        ],
      },
      {
        // Animaciones Lottie: estáticas, no cambian entre deploys.
        // immutable + 1 día permite reusar entre páginas sin revalidar.
        source: "/animations/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, immutable",
          },
        ],
      },
      {
        // Media estática (PNG comparativos, GIF, MP4, PDF). No cambian
        // hasta el siguiente deploy del barrio. 1 día es razonable.
        source: "/data/media/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, s-maxage=86400",
          },
        ],
      },
    ];
  },
  async rewrites() {
    // Reenviar /api/* al backend FastAPI cuando este configurado.
    const apiBase = process.env.NEXT_PUBLIC_API_BASE;
    if (!apiBase) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${apiBase}/api/:path*`,
      },
    ];
  },
  // Re-arquitectura mayo 2026: el sitio pasó de 17 rutas flat a 6 hubs
  // top-level (Mapa, Indicadores, Pronóstico, Decisión, Historia, Datos).
  // Los redirects de abajo preservan bookmarks y SEO existentes — Google
  // retiene ranking de los 301 en 2-4 semanas. Mantenerlos indefinidamente.
  async redirects() {
    const map = [
      // → /indicadores/*
      ["/tipologia", "/indicadores/tipologia"],
      ["/calor", "/indicadores/calor"],
      ["/calidad-vida", "/indicadores/calidad-vida"],
      ["/densidad", "/indicadores/poblacion"],
      // → /pronostico/*
      ["/clima", "/pronostico/clima"],
      ["/riesgos", "/pronostico/riesgos"],
      ["/proyecciones", "/pronostico/proyecciones"],
      // → /decision/*
      ["/prioridades", "/decision/prioridades"],
      ["/comparar", "/decision/comparar"],
      // → /datos/* (capa histórica y validación se reubicaron acá tras la
      // poda del hub /historia top-level — los eventos extremos quedaron
      // archivados porque Posadas no tiene catástrofes recurrentes que
      // sostengan un catálogo histórico con confianza alta. Las URLs
      // viejas /historia* y /eventos redirigen al timeline para no
      // romper bookmarks de prensa o IDE de Misiones.)
      ["/historia", "/datos/historia"],
      ["/historia/eventos", "/datos/historia"],
      ["/historia/validacion", "/datos/validacion"],
      ["/eventos", "/datos/historia"],
      ["/validacion", "/datos/validacion"],
      ["/descargas", "/datos/descargas"],
      ["/metodologia", "/datos/metodologia"],
      ["/3d", "/datos/3d"],
      ["/explorar", "/datos/explorar"],
    ];
    return map.map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    }));
  },
};

export default withBundleAnalyzer(nextConfig);
