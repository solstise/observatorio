// Tests de los parsers de fuentes oficiales en vivo, con muestras reales del 22/10/2026.
// Ejecutar con: node --test tests/unit (Node 22.18+ ejecuta TypeScript sin compilar).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  capColor, capLinks, describeWx, isCapFeed, distanceToRingKm, parseCap, parseMetars, parsePrefectura,
  controlDay, parseSynop, parseTiepre, rainBlocks, selectAlerts, splitInstructions,
  summarizeFlashes, summarizeSynop, POSADAS, bearingDeg, directionName, lightningTrend, nearestLightning,
} from "../../src/lib/nino-live/parse.ts";

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("alerta CAP del SMN que cubre Posadas", () => {
  const alert = parseCap(fixture("cap_alerta_posadas.xml"), "https://ssl.smn.gob.ar/feeds/CAP/xml_generados/x.xml");
  assert.equal(alert.afecta_posadas, true);
  assert.equal(alert.distancia_km, 0);
  assert.equal(alert.color, "amarilla");
  assert.equal(alert.tipo, "alerta");
  assert.equal(alert.evento, "Tormentas");
  assert.equal(alert.inicio, "2026-10-22T22:42:04-03:00");
  assert.equal(alert.fin, "2026-10-24T14:59:59-03:00");
  assert.match(alert.descripcion, /entre 40 y 70 mm/);
  assert.match(alert.descripcion, /granizo/);
  assert.equal(alert.instrucciones.length, 6);
  assert.equal(alert.instrucciones[0], "Evitá salir.");
  assert.deepEqual(alert.lluvia_mm, [40, 70]);
  assert.equal(alert.menciona_granizo, true);
});

test("aviso a muy corto plazo con prefijo cap: y color en el título", () => {
  const alert = parseCap(fixture("cap_aviso_corto_plazo.xml"), "https://ssl.smn.gob.ar/feeds/CAP/avisocortoplazo/2026_10_23_0045_cap_es.xml");
  assert.equal(alert.tipo, "aviso_corto_plazo");
  assert.equal(alert.color, "naranja");
  assert.equal(alert.afecta_posadas, false);
  assert.ok(alert.distancia_km > 100 && alert.distancia_km < 200, `distancia ${alert.distancia_km}`);
  assert.equal(alert.zona, "MISIONES: GUARANI - MONTECARLO - SAN PEDRO");
  assert.equal(alert.inicio, "2026-10-23T00:45:00-03:00");
  assert.ok(alert.instrucciones.length > 3);
});

test("selección de alertas: vence, deduplica y separa avisos cercanos", () => {
  const posadas = parseCap(fixture("cap_alerta_posadas.xml"), "a");
  const lejos = parseCap(fixture("cap_aviso_corto_plazo.xml"), "https://ssl.smn.gob.ar/feeds/CAP/avisocortoplazo/b.xml");
  const now = Date.parse("2026-10-23T01:00:00-03:00");
  let sel = selectAlerts([posadas, posadas, lejos], now, 50);
  assert.equal(sel.posadas.length, 1);
  assert.equal(sel.cerca.length, 0);
  sel = selectAlerts([lejos], now, 500);
  assert.equal(sel.cerca.length, 1);
  sel = selectAlerts([posadas], Date.parse("2026-10-24T15:00:00-03:00"));
  assert.equal(sel.posadas.length, 0);
});

