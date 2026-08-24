// Mismo pipeline que el manual de usuario: portada a sangre y cuerpo con
// encabezado, margenes y numeracion. Asi los dos PDF salen gemelos.
// Uso: node docs/guia_tecnica/generar_pdf.js
// Deja _build/_g_portada.pdf y _build/_g_cuerpo.pdf; unirlos es el ultimo
// paso (ver armar.py) para obtener docs/Guia_Tecnica_CuentaVoz_V5.pdf.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Rutas relativas a este archivo: el script tiene que servir en
// cualquier clon del repositorio, no solo en la maquina donde se escribio.
const BASE = path.join(__dirname, path.sep).replace(/\\/g, '/');
const TMP = path.join(__dirname, '_build') + path.sep;
fs.mkdirSync(TMP, { recursive: true });

(async () => {
  const browser = await chromium.launch();

  let page = await browser.newPage();
  await page.goto('file:///' + BASE + 'portada.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  await page.pdf({ path: TMP + '_g_portada.pdf', width: '210mm', height: '297mm',
                   printBackground: true, margin: { top:0, bottom:0, left:0, right:0 } });
  await page.close();
  console.log('  ✓ portada');

  page = await browser.newPage();
  await page.goto('file:///' + BASE + 'guia.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  await page.pdf({
    path: TMP + '_g_cuerpo.pdf',
    format: 'A4', printBackground: true, displayHeaderFooter: true,
    margin: { top: '19mm', bottom: '17mm', left: '16mm', right: '16mm' },
    headerTemplate: `<div style="width:100%;font-family:Barlow,Segoe UI,sans-serif;font-size:7pt;
        letter-spacing:.09em;text-transform:uppercase;color:#8A99AC;padding:0 16mm;
        display:flex;justify-content:space-between;">
        <span>CuentaVoz · Guía técnica</span><span>Colsubsidio</span></div>`,
    footerTemplate: `<div style="width:100%;font-family:Barlow,Segoe UI,sans-serif;font-size:7.5pt;
        color:#8A99AC;padding:0 16mm;display:flex;justify-content:space-between;">
        <span>Versión 5.0 · Agosto 2026</span>
        <span style="font-variant-numeric:tabular-nums;">
          <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  await page.close();
  console.log('  ✓ cuerpo');
  await browser.close();
})().catch(e => { console.error('FALLO', e); process.exit(1); });
