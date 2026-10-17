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
    await page.locator('.leaflet-container').waitFor();
    await expect(page.getByText('Datos a verificar', { exact: true })).toHaveCount(0);
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
    await expect(page.getByLabel('Acercar a un barrio', { exact: true })).toHaveValue('itaembe_mini');
    const blueZones = page.locator('.leaflet-overlay-pane path[fill="#38a3cd"]');
    assert.ok(await blueZones.count() > 0);
    await page.getByRole('button', { name: 'Impacto con la lluvia', exact: true }).click();
    await expect(blueZones).toHaveCount(0);
    await page.getByRole('button', { name: 'Zonas expuestas', exact: true }).click();
    assert.ok(await blueZones.count() > 0);
    checks.push('Buscar sin tildes, mostrar más, localizar barrio y separar las dos capas del mapa.');

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
      await expect(page.getByText('Se prevén lluvias fuertes', { exact: true })).toBeVisible();
      assert.ok(!(await chart.getAttribute('aria-label')).includes('Escala de 0 a 1 milímetros'));
      checks.push('Fixture local con lluvia fuerte: mensaje y escala reflejan valores altos.');

      fixture.lluvia.horas = [];
      fs.writeFileSync(snapshotPath, JSON.stringify(fixture));
      await load();
      await expect(page.getByText('No hay datos horarios suficientes para dibujar el gráfico.', { exact: true })).toBeVisible();
      fixture.generated_at = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
      fs.writeFileSync(snapshotPath, JSON.stringify(fixture));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('alert').filter({ hasText: 'Datos de pronóstico desactualizados' })).toBeVisible();
      await expect(page.getByText('Datos a verificar', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Impacto con la lluvia', exact: true }).click();
      await expect(page.getByText('Sin pronóstico vigente: los barrios aparecen en gris. Eso no significa que no haya riesgo.', { exact: true })).toBeVisible();
      checks.push('Sin serie no se dibuja un gráfico ficticio; dato vencido oculta niveles y marca mapa sin pronóstico.');

      fs.writeFileSync(snapshotPath, 'null');
      await page.reload({ waitUntil: 'domcontentloaded' });
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
