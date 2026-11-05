const { chromium } = require('playwright');
const OUT = process.env.SCR + '/ui';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/tile.openstreetmap.org/**', (r) => r.abort());
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + e.message));
  const results = {};

  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Stored analyses' }).waitFor();
  // load the stored synthetic run
  await page.getByRole('button', { name: 'Load' }).first().click();
  await page.getByText('Non-GBIF data').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  results.nonGbifBanner = await page.getByText('Non-GBIF data').count();
  results.kpiUsable = await page.locator('text=Usable records').count();
  await page.screenshot({ path: OUT + '/01-overview.png', fullPage: false });

  // Species explorer: quality audit visible
  await page.getByRole('button', { name: 'Species Explorer' }).click();
  await page.getByRole('heading', { name: 'Occurrence quality audit' }).waitFor();
  await page.waitForFunction(() => document.querySelector('#panel-quality')?.innerText.includes('CLEAN'), null, { timeout: 30000 });
  results.qualityClean = (await page.locator('section#panel-quality').innerText()).toLowerCase().includes('clean');
  await page.screenshot({ path: OUT + '/02-species-quality.png', fullPage: true });

  // Failure path: resolve species while GBIF is unreachable
  await page.fill('#species', 'Withania somnifera');
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  const alert1 = page.locator('div[role=alert]:not([id=__next-route-announcer__])');
  await alert1.waitFor({ timeout: 60000 });
  results.resolveFailure = (await alert1.innerText()).slice(0, 160);
  await page.screenshot({ path: OUT + '/03-gbif-unreachable.png', fullPage: false });

  // Failure path: run analysis
  await page.getByRole('button', { name: 'Run analysis against GBIF' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('div[role=alert]')].some(e => /GBIF|unreachable/i.test(e.innerText)), null, { timeout: 120000 });
  results.runFailure = (await page.locator('div[role=alert]:not([id=__next-route-announcer__])').first().innerText()).slice(0, 160);

  // Invalid bbox is rejected client-side
  await page.locator('input[aria-label="min lat"]').fill('20');
  results.bboxError = await page.getByText('Use min < max').count();
  await page.locator('input[aria-label="min lat"]').fill('8.1');

  // Spatial intelligence: benchmarks
  await page.getByRole('button', { name: 'Spatial Intelligence' }).click();
  await page.getByRole('button', { name: 'Run benchmarks' }).click();
  await page.getByRole('table', { name: 'Withheld-observation results' }).waitFor({ timeout: 180000 });
  results.benchRows = await page.locator('table[aria-label], table').nth(0).locator('tbody tr').count();
  results.benchTable = (await page.getByRole('table', { name: 'Withheld-observation results' }).innerText()).slice(0, 400);
  await page.locator('#panel-benchmark').screenshot({ path: OUT + '/04-benchmark.png' });

  // Planner: tick two candidates then simulate
  await page.getByRole('button', { name: 'Survey Planner' }).click();
  await page.getByLabel(/Plan survey of cell/).nth(0).check();
  await page.getByLabel(/Plan survey of cell/).nth(1).check();
  await page.getByRole('button', { name: /Simulate 2 planned cells/ }).click();
  await page.getByRole('table', { name: 'Expected outcomes by occupancy assumption' }).waitFor({ timeout: 60000 });
  results.simRows = await page.getByRole('table', { name: 'Expected outcomes by occupancy assumption' }).locator('tbody tr').count();
  await page.locator('#panel-planner').screenshot({ path: OUT + '/05-planner.png' });

  // Map click selects a cell and opens the planner explanation
  await page.getByRole('button', { name: 'Evidence & Reports' }).click();
  await page.getByRole('heading', { name: 'Analysis report' }).waitFor();
  await page.waitForFunction(() => { const p = document.querySelector('#panel-report pre'); return p && p.innerText.includes('Warnings and limitations'); }, null, { timeout: 30000 });
  results.reportHasLimits = true;
  results.exportLinks = await page.locator('#panel-exports a').count();
  await page.screenshot({ path: OUT + '/06-evidence.png', fullPage: true });

  // Phone layout
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await phone.route('**/tile.openstreetmap.org/**', (r) => r.abort());
  await phone.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await phone.getByRole('heading', { name: 'Stored analyses' }).waitFor();
  results.phoneOverflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await phone.screenshot({ path: OUT + '/07-phone.png', fullPage: false });

  const canvasStats = await page.evaluate(() => {
    const c = document.querySelector('.maplibregl-canvas');
    if (!c) return null;
    const ctx = c.getContext('webgl2') || c.getContext('webgl');
    if (!ctx) return { webgl: false };
    const px = new Uint8Array(4 * 16);
    const w = c.width, h = c.height;
    const sample = [];
    for (const [fx, fy] of [[0.5,0.5],[0.3,0.4],[0.7,0.6],[0.45,0.55]]) {
      ctx.readPixels(Math.floor(w*fx), Math.floor(h*fy), 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px.subarray(0,4));
      sample.push([px[0], px[1], px[2], px[3]]);
    }
    return { width: w, height: h, samples: sample };
  });
  results.mapCanvas = canvasStats;
  results.consoleErrors = consoleErrors.filter((e) => !/tile\.openstreetmap|ERR_|Failed to load resource|403/.test(e)).slice(0, 10);
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
