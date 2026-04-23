// Layout global del Observatorio Urbano Posadas.
// Carga Inter via next/font/google y monta Header/Footer.

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

export const metadata: Metadata = {
  title: {
    default: "Observatorio Urbano Posadas",
    template: "%s | Observatorio Urbano Posadas",
  },
  description:
    "Dashboard publico de expansion urbana de Posadas, Misiones. Datos de satelites, edificios y servicios publicos.",
  keywords: [
    "Posadas",
    "Misiones",
    "urbanismo",
    "expansion urbana",
    "Sentinel-2",
    "Open Buildings",
    "observatorio",
  ],
  authors: [{ name: "Observatorio Urbano Posadas" }],
  openGraph: {
    title: "Observatorio Urbano Posadas",
    description:
      "Dashboard publico de expansion urbana de Posadas, Misiones.",
    locale: "es_AR",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-AR" className={inter.variable}>
      <body className="flex min-h-screen flex-col bg-white font-sans text-neutral-text">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-white"
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