test("colores CAP, instrucciones y enlaces de la página del SMN", () => {
  assert.equal(capColor("Extreme"), "roja");
  assert.equal(capColor("Minor"), "informativa");
  assert.equal(capColor("Moderate", "AVISO NARANJA POR TORMENTAS"), "naranja");
  assert.deepEqual(splitInstructions("1- Evitá salir. 2- Cerrá puertas."), ["Evitá salir.", "Cerrá puertas."]);
  assert.deepEqual(
    capLinks('<a href="https://ssl.smn.gob.ar/feeds/CAP/avisocortoplazo/a.xml">x</a><a href="https://ssl.smn.gob.ar/feeds/CAP/avisocortoplazo/a.xml">'),
    ["https://ssl.smn.gob.ar/feeds/CAP/avisocortoplazo/a.xml"],
  );
  // A los programas el SMN les responde RSS con <link> y <guid>.
  const rss = "<rss><channel><item><link>https://ssl.smn.gob.ar/feeds/CAP/xml_generados/b.xml</link><guid>https://ssl.smn.gob.ar/feeds/CAP/xml_generados/b.xml</guid></item></channel></rss>";
  assert.deepEqual(capLinks(rss), ["https://ssl.smn.gob.ar/feeds/CAP/xml_generados/b.xml"]);
  assert.equal(isCapFeed("<?xml?><rss><title>Servicio Meteorologico Nacional</title></rss>"), true);
  assert.equal(isCapFeed("<html><title>Just a moment...</title></html>"), false);
  const square = [[-27, -56], [-27, -55.5], [-27.5, -55.5], [-27.5, -56]];
  assert.equal(distanceToRingKm(POSADAS, square), 0);
});

test("SYNOP de Posadas Aero: bloques de 6 h y día pluviométrico", () => {
  const reports = parseSynop(fixture("synop_87178.txt"));
  const blocks = rainBlocks(reports);
  const at = hasta => blocks.find(b => b.hasta === hasta)?.mm;
  assert.equal(at("2026-10-22T00:00:00.000Z"), 25);
  assert.equal(at("2026-10-22T06:00:00.000Z"), 30);
  // 75 mm en 24 h menos 3 + 25 + 30 informados en los bloques anteriores.
  assert.equal(at("2026-10-22T12:00:00.000Z"), 17);
  assert.equal(at("2026-10-22T18:00:00.000Z"), 10);
  const summary = summarizeSynop(reports);
  const total = h => summary.totales.find(t => t.horas === h);
  assert.equal(total(24).mm, 63);
  assert.equal(total(24).hasta, "2026-10-23T00:00:00.000Z");
  assert.equal(total(72).mm, 91);
  assert.ok(total(120).mm >= 91);
  const day = summary.dias.find(d => d.fecha === "2026-10-22");
  assert.deepEqual([day.mm, day.parcial, day.tormenta], [75, false, true]);
  const today = summary.dias.find(d => d.fecha === "2026-10-23");
  assert.deepEqual([today.mm, today.parcial], [16, true]);
  assert.ok(summary.horas_tormenta_24h > 5);
});

test("SYNOP: un bloque sin informar no se convierte en cero", () => {
  const lines = fixture("synop_87178.txt").split("\n").filter(l => !l.startsWith("87178,2026,10,22,06,"));
  const summary = summarizeSynop(parseSynop(lines.join("\n")));
  const blocks = rainBlocks(parseSynop(lines.join("\n")));
  assert.equal(blocks.find(b => b.hasta === "2026-10-22T06:00:00.000Z"), undefined);
  // El de las 12 UTC trae su propio grupo de 6 h: no hace falta deducirlo.
  assert.equal(blocks.find(b => b.hasta === "2026-10-22T12:00:00.000Z").mm, 17);
  assert.equal(summary.totales.find(t => t.horas === 24).completo, false);
  // Sin el grupo de 6 h ni el reporte de las 06, el bloque de las 12 no se deduce.
  const sin6h = lines.join("\n").replace(" 60171 ", " ");
  assert.equal(rainBlocks(parseSynop(sin6h)).find(b => b.hasta === "2026-10-22T12:00:00.000Z").mm, null);
});

