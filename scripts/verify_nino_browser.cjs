// Ejecutar con servidor local en 3127. Usa Chrome instalado, no descarga navegadores.
const { chromium } = require('../webapp/frontend/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const base = process.env.NINO_BASE_URL || 'http://localhost:3127';
  const output = process.env.NINO_OUTPUT_DIR || path.resolve(__dirname, '../docs/capturas-nino');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`${page.url()}: ${e.message}`));
  const checks = [];
  try {
    for (const route of ['/nino', '/', '/pronostico', '/pronostico/riesgos', '/datos/metodologia', '/poligono/villa_urquiza']) {
      const response = await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (response.status() !== 200) throw new Error(`${route}: HTTP ${response.status()}`);
      checks.push({ route, status: response.status(), h1: await page.locator('h1').first().innerText() });
    }
    await page.goto(base + '/nino', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Sala de situación El Niño', exact: true }).waitFor();
    await page.locator('.leaflet-container').waitFor();
    if (!await page.getByRole('link', { name: '103', exact: true }).isVisible()) throw new Error('103 no visible');
    await page.getByRole('button', { name: /^Barrio/ }).click();
    await page.screenshot({ path: path.join(output, 'nino-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'nino-mobile.png'), fullPage: true });
    const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
    if (overflow.scroll > overflow.viewport) throw new Error(`Desborde horizontal: ${JSON.stringify(overflow)}`);
    checks.push({ viewport: '390x844', overflow: false });
    await page.clock.install();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Sala de situación El Niño', exact: true }).waitFor();
    await page.clock.fastForward(25 * 3600 * 1000);
    await page.getByRole('alert').filter({ hasText: 'Datos de pronóstico desactualizados' }).waitFor();
    if (!await page.getByText('Datos a verificar', { exact: true }).isVisible()) throw new Error('Nivel vigente visible con dato vencido');
    checks.push({ test: 'vencimiento en pestaña abierta tras 25 h', passed: true });
    const og = await context.request.get(base + '/nino/opengraph-image');
    if (og.status() !== 200 || !og.headers()['content-type'].includes('image/png')) throw new Error(`OG falló ${og.status()}`);
    fs.writeFileSync(path.join(output, 'nino-og.png'), await og.body());
    checks.push({ route: '/nino/opengraph-image', status: og.status() });
    if (errors.length) throw new Error(errors.join('\n'));
    fs.writeFileSync(path.join(output, 'verificacion.json'), JSON.stringify({ checked_at: new Date().toISOString(), base, checks, errors }, null, 2));
    console.log(JSON.stringify({ checks, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
