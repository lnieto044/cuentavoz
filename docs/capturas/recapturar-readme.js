// Las imagenes fijas del README: el panel de portada y las tres del
// celular. Los tres GIF del recorrido van aparte (grabar_readme_gif.js).
const { chromium } = require('playwright');
const path = require('path');
const APP = process.env.CV_URL || 'http://localhost:5183';
const RAIZ = 'c:/Users/Usuario/Documents/CuentaVoz/docs/capturas/';

async function entrar(page, usuario) {
  for (let i = 1; i <= 4; i++) {
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.evaluate(() => { try { localStorage.clear(); for (let k=1;k<=12;k++) localStorage.setItem('cv_tutorial_deshabilitado_'+k,'1'); } catch(_){} });
    await page.goto(APP, { waitUntil: 'networkidle' });
    const inp = await page.locator('.ingreso input').all();
    await inp[0].fill(usuario); await inp[1].fill('StockXperts1');
    await page.click('button:has-text("ENTRAR")');
    try {
      await page.locator('.sidebar').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(1200);
      for (const b of await page.locator('.modal button:has-text("Cerrar")').all()) await b.click().catch(()=>{});
      return;
    } catch (_) { console.log('    (reintento', i, ')'); }
  }
  throw new Error('no entro: ' + usuario);
}

async function recortado(page, destino) {
  const alto = await page.evaluate(() => {
    const c = document.querySelector('.contenido') || document.body;
    let max = 0;
    c.querySelectorAll('*').forEach((n) => { const r = n.getBoundingClientRect();
      if (r.height>0 && r.width>0 && r.bottom>max) max = r.bottom; });
    return Math.max(360, Math.min(Math.ceil(max+28), window.innerHeight));
  }).catch(() => null);
  const vp = page.viewportSize();
  const clip = alto ? { clip: { x:0, y:0, width: vp.width, height: alto } } : {};
  await page.screenshot(Object.assign({ path: destino }, clip));
}

(async () => {
  const browser = await chromium.launch();

  // ── portada del README: el Panel, ancho ──
  console.log('Portada:');
  let ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  let p = await ctx.newPage();
  await entrar(p, 'diana');
  await p.click('.sidebar >> text=Panel');
  await p.waitForTimeout(3000);
  await recortado(p, RAIZ + 'panel-principal.png');
  console.log('  ✓ panel-principal');
  await p.close();

  // ── celular ──
  console.log('Celular:');
  ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  p = await ctx.newPage();
  await entrar(p, 'stephanie');
  for (const [menu, nombre] of [['Inicio','inicio'], ['Bodegas','bodegas'], ['Pedidos','pedidos']]) {
    await p.click('.sidebar >> text=' + menu).catch(async () => {
      // en movil la barra puede estar plegada tras un boton
      const abrir = p.locator('button[aria-label*="menú"], .abrir-menu').first();
      if (await abrir.count()) { await abrir.click(); await p.waitForTimeout(500); await p.click('.sidebar >> text=' + menu); }
    });
    await p.waitForTimeout(2200);
    await recortado(p, RAIZ + 'movil/' + nombre + '.png');
    console.log('  ✓ movil/' + nombre);
  }
  await p.close();

  await browser.close();
  console.log('listo');
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
