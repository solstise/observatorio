// Layout global del Observatorio Urbano Posadas.
// Carga Inter via next/font/google y monta Header/Footer.
//
// Dark mode:
// - Inyectamos un <script> síncrono en el <head> que lee localStorage.theme
//   (o el `prefers-color-scheme` del SO) y aplica la clase `dark` a <html>
//   ANTES de la hidratación de React. Esto evita el flash blanco que ocurre
//   en SSR cuando el HTML inicial siempre se pinta en light.
// - El script vive como string para que se ejecute como código sincrónico
//   antes de cualquier cosa de React. `suppressHydrationWarning` en <html>
//   neutraliza el warning de mismatch generado por la mutación de la clase.

import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Script anti-flash: minificado a mano para que sea trivial de auditar.
// Lee localStorage.theme; si es "dark" aplica dark, si es "light" aplica
// light, si no hay nada cae a prefers-color-scheme. Todo dentro de try/catch
// porque localStorage puede tirar en private mode y matchMedia puede no
// existir en clientes muy viejos.
const NO_FLASH_SCRIPT = `try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}`;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ||
  "https://observatorio.sistemaswinter.com";

// JSON-LD schema.org — ayuda a Google a entender el sitio como
// WebSite + Organization. Inyectado como string para evitar serializar
// caracteres especiales mal y para mantenerlo en un solo lugar.
// Docs: https://schema.org/WebSite y https://schema.org/Dataset
const JSON_LD_SCHEMA = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Observatorio Urbano Posadas",
      description:
        "Dashboard público de expansión urbana, calor y servicios en Posadas (Misiones, AR).",
      inLanguage: "es-AR",
      publisher: { "@id": `${SITE_URL}/#org` },
      potentialAction: {
        "@type": "SearchAction",
        target: `${SITE_URL}/explorar?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#org`,
      name: "Observatorio Urbano Posadas",
      url: SITE_URL,
      areaServed: {
        "@type": "City",
        name: "Posadas",
        containedInPlace: {
          "@type": "AdministrativeArea",
          name: "Misiones, Argentina",
        },
      },
    },
    {
      "@type": "Dataset",
      "@id": `${SITE_URL}/#dataset-expansion`,
      name: "Expansión urbana de Posadas (43 barrios, 2018–2026)",
      description:
        "Serie temporal de superficie construida y población estimada por polígono, derivada de Sentinel-2, Google Open Buildings, Microsoft Building Footprints y WorldPop.",
      url: SITE_URL,
      keywords: [
        "Posadas",
        "expansión urbana",
        "Sentinel-2",
        "Open Buildings",
        "WorldPop",
      ],
      license: "https://creativecommons.org/licenses/by/4.0/",
      isAccessibleForFree: true,
      creator: { "@id": `${SITE_URL}/#org` },
      spatialCoverage: {
        "@type": "Place",
        name: "Posadas, Misiones, Argentina",
      },
    },
  ],
});

// Descripción canónica reutilizada en title, og:description y twitter:description.
// Si se actualiza, hacerlo en un solo lugar.
const SITE_DESCRIPTION =
  "Cómo crece Posadas (Misiones, AR): 43 barrios, datos satelitales, calor urbano, servicios públicos y pronóstico climático.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Observatorio Urbano Posadas",
    template: "%s · Observatorio Urbano Posadas",
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "Posadas",
    "Misiones",
    "urbanismo",
    "expansion urbana",
    "Sentinel-2",
    "Open Buildings",
    "observatorio",
    "calor urbano",
    "isla de calor",
    "pronostico climatico",
    "barrios",
    "datos satelitales",
  ],
  authors: [{ name: "Observatorio Urbano Posadas" }],
  applicationName: "Observatorio Urbano Posadas",
  // Open Graph — Facebook / WhatsApp / LinkedIn / etc.
  // El campo `images` se omite a propósito: el archivo
  // src/app/opengraph-image.tsx genera /opengraph-image automáticamente
  // y Next.js inyecta la metaetiqueta og:image apuntando ahí en cada ruta
  // (con override por ficha en /poligono/[id]/opengraph-image.tsx).
  openGraph: {
    title: "Observatorio Urbano Posadas",
    description: SITE_DESCRIPTION,
    siteName: "Observatorio Urbano Posadas",
    locale: "es_AR",
    type: "website",
    url: SITE_URL,
  },
  // Twitter Card — large image preview en X / TweetDeck / Threads.
  twitter: {
    card: "summary_large_image",
    title: "Observatorio Urbano Posadas",
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: "/",
  },
  category: "government",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-AR" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
        {/* JSON-LD: WebSite + Organization + Dataset principal.
            Schema markup ayuda a Google a indexar el sitio como
            dataset gubernamental y mostrar rich results. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON_LD_SCHEMA }}
        />
      </head>
      <body className="flex min-h-screen flex-col bg-white font-sans text-neutral-text dark:bg-dk-bg dark:text-dk-text">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-white dark:focus:bg-dk-primary dark:focus:text-dk-bg"
        >
          Saltar al contenido
        </a>
        <Header />
        <main id="contenido" className="flex-1">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
