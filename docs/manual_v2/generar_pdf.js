// Arma el manual en dos partes y las une:
//  · portada.html  -> a sangre completa, sin encabezado ni pie
//  · manual.html   -> con márgenes, encabezado y numeración de página
// El impresor del manual: portada a sangre + cuerpo con encabezado y pie.
// Lo llama docs/manual_v2/armar.py, que ademas hace las dos pasadas que
// necesita el indice numerado.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Relativo a este archivo: el impresor tiene que servir en cualquier
// clon del repositorio, no solo en la maquina donde se escribio.
const BASE = path.resolve(__dirname, '..').split(path.sep).join('/') + '/';
const TMP = BASE + 'manual_v2/_build/';

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const browser = await chromium.launch();

  // ── portada ──
  let page = await browser.newPage();
  await page.goto('file:///' + BASE + 'manual_v2/portada.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  await page.pdf({ path: TMP + '_portada.pdf', width: '210mm', height: '297mm',
                   printBackground: true, margin: { top:0, bottom:0, left:0, right:0 } });
  await page.close();
  console.log('  ✓ portada');

  // ── cuerpo ──
  page = await browser.newPage();
  await page.goto('file:///' + BASE + 'manual_v2/manual.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  await page.pdf({
    path: TMP + '_cuerpo.pdf',
    format: 'A4', printBackground: true, displayHeaderFooter: true,
    margin: { top: '19mm', bottom: '17mm', left: '16mm', right: '16mm' },
    headerTemplate: `<div style="width:100%;font-family:Barlow,Segoe UI,sans-serif;font-size:7pt;
        letter-spacing:.09em;text-transform:uppercase;color:#8A99AC;padding:0 16mm;
        display:flex;justify-content:space-between;">
        <span>CuentaVoz · Manual de usuario</span><span>Colsubsidio</span></div>`,
    footerTemplate: `<div style="width:100%;font-family:Barlow,Segoe UI,sans-serif;font-size:7.5pt;
        color:#8A99AC;padding:0 16mm;display:flex;justify-content:space-between;">
        <span>Versión 2.0 · Agosto 2026</span>
        <span style="font-variant-numeric:tabular-nums;">
          <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  await page.close();
  console.log('  ✓ cuerpo');

  await browser.close();
})().catch(e => { console.error('FALLO', e); process.exit(1); });
