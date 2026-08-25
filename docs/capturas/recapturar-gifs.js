// Los GIF del README no son video: son una presentacion de una imagen por
// pantalla, a 0,62 cuadros por segundo (~1,6 s cada una). Asi salen
// nitidos y pesan una fraccion de lo que pesaria un video.
//
// Aqui se toman los fotogramas, todos del MISMO tamaño (un GIF no admite
// fotogramas de distinto tamaño, asi que no se recorta al alto del
// contenido como en las capturas sueltas).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = process.env.CV_URL || 'http://localhost:5183';
const SALIDA = path.join(__dirname, '_cuadros');   // intermedios, no se versiona

const MENU_ADMIN = ['Inicio', 'Pedidos', 'Conteo', 'Legalización', 'Bodegas',
                    'Auditoría', 'Reportes', 'Panel', 'Ajustes', 'Ayuda',
                    'Mensajes', 'Mi perfil'];
const MENU_MOVIL = ['Inicio', 'Pedidos', 'Conteo', 'Legalización',
                    'Bodegas', 'Ayuda', 'Mensajes', 'Mi perfil'];

async function entrar(page, usuario) {
  for (let i = 1; i <= 4; i++) {
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      try {
        localStorage.clear();
        for (let k = 1; k <= 12; k++) localStorage.setItem('cv_tutorial_deshabilitado_' + k, '1');
      } catch (_) {}
    });
    await page.goto(APP, { waitUntil: 'networkidle' });
    const inp = await page.locator('.ingreso input').all();
    await inp[0].fill(usuario);
    await inp[1].fill('StockXperts1');
    await page.click('button:has-text("ENTRAR")');
    try {
      await page.locator('.sidebar').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(1400);
      for (const b of await page.locator('.modal button:has-text("Cerrar")').all()) {
        await b.click().catch(() => {});
      }
      return;
    } catch (_) { console.log('    (reintento', i, ')'); }
  }
  throw new Error('no entro: ' + usuario);
}

async function serie(browser, nombre, viewport, usuario, vistas, movil) {
  const dir = path.join(SALIDA, nombre);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 1, isMobile: !!movil, hasTouch: !!movil,
  });
  const page = await ctx.newPage();

  // el primer cuadro es el ingreso, antes de entrar
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(dir, '000.png') });

  await entrar(page, usuario);
  let i = 1;
  for (const v of vistas) {
    await page.click('.sidebar >> text=' + v).catch(() => {});
    await page.waitForTimeout(2100);
    await page.screenshot({ path: path.join(dir, String(i).padStart(3, '0') + '.png') });
    i++;
  }
  await page.close();
  await ctx.close();
  console.log('  ok', nombre, '-', i, 'cuadros');
}

(async () => {
  const browser = await chromium.launch();

  await serie(browser, 'pc', { width: 1440, height: 900 }, 'diana', MENU_ADMIN, false);
  await serie(browser, 'tablet', { width: 820, height: 1000 }, 'diana', MENU_ADMIN, false);
  await serie(browser, 'movil', { width: 412, height: 891 }, 'stephanie', MENU_MOVIL, true);

  // ── el flujo de Pedidos: cuatro momentos ──
  const dir = path.join(SALIDA, 'pedidos');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1122 } });
  await ctx.addInitScript(`
    class R {
      start() {
        const t = window.__cvVozSimulada || '';
        setTimeout(() => { this.onstart && this.onstart(); }, 60);
        setTimeout(() => {
          this.onresult && this.onresult({ results: [Object.assign([{ transcript: t }], { isFinal: true })] });
          setTimeout(() => { this.onend && this.onend(); }, 30);
        }, 500);
      }
      stop() {} abort() {}
    }
    window.SpeechRecognition = R; window.webkitSpeechRecognition = R;
  `);
  const p = await ctx.newPage();
  await entrar(p, 'stephanie');
  await p.click('.sidebar >> text=Pedidos');
  await p.waitForTimeout(2400);
  await p.screenshot({ path: path.join(dir, '000.png') });          // 1 · la pantalla

  await p.evaluate(() => { window.__cvVozSimulada = 'hoy preparamos cincuenta ajiacos'; });
  await p.click('button[aria-label="Hable para decir el plato y las porciones"]').catch(() => {});
  await p.waitForTimeout(1800);
  await p.screenshot({ path: path.join(dir, '001.png') });          // 2 · escuchando

  await p.waitForTimeout(10000);
  await p.screenshot({ path: path.join(dir, '002.png') });          // 3 · lo que entendio

  await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll('h1,h2,h3,h4,.rotulo'))
      .find((n) => (n.textContent || '').toLowerCase().includes('insumos calculados'));
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await p.waitForTimeout(1600);
  await p.screenshot({ path: path.join(dir, '003.png') });          // 4 · la tabla
  await p.close();
  await ctx.close();
  console.log('  ok pedidos - 4 cuadros');

  await browser.close();
})().catch((e) => { console.error('FALLO', e.message); process.exit(1); });