test("SYNOP: la sección 555 no es lluvia y un total incoherente queda sin dato", () => {
  // 02/03/2017: sin lluvia (iR=3); 72518 está en la sección nacional 555.
  const r = parseSynop("87178,2017,03,02,12,00,AAXX 02124 87178 32970 10506 10262 20227 39934 40076 52012 81070 333 10283 20237 56000 81360 555 10090 60851 72518=");
  assert.equal(r[0].lluvia[24], 0);
  // 12/05/2004: 919 mm en 24 h con 0 + 0 + 0,3 mm en las partes de 6 h.
  const lines = [
    "87178,2004,05,11,18,00,AAXX 11184 87178 32970 70909 10247 20169 39966 40111 57032 87070 333 56070 87360=",
    "87178,2004,05,12,00,00,AAXX 12004 87178 32970 80906 10209 20172 39972 40117 51005 8807/ 333 10250 20187 56009 88360=",
    "87178,2004,05,12,06,00,AAXX 12064 87178 11270 81104 10196 20185 39954 40097 57017 69931 72052 8467/ 333 56009 84704 88360 96450=",
    "87178,2004,05,12,12,00,AAXX 12124 87178 01230 81602 10196 20187 39972 40116 52013 69194 71052 886// 333 10210 20192 56099 69961 84705 88610=",
  ].join("\n");
  const block = rainBlocks(parseSynop(lines)).find(b => b.hasta === "2004-05-12T12:00:00.000Z");
  assert.equal(block.mm, null);
  const day = summarizeSynop(parseSynop(lines)).dias.find(d => d.fecha === "2004-05-12");
  assert.deepEqual([day.mm, day.control], [null, "dudoso"]);
});

test("SYNOP: mensaje pegado con otro 333, iR=3 y lluvia de 6 h en la sección 3", () => {
  // 11/05/2001: un segundo "333" pegado traía 71817 (181,7 mm); iR=3 dice que no llovió.
  const [pegado] = parseSynop("87178,2001,05,11,12,00,AAXX 11124 87178 32970 11103 10127 20094 30041 40190 52020 81070 333 10147 20106 56030 81360 333 10191 60251 64210 65046 71817 74166 88957 90000=");
  assert.deepEqual([pegado.lluvia[24], pegado.lluvia[6], pegado.llovio], [0, 0, false]);
  // 22/10/2026 a las 12 UTC: 75 mm en 24 h (sección 1) y 17 mm en 6 h (sección 3, 60171).
  const reports = parseSynop(fixture("synop_87178.txt"));
  const r12 = reports.find(r => r.utc === "2026-10-22T12:00:00.000Z");
  assert.deepEqual([r12.lluvia[24], r12.lluvia[6], r12.llovio], [75, 17, true]);
  assert.equal(controlDay(75, new Map([[18, 3], [0, 25], [6, 30], [12, 17]]), new Set()), "ok");
  // Lo que no explican las partes necesita un reporte de lluvia en esos tramos.
  assert.equal(controlDay(182, new Map([[18, 18], [0, 2], [6, 0]]), new Set()), "dudoso");
  assert.equal(controlDay(182, new Map([[18, 18], [0, 2], [6, 0]]), new Set([12])), "ok");
  assert.equal(controlDay(undefined, new Map(), new Set()), "sin_total");
});

test("METAR: tormenta actual y descripción en castellano", () => {
  const rows = JSON.parse(fixture("metar_sarp.json"));
  const latest = Math.max(...rows.map(r => r.obsTime)) * 1000;
  const summary = parseMetars(rows, latest + 10 * 60_000);
  assert.equal(summary.ultimo.texto, "tormenta con lluvia débil");
  assert.equal(summary.ultimo.tormenta, true);
  assert.equal(summary.tormenta_ultima_hora, true);
  assert.equal(summary.ultimo_trueno, summary.ultimo.hora);
  assert.equal(describeWx("+TSRAGR"), "tormenta con lluvia y granizo fuerte");
  assert.equal(describeWx("VCTS"), "tormenta en las cercanías");
  assert.equal(describeWx("+SHRA"), "chaparrones fuertes");
  assert.equal(describeWx("-RA BR"), "lluvia débil; neblina");
  const hail = parseMetars([{ obsTime: 1000, rawOb: "METAR SARP 230100Z 05011KT 9999 TSGR SCT012 19/19 Q1011", wxString: "TSGR" }], 2000 * 1000);
  assert.equal(hail.granizo_12h.length, 1);
});

