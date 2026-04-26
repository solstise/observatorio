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
};

export default withBundleAnalyzer(nextConfig);
