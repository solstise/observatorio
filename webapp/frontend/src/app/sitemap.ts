// Sitemap dinámico del Observatorio Urbano Posadas.
// Genera /sitemap.xml en build/runtime listando rutas estáticas + una
// ficha por cada barrio publicado en el geojson.
//
// Docs: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
//
// Convenciones:
// - lastmod: tomamos /public/data/updated_at.txt si existe (lo escribe la
//   pipeline en cada sync), sino usamos la fecha actual del build.
// - changefreq: weekly para fichas y dashboards (dato satelital semanal),
//   monthly para metodología y glosario.
// - priority: 1.0 home, 0.8 hubs top-level, 0.7 sub-páginas de indicadores
//   y pronóstico (las analíticas de uso frecuente), 0.6 sub-páginas
//   secundarias (historia, decisión, datos auxiliares) y fichas por barrio.
//
// Arquitectura de rutas: 6 hubs top-level (indicadores, pronostico,
// decision, historia, datos) más sub-rutas. Las rutas viejas (flat)
// están redirigidas con 301 en next.config.mjs y NO se listan acá: el
// sitemap solo debe apuntar a las URLs canónicas finales.

import type { MetadataRoute } from "next";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { getPoligonos } from "@/lib/data.server";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://sateliteposadas.com";

// Lee la fecha del último sync de la pipeline. Si falta caemos a "ahora".
async function getLastModified(): Promise<Date> {
  try {
    const txt = await readFile(
      path.join(process.cwd(), "public", "data", "updated_at.txt"),
      "utf-8",
    );
    const trimmed = txt.trim();
    if (trimmed) {
      const d = new Date(trimmed);
      if (!Number.isNaN(d.getTime())) return d;
    }
  } catch {
    // updated_at.txt todavía no existe — primera build pre-pipeline.
  }
  return new Date();
}

// Rutas estáticas del frontend, agrupadas por hub.
// changefreq y priority calibrados al rol de cada página.
const STATIC_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  // Home
  { path: "/", changeFrequency: "weekly", priority: 1.0 },

  // Hub: Indicadores (5 capas analíticas)
  { path: "/indicadores", changeFrequency: "weekly", priority: 0.8 },
  { path: "/indicadores/tipologia", changeFrequency: "weekly", priority: 0.7 },
  { path: "/indicadores/calor", changeFrequency: "weekly", priority: 0.8 },
  { path: "/indicadores/aire", changeFrequency: "daily", priority: 0.7 },
  { path: "/indicadores/poblacion", changeFrequency: "weekly", priority: 0.7 },
  { path: "/indicadores/calidad-vida", changeFrequency: "weekly", priority: 0.7 },

  // Hub: Pronóstico (14 días + escenarios)
  { path: "/pronostico", changeFrequency: "daily", priority: 0.8 },
  { path: "/pronostico/riesgos", changeFrequency: "daily", priority: 0.7 },
  { path: "/pronostico/clima", changeFrequency: "daily", priority: 0.7 },
  { path: "/pronostico/proyecciones", changeFrequency: "monthly", priority: 0.6 },

  // Hub: Decisión (priorización + comparador)
  { path: "/decision", changeFrequency: "weekly", priority: 0.8 },
  { path: "/decision/prioridades", changeFrequency: "weekly", priority: 0.7 },
  { path: "/decision/comparar", changeFrequency: "weekly", priority: 0.6 },

  // Hub: Datos (sala de máquinas — metodología, descargas, glosario,
  // explorar, 3d, más la línea de tiempo histórica y la validación cruzada
  // que se reubicaron acá tras la poda del hub /historia top-level)
  { path: "/datos", changeFrequency: "monthly", priority: 0.6 },
  { path: "/datos/metodologia", changeFrequency: "monthly", priority: 0.5 },
  { path: "/datos/descargas", changeFrequency: "weekly", priority: 0.5 },
  { path: "/datos/glosario", changeFrequency: "monthly", priority: 0.5 },
  { path: "/datos/historia", changeFrequency: "monthly", priority: 0.7 },
  { path: "/datos/validacion", changeFrequency: "weekly", priority: 0.6 },
  { path: "/datos/explorar", changeFrequency: "weekly", priority: 0.6 },
  { path: "/datos/3d", changeFrequency: "weekly", priority: 0.6 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = await getLastModified();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  // Fichas por polígono. Si el geojson aún no se sincronizó, devolvemos
  // solo las rutas estáticas (no fallar el build).
  let dynamicEntries: MetadataRoute.Sitemap = [];
  try {
    const collection = await getPoligonos();
    dynamicEntries = collection.features
      // Excluir la capa "ciudad_completa" — no tiene ficha propia.
      .filter((f) => f.properties.categoria_original !== "ciudad_completa")
      // Respetar el flag editorial publicar_en_sitio (default true).
      // El flag no está tipado en PoligonoProperties porque viene del
      // pipeline editorial; lo leemos vía cast suave para no tocar
      // src/lib/types.ts (responsabilidad del agente de datos).
      .filter((f) => {
        const props = f.properties as unknown as Record<string, unknown>;
        return props.publicar_en_sitio !== false;
      })
      .map((f) => ({
        url: `${SITE_URL}/poligono/${f.properties.id}`,
        lastModified,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[sitemap] No se pudo leer poligonos.geojson:", err);
  }

  return [...staticEntries, ...dynamicEntries];
}