test("Estado del tiempo del SMN y altura del Paraná en Prefectura", () => {
  const now = parseTiepre(fixture("tiepre.txt"));
  assert.deepEqual([now.estado, now.temperatura, now.humedad], ["Nublado con tormenta", 18.8, 98]);
  const river = parsePrefectura(fixture("prefectura.html"));
  assert.equal(river.altura_m, 9.99);
  assert.equal(river.variacion_m, 0.05);
  assert.equal(river.tendencia, "crece");
  assert.equal(river.fecha, "2026-10-22T15:00:00.000Z");
  assert.deepEqual([river.anterior_m, river.alerta_m, river.evacuacion_m], [9.94, 11, 12]);
  assert.equal(parsePrefectura("<tr><th>OTRO</th></tr>"), null);
});

test("rayos: radio, ventana de tiempo y distancia mínima", () => {
  const now = Date.parse("2026-10-23T02:00:00Z");
  const flashes = [
    { t: now - 5 * 60_000, lat: -27.40, lon: -55.90 },
    { t: now - 30 * 60_000, lat: -27.50, lon: -56.00 },
    { t: now - 5 * 60_000, lat: -26.80, lon: -55.00 },
    { t: now - 90 * 60_000, lat: -27.37, lon: -55.90 },
  ];
  const s = summarizeFlashes(flashes, now, 30, "x.nc", 150);
  assert.equal(s.cerca_15min, 1);
  assert.equal(s.cerca_60min, 2);
  assert.equal(s.zona_60min, 3);
  assert.equal(s.mas_cercano_km, 4);
  // Al mapa y al gráfico polar van todos los de la zona.
  assert.equal(s.puntos.length, 3);
  // El más cercano se informa aunque esté fuera del radio cercano.
  const lejos = summarizeFlashes([{ t: now - 2 * 60_000, lat: -27.05, lon: -55.9 }], now, 30, null, 100);
  assert.equal(lejos.cerca_15min, 0);
  assert.equal(lejos.cercano.km, 35);
  assert.equal(directionName(lejos.cercano.rumbo), "norte");
  assert.equal(summarizeFlashes(flashes, now, 30, "x.nc", 100).zona_60min, 2);
  const many = Array.from({ length: 50 }, (_, i) => ({ t: now - i * 1000, lat: -27.37, lon: -55.9 }));
  const capped = summarizeFlashes(many, now, 30, null, 100, 10);
  assert.equal(capped.puntos.length, 10);
  assert.equal(capped.cerca_60min, 50);
});

test("rayos: rumbo y tendencia de la tormenta más cercana", () => {
  assert.equal(directionName(bearingDeg({ lat: POSADAS.lat, lon: POSADAS.lon + 0.5 })), "este");
  assert.equal(directionName(bearingDeg({ lat: POSADAS.lat - 0.5, lon: POSADAS.lon - 0.5 })), "suroeste");
  const now = 10_000_000;
  // Se acerca 5 km cada 10 minutos (30 km/h): de 50 a 35 km.
  const approaching = [35, 25, 15, 5].map((ago, i) => ({ t: now - ago * 60_000, km: 50 - i * 5 }));
  const trend = lightningTrend(approaching, now);
  assert.equal(trend.estado, "se_acerca");
  assert.equal(trend.velocidad_kmh, -30);
  assert.equal(trend.llegada_min, 70);
  const leaving = [35, 25, 15, 5].map((ago, i) => ({ t: now - ago * 60_000, km: 10 + i * 10 }));
  assert.equal(lightningTrend(leaving, now).estado, "se_aleja");
  // Sin rayos en los últimos 20 minutos no se infiere nada.
  const old = [55, 45, 35].map(ago => ({ t: now - ago * 60_000, km: 20 }));
  assert.equal(lightningTrend(old, now).estado, "sin_datos");
});

