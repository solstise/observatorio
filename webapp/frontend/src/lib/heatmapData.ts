// Utilidades para construir los datasets que consume HeatmapLayer.
//
// Dos fuentes principales:
//
// 1. Centroides de viviendas detectadas — `/data/buildings_centroids.geojson`
//    (24 MB, ~217k features). Para mantener el frontend rápido aplicamos
//    sampling: tomamos cada 5to centroide y le asignamos peso 5x para que
//    la densidad agregada se preserve. Eso baja el costo a ~43k puntos
//    sin sacrificar la lectura visual del heatmap.
//
// 2. Centroides de barrios + UHI verano — combinación de poligonos.geojson
//    (que trae el contorno) y `social/ranking.csv` (que trae uhi_verano por
//    polígono). Calculamos el centroide a partir del bbox del polígono
//    (suficientemente bueno para un heatmap a nivel barrio).
//
// Las funciones devuelven `HeatmapPoint[]` listo para HeatmapLayer.

import Papa from "papaparse";

import type { HeatmapPoint } from "@/components/HeatmapLayer";
import type { PoligonosCollection, RankingPoliticoRow } from "@/lib/types";

interface CentroidFeature {
  type: "Feature";
  properties: { s: string; a: number };
  geometry: { type: "Point"; coordinates: [number, number] };
}

interface CentroidFC {
  type: "FeatureCollection";
  features: CentroidFeature[];
}

// Sample factor: tomamos 1 de cada N centroides. Lo bajamos a 5 — con 217k
// features eso deja ~43k puntos, suficientes para un heatmap denso pero
// rápido en GPU integradas. Si tu meta es 60 fps en mobile, subí a 10.
export const BUILDINGS_SAMPLE_FACTOR = 5;

export async function fetchBuildingPoints(
  signal?: AbortSignal,
  sampleFactor = BUILDINGS_SAMPLE_FACTOR,
): Promise<HeatmapPoint[]> {
  const res = await fetch("/data/buildings_centroids.geojson", { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} cargando buildings`);
  const fc = (await res.json()) as CentroidFC;
  // Sampling: cada N-ésimo punto. Asumimos que el orden del GeoJSON ya está
  // shuffled o al menos no agrupado por barrio, lo cual aplica a los datos
  // generados por scripts/48_buildings_centroids.py (que mergea Google y MS
  // ordenados por hash de coordenada).
  const out: HeatmapPoint[] = [];
  const total = fc.features.length;
  for (let i = 0; i < total; i += sampleFactor) {
    const f = fc.features[i];
    if (!f?.geometry?.coordinates) continue;
    const [lon, lat] = f.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push({
      lat,
      lon,
      // Peso = factor de sampleo, así la densidad agregada en el heatmap
      // coincide aproximadamente con la del dataset completo.
      weight: sampleFactor,
    });
  }
  return out;
}

// Devuelve, por cada polígono de la collection, un punto (centroide + UHI).
// Usamos UHI verano como peso porque es la métrica más relevante para
// políticas públicas de mitigación de calor; null se neutraliza a 0.
export async function fetchUhiPoints(
  collection: PoligonosCollection,
  signal?: AbortSignal,
): Promise<HeatmapPoint[]> {
  const res = await fetch("/data/social/ranking.csv", { signal });
  if (!res.ok) {
    // Resiliencia: si ranking.csv no está, devolvemos lista vacía.
    return [];
  }
  const text = await res.text();
  const parsed = Papa.parse<RankingPoliticoRow>(text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    comments: "#",
  });
  const byId = new Map<string, RankingPoliticoRow>();
  for (const row of parsed.data) {
    if (row.poligono_id) byId.set(String(row.poligono_id), row);
  }
  const out: HeatmapPoint[] = [];
  for (const f of collection.features) {
    const props = f.properties;
    if (props.categoria_original === "ciudad_completa") continue; // skip el envoltorio
    const ring = extractFirstRing(f.geometry);
    if (!ring) continue;
    const [lat, lon] = bboxCenter(ring);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const r = byId.get(props.id);
    const uhi = r?.uhi_verano;
    // Peso: si uhi_verano > 0, lo escalamos a magnitudes interpretables por
    // HeatmapLayer (que prefiere weights > 0). Si es null o ≤0, neutralizamos
    // a 1 para que el barrio aparezca pero sin destacar.
    const weight = typeof uhi === "number" && Number.isFinite(uhi) && uhi > 0
      ? uhi * 10 // escala visual: 6°C → 60, 8°C → 80
      : 1;
    out.push({ lat, lon, weight });
  }
  return out;
}

// Extrae el anillo exterior del polígono o multipolígono. Suficiente para
// un centroide aproximado por bbox.
function extractFirstRing(
  geometry: { type: string; coordinates: unknown },
): [number, number][] | null {
  if (!geometry) return null;
  if (geometry.type === "Polygon") {
    const coords = geometry.coordinates as number[][][];
    return (coords[0] ?? []) as [number, number][];
  }
  if (geometry.type === "MultiPolygon") {
    const coords = geometry.coordinates as number[][][][];
    return (coords[0]?.[0] ?? []) as [number, number][];
  }
  return null;
}

// Centroide aproximado por bbox: barato y suficiente para un heatmap a nivel
// ciudad. Para coords más exactas habría que computar centroide poligonal,
// pero eso solo importa para barrios muy alargados.
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
