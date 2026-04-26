"use client";

// Página /explorar — vista de exploración libre con kepler.gl.
//
// Trade-off: kepler.gl como library pesa ~400 KB gzipeado y arrastra Redux
// + React 17 peer (no compatible con React 19). Para no cargar todo eso en
// el bundle inicial, usamos un iframe a kepler.gl/demo con un puente para
// pasarle datasets pre-cargados.
//
// Cómo funciona el puente:
//
// 1. El iframe apunta a https://kepler.gl/demo (la UI completa de Uber).
// 2. Cuando el iframe envía el handshake (postMessage type "loaded"),
//    enviamos los datasets desde nuestro lado vía postMessage con el
//    formato esperado por kepler:
//
//        { type: 'add_data', payload: { datasets: [...], options: {...} } }
//
// 3. Cargamos también `kepler_session.json` (mapStyle, layers, filters) y
//    se lo pasamos como `config` en el mismo evento.
//
// 4. Si el iframe no responde en 8 segundos, mostramos un fallback con
//    enlaces directos a los datasets para que el usuario los suba a mano.
//
// Note: kepler.gl/demo cambia su API ocasionalmente. La estrategia de
// fallback (descargar y subir manualmente) sigue funcionando aunque cambie
// el handshake. Por eso documentamos el flujo manual en pantalla.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Disclaimer } from "@/components/Disclaimer";

const KEPLER_DEMO_URL = "https://kepler.gl/demo";
const HANDSHAKE_TIMEOUT_MS = 8000;

interface KeplerDataset {
  info: { id: string; label: string };
  data: { fields: { name: string; type: string }[]; rows: unknown[][] };
}

