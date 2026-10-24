// Verificación de la interfaz: interacción real en Chrome y fixtures solo locales.
const { chromium, expect } = require('../webapp/frontend/node_modules/@playwright/test');
const ts = require('../webapp/frontend/node_modules/typescript');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const base = process.env.NINO_BASE_URL || 'http://localhost:3127';
const readOnly = process.env.NINO_READ_ONLY === '1';
if (!readOnly && !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) {
  throw new Error('Los fixtures solo se ejecutan contra localhost; usá NINO_READ_ONLY=1 para producción.');
}
const output = process.env.NINO_OUTPUT_DIR || path.resolve(__dirname, '../docs/capturas-nino-claro');
const snapshotPath = path.resolve(__dirname, '../webapp/frontend/public/data/nino/estado.json');
const original = readOnly ? null : fs.readFileSync(snapshotPath);
const checks = [];
fs.mkdirSync(output, { recursive: true });

// Probar las funciones reales de presentación sin agregar un runtime de tests.
const moduleObject = { exports: {} };
const helperPath = path.resolve(__dirname, '../webapp/frontend/src/lib/nino-presentation.ts');
const compiled = ts.transpileModule(fs.readFileSync(helperPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
new Function('exports', compiled)(moduleObject.exports);
assert.equal(moduleObject.exports.formatRain(0.01), 'menos de 0,1');
assert.equal(moduleObject.exports.formatRain(0), '0');
assert.equal(moduleObject.exports.formatRain(null), 'Sin datos');
assert.equal(moduleObject.exports.normalizeBarrio('  Itaembé Miní '), 'itaembe mini');
checks.push('Cantidades pequeñas, cero y dato ausente se distinguen; búsqueda sin tildes.');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const load = async () => {
    const response = await page.goto(base + '/nino', { waitUntil: 'domcontentloaded', timeout: 60000 });
    assert.equal(response.status(), 200);
    await page.locator('.maplibregl-map').waitFor({ timeout: 60000 });
    await expect(page.getByText('Datos a verificar', { exact: true })).toHaveCount(0);
  };
  // El detalle hora por hora vive en un desplegable de "Lo que viene".
  const openHourly = async () => {
    const details = page.locator('#lluvia details').filter({ hasText: 'Ver hora por hora' });
    if ((await details.getAttribute('open')) === null) await details.locator('summary').first().click();
  };
  try {
    await load();
    await expect(page.locator('#nino-barrio-list > li')).toHaveCount(8);
    await page.getByRole('button', { name: /^Ver más barrios/ }).click();
    await expect(page.locator('#nino-barrio-list > li')).toHaveCount(16);
    await page.getByLabel('Nombre del barrio', { exact: true }).fill('itaembe mini');
    await expect(page.locator('[data-barrio="itaembe_mini"]')).toBeVisible();
    await expect(page.locator('#nino-barrio-list')).toContainText('Itaembé Miní');
    await page.locator('[data-barrio="itaembe_mini"]').getByRole('link', { name: 'Ver en el mapa' }).click();
    // El barrio elegido aparece en la ficha debajo del mapa y en el simulador.
    await expect(page.locator('#mapa')).toContainText('Itaembé Miní');
    await expect(page.locator('#sim-barrio')).toHaveValue('itaembe_mini');
    // Filtros del mapa: cada capa se prende y se apaga con su propia leyenda.
    const water = page.getByRole('button', { name: 'Arroyos y zonas bajas', exact: true });
    const runoff = page.getByRole('button', { name: 'Cuánto escurre', exact: true });
    await expect(water).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#mapa')).toContainText('Zonas bajas o cerca de arroyos');
    await runoff.click();
    await expect(runoff).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#mapa')).toContainText('Escurre con');
    await water.click();
    await expect(page.locator('#mapa')).not.toContainText('Zonas bajas o cerca de arroyos');
    await water.click();
    await runoff.click();
    // Anegamientos: caminos del agua y obras del municipio, con su explicación y validación.
    const flooding = page.getByRole('button', { name: 'Anegamientos', exact: true });
    await expect(flooding).toHaveAttribute('aria-pressed', 'false');
    await flooding.click();
    await expect(page.locator('#mapa')).toContainText('Por dónde baja el agua en una tormenta');
    await expect(page.locator('#mapa')).toContainText('No hay un registro público de dónde se anega Posadas');
    await expect(page.locator('#mapa')).toContainText(/de las obras de desagüe que hizo el municipio/);
    await flooding.click();
    await expect(page.locator('#mapa')).not.toContainText('Por dónde baja el agua en una tormenta');
    checks.push('Buscar sin tildes, mostrar más, localizar barrio en mapa y simulador, y prender o apagar capas.');

    await page.getByLabel('Nombre del barrio', { exact: true }).fill('Villa Mola');
    await expect(page.locator('#nino-barrio-list')).toContainText('Sin estimación');
    await expect(page.locator('#nino-barrio-list')).toContainText('Faltan datos de población.');
    await page.getByLabel('Nombre del barrio', { exact: true }).fill('zzzzzz');
    await expect(page.getByText('No encontramos barrios con ese nombre.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ver todos los barrios', exact: true }).click();
    await expect(page.locator('#nino-barrio-list > li')).toHaveCount(8);
    await page.getByLabel('Ordenar barrios', { exact: true }).selectOption('nombre');
    const names = await page.locator('#nino-barrio-list h3').allTextContents();
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'es')));
    checks.push('Población faltante explícita, búsqueda vacía recuperable y orden alfabético.');

    // Datos en vivo de fuentes oficiales: estado, lluvia medida, río, fuentes y API.
    await expect(page.locator('#ahora h2')).not.toHaveText('');
    await expect(page.locator('#lo-que-llovio').getByRole('button', { name: '24 horas', exact: true })).toBeVisible();
    await expect(page.locator('#rio')).toBeVisible();
    await expect(page.locator('#fuentes [aria-label="Estado de cada fuente"] > li')).toHaveCount(12);
    const lightningFilter = page.getByRole('button', { name: /^Rayos( · hay cerca)?$/ });
    await expect(page.locator('#mapa').getByText(/Rayos hace:/)).toHaveCount(0);
    await lightningFilter.click();
    await expect(page.locator('#mapa').getByText(/Rayos hace:/)).toHaveCount(1);
    await lightningFilter.click();
    // Simulador: una frase con diez gotas que cambia con la lluvia y con el barrio,
    // y el botón que lleva al mapa con los caminos del agua.
    const slider = page.locator('#sim-mm');
    await slider.fill('100');
    const answer = page.locator('#simulador').getByText(/de cada 10 litros van a la calle/).first();
    const heavy = await answer.textContent();
    await expect(page.locator('#simulador [data-kind="calle"]').first()).toBeVisible();
    await slider.fill('10');
    assert.notEqual(await answer.textContent(), heavy);
    await expect(page.locator('#simulador')).toContainText('tanques de 1.000 litros');
    await page.locator('#sim-barrio').selectOption('');
    await expect(page.locator('#simulador')).not.toContainText('entre los barrios que');
    await page.locator('#simulador').getByRole('button', { name: 'Ver en el mapa por dónde baja el agua' }).click();
    await expect(page.getByRole('button', { name: 'Anegamientos', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Anegamientos', exact: true }).click();
    await expect(page.locator('#rayos svg[role="img"]')).toBeVisible();
    // Las distancias dicen desde dónde se miden y nunca "0 km".
    await expect(page.locator('#rayos')).toContainText(/desde el centro de Posadas|Sin datos del satélite/);
    await expect(page.locator('#rayos')).not.toContainText(/\b0 km\b/);
    await expect(page.locator('#ahora a[href="#rayos"]')).not.toContainText(/A 0 km/);
    const api = await page.request.get(base + '/api/nino/ahora');
    assert.equal(api.status(), 200);
    const live = await api.json();
    for (const key of ['alertas', 'metar', 'smn_ahora', 'lluvia', 'rayos', 'rio']) assert.ok(['ok', 'desactualizado', 'sin_datos'].includes(live[key].estado), key);
    checks.push({ prueba: 'Datos en vivo y API', estados: Object.fromEntries(['alertas', 'metar', 'smn_ahora', 'lluvia', 'rayos', 'rio'].map(k => [k, live[k].estado])) });

    await openHourly();
    const chart = page.getByRole('img', { name: /^Lluvia estimada por hora/ });
    const adaptiveScale = await chart.getAttribute('aria-label');
    await page.getByRole('button', { name: 'Comparar niveles', exact: true }).click();
    const comparisonScale = await chart.getAttribute('aria-label');
    assert.notEqual(adaptiveScale, comparisonScale);
    await expect(page.locator('#lluvia')).toContainText('Atención: 20 mm');
    await page.getByRole('button', { name: 'Ver lluvia prevista', exact: true }).click();
    await expect(chart).toHaveAttribute('aria-label', adaptiveScale);
    checks.push({ prueba: 'Escala adaptativa y comparación con los límites', adaptiveScale, comparisonScale });

    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.locator('#lluvia').screenshot({ path: path.join(output, 'lluvia.png') });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(metrics.content <= metrics.viewport, JSON.stringify(metrics));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('Nombre del barrio', { exact: true }).fill('Villa Urquiza');
    await page.locator('#barrios').screenshot({ path: path.join(output, 'barrio-mobile.png') });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: false });
    await expect(page.getByRole('link', { name: 'Llamar 103', exact: true })).toBeVisible();
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: path.join(output, 'mobile-dark.png'), fullPage: false });
    await page.locator('#lluvia').screenshot({ path: path.join(output, 'lluvia-dark.png') });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    checks.push('320/390/768/1440 px sin desborde; modo oscuro, unidad mm y 103 visibles.');

    if (!readOnly) {
      const fixture = JSON.parse(original);
      fixture.generated_at = new Date().toISOString();
      fixture.lluvia.nivel = 'alto';
      fixture.lluvia.lluvia_max_1h = 40;
      fixture.lluvia.lluvia_24h = 80;
      fixture.lluvia.horas[0] = { ...fixture.lluvia.horas[0], p10: 20, p50: 40, p90: 70 };
      fs.writeFileSync(snapshotPath, JSON.stringify(fixture));
      await load();
      await expect(page.getByText('Se prevén lluvias fuertes', { exact: true }).first()).toBeVisible();
      await openHourly();
      assert.ok(!(await chart.getAttribute('aria-label')).includes('Escala de 0 a 1 milímetros'));
      checks.push('Fixture local con lluvia fuerte: mensaje y escala reflejan valores altos.');

      fixture.lluvia.horas = [];
      fs.writeFileSync(snapshotPath, JSON.stringify(fixture));
      await load();
      await openHourly();
      await expect(page.getByText('No hay datos horarios suficientes para dibujar el gráfico.', { exact: true })).toBeVisible();
      fixture.generated_at = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
      fs.writeFileSync(snapshotPath, JSON.stringify(fixture));
      await page.reload({ waitUntil: 'domcontentloaded' });
      // El mapa solo existe tras hidratar: recién ahí los botones responden.
      await page.locator('.maplibregl-map').waitFor({ timeout: 60000 });
      await expect(page.getByRole('alert').filter({ hasText: 'Datos de pronóstico desactualizados' })).toBeVisible();
      await expect(page.getByText('Datos a verificar', { exact: true })).toBeVisible();
      await expect(page.locator('#nino-barrio-list').getByText('Sin pronóstico vigente').first()).toBeVisible();
      checks.push('Sin serie no se dibuja un gráfico ficticio; dato vencido oculta niveles y marca mapa sin pronóstico.');

      fs.writeFileSync(snapshotPath, 'null');
      await page.reload({ waitUntil: 'domcontentloaded' });
      // El mapa solo existe tras hidratar: recién ahí los botones responden.
      await page.locator('.maplibregl-map').waitFor({ timeout: 60000 });
      await expect(page.getByText('Datos a verificar', { exact: true })).toBeVisible();
      await expect(page.locator('#nino-barrio-list > li')).toHaveCount(0);
      checks.push('Snapshot ausente: mensaje explícito, sin cifras ni niveles inventados.');
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'claridad-verificacion.json'), JSON.stringify({ checked_at: new Date().toISOString(), base, readOnly, checks, errors }, null, 2));
    console.log(JSON.stringify({ checks, errors }, null, 2));
  } finally {
    if (original) fs.writeFileSync(snapshotPath, original);
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
