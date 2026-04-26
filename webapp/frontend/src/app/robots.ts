// robots.txt dinámico del Observatorio Urbano Posadas.
// Permitimos todo el sitio público y bloqueamos /api/* (endpoints de
// forecast/datos no son útiles para crawlers, son consumidos por el
// frontend). Apuntamos al sitemap canónico.
//
// Docs: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots

import type { MetadataRoute } from "next";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://observatorio.sistemaswinter.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