test("estado principal: prioridad de la alerta oficial y sin afirmaciones no confirmadas", async () => {
  const { heroState, whenText } = await import("../../src/lib/nino-presentation.ts");
  const alert = parseCap(fixture("cap_alerta_posadas.xml"), "a");
  const now = Date.parse("2026-10-23T01:00:00-03:00");
  const source = (datos, estado = "ok", error = null) => ({ estado, datos, actualizado: null, error, fuente: "", url: "" });
  const base = {
    generado: new Date(now).toISOString(),
    alertas: source({ posadas: [alert], cerca: [], total_pais: 1 }),
    metar: source({ ultimo: null, tormenta_ultima_hora: true, granizo_12h: [], reportes_tormenta_12h: 3 }),
    smn_ahora: source(null, "sin_datos"), lluvia: source(null, "sin_datos"),
    rayos: source({ cerca_15min: 5, mas_cercano_km: 8 }), rio: source(null, "sin_datos"),
  };
  let hero = heroState(base, "sin_umbral", true, now);
  assert.equal(hero.tone, "amarilla");
  assert.equal(hero.title, "Alerta amarilla por tormentas");
  assert.match(hero.detail, /hasta mañana a las 14:59/);
  assert.equal(whenText(alert.fin, Date.parse("2026-10-22T23:00:00-03:00")), "el sábado 24 a las 14:59");
  // Alertas todavía sin respuesta y tormenta en curso: no se afirma que no haya alerta.
  hero = heroState({ ...base, alertas: source(null, "sin_datos") }, "sin_umbral", true, now);
  assert.equal(hero.tone, "tormenta");
  assert.match(hero.detail, /Todavía no pudimos confirmar/);
  // Sin tormenta y alertas sin respuesta: "consultando", no "no pudimos".
  const calm = { ...base, metar: source({ ultimo: null, tormenta_ultima_hora: false, granizo_12h: [], reportes_tormenta_12h: 0 }), rayos: source({ cerca_15min: 0 }) };
  assert.match(heroState({ ...calm, alertas: source(null, "sin_datos") }, "sin_umbral", true, now).title, /Consultando/);
  assert.match(heroState({ ...calm, alertas: source(null, "sin_datos", "timeout") }, "sin_umbral", true, now).title, /No pudimos/);
  // Sin alertas: el pronóstico propio solo habla si supera un nivel.
  const none = { ...calm, alertas: source({ posadas: [], cerca: [], total_pais: 0 }) };
  assert.equal(heroState(none, "atencion", true, now).tone, "lluvia");
  assert.equal(heroState(none, "atencion", false, now).tone, "calma");
  assert.equal(heroState(none, "sin_umbral", true, now).title, "Sin alertas para Posadas");
  assert.equal(whenText("2026-10-23T09:00:00-03:00", now), "hoy a las 09:00");
  // Archivos CAP sin leer (límite del SMN) o alertas viejas: nunca "Sin alertas".
  const partial = { ...none, alertas: source({ posadas: [], cerca: [], total_pais: 40, pendientes: 3 }) };
  assert.match(heroState(partial, "sin_umbral", true, now).title, /No pudimos revisar todas/);
  assert.match(heroState({ ...partial, rayos: source({ cerca_15min: 2, mas_cercano_km: 5 }) }, "sin_umbral", true, now).detail, /Todavía no pudimos confirmar/);
  const stale = { ...none, alertas: source({ posadas: [], cerca: [], total_pais: 0, pendientes: 0 }, "desactualizado") };
  assert.notEqual(heroState(stale, "sin_umbral", true, now).tone, "calma");
});

test("escurrimiento SCS: valores de referencia y condición antecedente", async () => {
  const m = await import("../../src/lib/nino-escurrimiento.ts");
  // CN 80, P 50 mm: S = 63,5 mm, Ia = 12,7 mm, Q = 37,3² / 100,8 = 13,8 mm.
  assert.equal(Math.round(m.scsRunoff(50, 80) * 10) / 10, 13.8);
  assert.equal(m.scsRunoff(10, 80), 0);
  assert.equal(m.scsRunoff(0, 90), 0);
  assert.equal(Math.round(m.adjustCn(80, "I") * 10) / 10, 62.7);
  assert.equal(Math.round(m.adjustCn(80, "III") * 10) / 10, 90.2);
  assert.equal(m.amcFromAntecedent(20), "I");
  assert.equal(m.amcFromAntecedent(35.6), "II");
  assert.equal(m.amcFromAntecedent(91), "III");
  assert.equal(m.amcFromAntecedent(null), null);
  const b = { poligono_id: "x", nombre: "X", area_m2: 1_000_000, cn_ii_min: 70, cn_ii_max: 90 };
  const r = m.barrioRunoff(b, 50, "III");
  assert.ok(r.mm[0] < r.mm[1] && r.porcentaje[1] <= 100);
  assert.equal(r.m3[1], Math.round(r.mm[1] / 1000 * 1_000_000));
  // Suelo saturado: más escurrimiento con la misma lluvia.
  assert.ok(m.barrioRunoff(b, 50, "III").mm[0] > m.barrioRunoff(b, 50, "I").mm[0]);
});

