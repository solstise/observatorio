/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // El observatorio se sirve como sitio estatico + backend separado.
  // Podria exportarse con `next build && next export` si se quiere servir desde CDN.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
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

export default nextConfig;