export default function ExplorarPage() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<
    "idle" | "loading" | "ready" | "timeout" | "error"
  >("idle");
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setBridgeStatus("loading");
    let timer: ReturnType<typeof setTimeout> | null = null;
    let aborted = false;

    // Listener de postMessage: kepler envía { type: 'loaded' } cuando termina
    // de bootear. En ese momento le pasamos datasets + config.
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== "https://kepler.gl") return;
      const data = event.data as { type?: string };
      if (data?.type === "loaded") {
        sendData().catch((err: unknown) => {
          setBridgeError(
            err instanceof Error ? err.message : "Error enviando data",
          );
          setBridgeStatus("error");
        });
      }
    };
    window.addEventListener("message", onMessage);

    // Timeout: si no recibimos handshake en 8s, asumimos que kepler cambió
    // el protocolo. Mostramos UI de fallback con descargas manuales.
    timer = setTimeout(() => {
      if (aborted) return;
      setBridgeStatus("timeout");
    }, HANDSHAKE_TIMEOUT_MS);

    async function sendData() {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) {
        throw new Error("El iframe no está montado");
      }
      const [rankingDataset, configResponse] = await Promise.all([
        loadRankingAsKeplerDataset(),
        fetch("/data/kepler_session.json").then((r) =>
          r.ok ? r.json() : null,
        ),
      ]);
      const datasets: KeplerDataset[] = [];
      if (rankingDataset) datasets.push(rankingDataset);
      iframe.contentWindow.postMessage(
        {
          type: "add_data",
          payload: {
            datasets,
            options: { centerMap: true, readOnly: false },
            config: configResponse?.config,
          },
        },
        "https://kepler.gl",
      );
      if (!aborted) {
        setBridgeStatus("ready");
        if (timer) clearTimeout(timer);
      }
    }

    return () => {
      aborted = true;
      window.removeEventListener("message", onMessage);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <Disclaimer />
      <main className="container-obs py-8">
        <nav
          aria-label="Migas"
          className="mb-4 text-sm text-secondary dark:text-dk-muted"
        >
          <Link href="/" className="hover:underline">
            Mapa
          </Link>{" "}
          <span aria-hidden>/</span>{" "}
          <span className="text-neutral-muted dark:text-dk-muted">
            Exploración libre
          </span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Vista experimental — kepler.gl
          </p>
          <h1 className="mt-2 font-bold" style={{ fontSize: "var(--fs-h1)" }}>
            Explorá los datos a tu manera
          </h1>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Esta es una vista de exploración libre con kepler.gl, la
            herramienta de visualización geoespacial de Uber. Drag-and-drop
            campos para crear tus propias capas de puntos, hexágonos, líneas
            y heatmaps. Cuando el iframe termine de cargar, los datasets del
            observatorio se envían automáticamente — si tu navegador bloquea
            el handshake, podés descargarlos y subirlos manualmente desde el
            menú "Add Data" de kepler.
          </p>
        </header>

        <BridgeStatus status={bridgeStatus} error={bridgeError} />

        <div className="overflow-hidden rounded-lg border border-neutral-border dark:border-dk-border">
          <iframe
            ref={iframeRef}
            src={KEPLER_DEMO_URL}
            title="Exploración libre con kepler.gl"
            // Permitimos webgl, downloads y full screen para que kepler funcione.
            // No permitimos top-navigation ni form submit cross-origin.
            sandbox="allow-scripts allow-same-origin allow-downloads allow-forms allow-popups"
            // En mobile bajamos altura para que el chrome del iframe quepa.
            className="h-[calc(100vh-260px)] min-h-[520px] w-full bg-neutral-100 dark:bg-dk-elevated"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-2">
          <DownloadCard
            title="Polígonos del observatorio"
            description="43 barrios disjuntos + capa Posadas total. Formato GeoJSON."
            href="/data/poligonos.geojson"
            filename="poligonos.geojson"
          />
          <DownloadCard
            title="Ranking político por barrio"
            description="Índice de prioridad + componentes (vulnerabilidad, UHI, acceso a servicios)."
            href="/data/social/ranking.csv"
            filename="ranking.csv"
          />
          <DownloadCard
            title="Serie temporal 2018-2026"
            description="Superficie construida, vegetación, edificios totales por polígono y año."
            href="/data/serie_temporal.csv"
            filename="serie_temporal.csv"
          />
          <DownloadCard
            title="UHI mensual (Landsat)"
            description="Diferencia de temperatura del suelo por barrio vs. campo y vs. ciudad."
            href="/data/calor/uhi_mensual.csv"
            filename="uhi_mensual.csv"
          />
        </section>

        <section className="mt-10 space-y-3 border-t border-neutral-border pt-6 text-sm text-neutral-text dark:border-dk-border dark:text-dk-text">
          <h2 className="text-lg font-semibold text-primary dark:text-dk-primary">
            Cómo usar esta vista
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Auto-cargar</strong>: si todo va bien, ranking.csv ya
              está en el panel "Datasets" de kepler. Arrastrá los campos
              latitud/longitud al canvas para ver los puntos.
            </li>
            <li>
              <strong>Subir manualmente</strong>: si el iframe no recibió los
              datos (firewall corporativo, navegador estricto), bajá los CSV
              de los enlaces de arriba y subílos vía "Add Data → Upload File".
            </li>
            <li>
              <strong>Tipos de capas útiles</strong>: Hexbin para ver densidad
              de viviendas, Arc para conectar barrios por similitud, Trip
              para animar la serie temporal, 3D Heatmap para UHI.
            </li>
            <li>
              <strong>Exportar</strong>: kepler permite guardar el mapa como
              imagen PNG, JSON config o HTML standalone. Útil para informes
              ad hoc.
            </li>
          </ul>
        </section>

        <p className="mt-6 text-xs text-neutral-muted dark:text-dk-muted">
          kepler.gl es una herramienta de Uber Open Source bajo licencia MIT.
          La versión embebida vive en kepler.gl/demo y se actualiza
          independientemente de este observatorio.
        </p>
      </main>
    </>
  );
}

// --- Helpers ----------------------------------------------------------------