test("frecuencia empírica de lluvias", async () => {
  const m = await import("../../src/lib/nino-escurrimiento.ts");
  const values = [120, 90, 80, 75, 60, 55, 52, 50, 40, 30];
  assert.equal(m.frequencyText(75, values, 4), "Pasa más o menos una vez por año");
  assert.equal(m.frequencyText(100, values, 10), "Pasa en promedio una vez cada 10 años");
  assert.equal(m.frequencyText(50, values, 2), "Pasa unas 4 veces por año");
  assert.equal(m.frequencyText(200, values, 20), "No pasó en los 20 años con registro completo");
});

test("granizo en las próximas 12 horas: consenso de al menos dos modelos", async () => {
  const { hailNext } = await import("../../src/lib/nino-presentation.ts");
  const now = Date.parse("2026-10-23T10:30:00-03:00");
  // Horas locales de Open-Meteo: 10:00 a 23:00 del 23/10.
  const serie = peak => ({ nombre: "x", horas: Array.from({ length: 14 }, (_, i) => ({ time: `2026-10-23T${String(10 + i).padStart(2, "0")}:00`, ship: i === 6 ? peak : 0.1 })) });
  const hail = modelos => ({ generated_at: "", estado: "disponible", cortes: { moderado: 0.5, alto: 1 }, modelos, dias: [] });
  // GFS 0,57, ECMWF 0,97 e ICON 0,09 (23/10): dos modelos llegan a moderado.
  assert.deepEqual(hailNext(hail({ gfs: serie(0.57), ecmwf: serie(0.97), icon: serie(0.09) }), now), { nivel: "moderado", modelos: 3 });
  // Un solo modelo en alto no alcanza: queda el nivel que comparten dos.
  assert.equal(hailNext(hail({ gfs: serie(1.4), ecmwf: serie(0.2), icon: serie(0.1) }), now).nivel, "bajo");
  assert.equal(hailNext(hail({ gfs: serie(1.4), ecmwf: serie(1.1), icon: serie(0.1) }), now).nivel, "alto");
  // El pico de las 16:00 queda fuera de una ventana de 3 horas.
  assert.equal(hailNext(hail({ gfs: serie(1.4), ecmwf: serie(1.1) }), now, 3).nivel, "bajo");
  // Pronóstico vencido o sin modelos: sin dato, nunca "bajo".
  assert.deepEqual(hailNext(hail({ gfs: serie(1.4) }), Date.parse("2026-10-25T10:00:00-03:00")), { nivel: null, modelos: 0 });
  assert.deepEqual(hailNext(null, now), { nivel: null, modelos: 0 });
});

test("rayo más cercano a la persona, no al centro", () => {
  const chacra32 = { lat: -27.3988, lon: -55.9063 };
  // Un rayo sobre la Chacra 32 hace 3 min, otro sobre el centro hace 2 min y uno viejo encima.
  const points = [[-27.399, -55.906, 3], [POSADAS.lat, POSADAS.lon, 2], [-27.3988, -55.9063, 40]];
  const mine = nearestLightning(points, chacra32);
  assert.equal(mine.km, 0);
  assert.equal(mine.hace_min, 3);
  // Desde el centro, el más cercano es el que cayó encima del centro.
  assert.equal(nearestLightning(points, POSADAS).hace_min, 2);
  // Solo cuentan los últimos 15 minutos: sin rayos recientes no hay "más cercano".
  assert.equal(nearestLightning([[-27.3988, -55.9063, 40]], chacra32), null);
  // El rumbo va desde la persona: un rayo al norte de la Chacra 32 está al norte.
  assert.equal(directionName(nearestLightning([[-27.30, -55.9063, 1]], chacra32).rumbo), "norte");
});