// Carga ranking.csv y lo convierte al formato que kepler espera (rows + fields).
// Le agregamos columnas latitud/longitud computando centroides desde
// poligonos.geojson — kepler necesita coords explícitas para el layer point.
async function loadRankingAsKeplerDataset(): Promise<KeplerDataset | null> {
  const [csvText, geojson] = await Promise.all([
    fetch("/data/social/ranking.csv").then((r) => (r.ok ? r.text() : null)),
    fetch("/data/poligonos.geojson").then((r) => (r.ok ? r.json() : null)),
  ]);
  if (!csvText || !geojson) return null;
  const lines = csvText.trim().split(/\r?\n/);
  const headers = lines[0].split(",");
  const rows = lines.slice(1).map((l) => l.split(","));

  // Centroides aproximados por bbox.
  type Feature = {
    properties: { id: string };
    geometry: { type: string; coordinates: unknown };
  };
  const centroidById = new Map<string, [number, number]>();
  for (const f of (geojson as { features: Feature[] }).features) {
    const id = f.properties?.id;
    const ring = extractRing(f.geometry);
    if (id && ring) {
      const c = bboxCenter(ring);
      centroidById.set(id, c);
    }
  }

  // Inyectamos latitud/longitud al final.
  headers.push("latitud", "longitud");
  const enrichedRows = rows.map((cols) => {
    const id = cols[0];
    const [lat, lon] = centroidById.get(id) ?? [null, null];
    return [
      ...cols,
      lat !== null ? String(lat) : "",
      lon !== null ? String(lon) : "",
    ];
  });

  // kepler espera fields tipados. Inferimos: numérico si todos los valores
  // parsean a number, sino string. Lat/lon van forzados a real.
  const fields = headers.map((name) => {
    if (name === "latitud" || name === "longitud") {
      return { name, type: "real" };
    }
    const sample = enrichedRows.slice(0, 5).map((r) => r[headers.indexOf(name)]);
    const allNumeric = sample.every((v) => v !== "" && !isNaN(Number(v)));
    return { name, type: allNumeric ? "real" : "string" };
  });

  return {
    info: { id: "ranking", label: "Ranking político por barrio" },
    data: {
      fields,
      rows: enrichedRows.map((cols) =>
        cols.map((v, i) =>
          fields[i].type === "real" ? (v === "" ? null : Number(v)) : v,
        ),
      ),
    },
  };
}

function extractRing(geometry: {
  type: string;
  coordinates: unknown;
}): [number, number][] | null {
  if (geometry.type === "Polygon") {
    return ((geometry.coordinates as number[][][])[0] ?? []) as [
      number,
      number,
    ][];
  }
  if (geometry.type === "MultiPolygon") {
    return ((geometry.coordinates as number[][][][])[0]?.[0] ?? []) as [
      number,
      number,
    ][];
  }
  return null;
}

function bboxCenter(ring: [number, number][]): [number, number] {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lon, lat] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return [(minLat + maxLat) / 2, (minLon + maxLon) / 2];
}

// --- UI helpers -------------------------------------------------------------

function BridgeStatus({
  status,
  error,
}: {
  status: "idle" | "loading" | "ready" | "timeout" | "error";
  error: string | null;
}) {
  if (status === "ready") {
    return (
      <div
        role="status"
        className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-100"
      >
        Datos enviados al iframe. Buscá <strong>ranking</strong> en el panel
        de datasets de kepler para empezar a visualizar.
      </div>
    );
  }
  if (status === "loading") {
    return (
      <div
        role="status"
        className="mb-4 rounded-md border border-neutral-border bg-white p-3 text-sm text-neutral-muted dark:border-dk-border dark:bg-dk-surface dark:text-dk-muted"
      >
        Esperando handshake del iframe de kepler.gl…
      </div>
    );
  }
  if (status === "timeout") {
    return (
      <div
        role="status"
        className="mb-4 rounded-md border border-accent-200 bg-accent-50 p-3 text-sm dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100"
      >
        El handshake automático no respondió en 8 s. No es un error grave: el
        iframe sigue funcionando, pero los datasets no se enviaron
        automáticamente. Bajalos de los enlaces de abajo y subílos a kepler
        con <strong>Add Data → Upload File</strong>.
      </div>
    );
  }
  if (status === "error" && error) {
    return (
      <div
        role="alert"
        className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-700/60 dark:bg-red-900/30 dark:text-red-100"
      >
        Error en el puente con kepler.gl: {error}. Usá los enlaces de descarga
        de abajo y cargalos manualmente.
      </div>
    );
  }
  return null;
}

function DownloadCard({
  title,
  description,
  href,
  filename,
}: {
  title: string;
  description: string;
  href: string;
  filename: string;
}) {
  return (
    <div className="rounded-md border border-neutral-border bg-white p-4 dark:border-dk-border dark:bg-dk-surface">
      <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
        {title}
      </h3>
      <p className="mt-1 text-xs text-neutral-muted dark:text-dk-muted">
        {description}
      </p>
      <a
        href={href}
        download={filename}
        className="mt-2 inline-flex min-h-[36px] items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600 dark:bg-dk-primary dark:text-dk-bg"
      >
        Descargar {filename}
      </a>
    </div>
  );
}
