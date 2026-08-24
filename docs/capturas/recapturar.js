// Vuelve a tomar el juego de capturas del manual y la guia tecnica.
//
// Mismo formato que el juego original: tablet 820x1180 a 2x, contra la
// aplicacion de verdad y con los datos de la demo. Nada de mockups.
//
//   docs/capturas/tablet/   las 14 pantallas de nivel de menu
//   docs/capturas/manual/   pestañas, modales y sub-pantallas
//
// Uso: CV_URL=http://localhost:5183 node docs/capturas/recapturar.js
// Necesita playwright con chromium y la aplicacion corriendo.
const { chromium } = require('playwright');

const APP = process.env.CV_URL || 'http://localhost:5183';
const path = require('path');
// Relativo a este archivo: el script tiene que servir en cualquier clon.
const RAIZ = path.join(__dirname, path.sep).split(path.sep).join('/');
const VP = { width: 820, height: 1180 };
const ESCALA = 2;

let hechas = 0;
const fallos = [];

async function nuevaPagina(browser) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: ESCALA });
  return ctx.newPage();
}

async function entrar(page, usuario) {
  for (let i = 1; i <= 4; i++) {
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      try {
        localStorage.clear();
        for (let id = 1; id <= 12; id++) localStorage.setItem('cv_tutorial_deshabilitado_' + id, '1');
      } catch (_) {}
    });
    await page.goto(APP, { waitUntil: 'networkidle' });
    const inputs = await page.locator('.ingreso input').all();
    await inputs[0].fill(usuario);
    await inputs[1].fill('StockXperts1');
    await page.click('button:has-text("ENTRAR")');
    try {
      await page.locator('.sidebar').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(1200);
      for (const b of await page.locator('.modal button:has-text("Cerrar")').all()) {
        await b.click().catch(() => {});
      }
      return;
    } catch (_) { console.log('    (reintento', i, 'para', usuario + ')'); }
  }
  throw new Error('no se pudo entrar como ' + usuario);
}

/** Cada captura va envuelta: si una falla, se anota y el resto sigue.
    Un juego de sesenta capturas no se puede caer entero por un boton
    que cambio de nombre. */
async function shot(page, carpeta, nombre, preparar, espera = 1000) {
  try {
    if (preparar) await preparar(page);
    await page.waitForTimeout(espera);
    // Recorte al alto real del contenido: la ventana de tablet es mas
    // alta que casi cualquier pantalla, y sin esto media captura es
    // fondo vacio. Con un modal abierto el overlay cubre todo, asi que
    // en ese caso el alto sale completo, que es lo correcto.
    const alto = await page.evaluate(() => {
      const c = document.querySelector('.contenido') || document.body;
      let max = 0;
      c.querySelectorAll('*').forEach((n) => {
        const r = n.getBoundingClientRect();
        if (r.height > 0 && r.width > 0 && r.bottom > max) max = r.bottom;
      });
      return Math.max(360, Math.min(Math.ceil(max + 28), window.innerHeight));
    }).catch(() => null);
    const recorte = alto ? { clip: { x: 0, y: 0, width: 820, height: alto } } : {};
    await page.screenshot(Object.assign(
      { path: RAIZ + carpeta + '/' + nombre + '.png', fullPage: false }, recorte));
    hechas++;
    console.log('  ✓', carpeta + '/' + nombre);
  } catch (e) {
    fallos.push(carpeta + '/' + nombre + ' — ' + e.message.split('\n')[0]);
    console.log('  ✗', carpeta + '/' + nombre, '—', e.message.split('\n')[0]);
  }
}

const menu = (n, esp = 1500) => async (p) => {
  await p.click('.sidebar >> text=' + n);
  await p.waitForTimeout(esp);
};
const pestana = (n, esp = 1400) => async (p) => {
  await p.click('.chips button:has-text("' + n + '")');
  await p.waitForTimeout(esp);
};
const cerrarModal = async (p) => {
  for (const t of ['Cancelar', 'Cerrar']) {
    const b = p.locator('.modal button:has-text("' + t + '")');
    if (await b.count() > 0) { await b.first().click().catch(() => {}); await p.waitForTimeout(400); return; }
  }
  await p.keyboard.press('Escape').catch(() => {});
  await p.waitForTimeout(400);
};

(async () => {
  const browser = await chromium.launch();

  // ─────────────────────────────── sin sesion
  console.log('Sin sesión:');
  let page = await nuevaPagina(browser);
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await shot(page, 'tablet', 'ingreso', null, 1400);
  await page.close();

  // ─────────────────────────────── auxiliar
  console.log('Auxiliar (stephanie):');
  page = await nuevaPagina(browser);
  await entrar(page, 'stephanie');

  await shot(page, 'tablet', 'inicio', menu('Inicio'));
  await shot(page, 'tablet', 'pedidos', menu('Pedidos'));
  await shot(page, 'tablet', 'conteo', menu('Conteo'));
  await shot(page, 'tablet', 'legalizacion', menu('Legalización'));
  await shot(page, 'tablet', 'bodegas', menu('Bodegas'));
  await shot(page, 'tablet', 'ayuda', menu('Ayuda'));
  await shot(page, 'tablet', 'mensajes', menu('Mensajes'));
  await shot(page, 'tablet', 'mi-perfil', menu('Mi perfil'));

  // sub-pantallas del auxiliar
  await shot(page, 'manual', 'bodegas-nueva', async (p) => {
    await menu('Bodegas')(p);
    await p.click('button:has-text("Bodega nueva")');
    await p.waitForSelector('.modal', { timeout: 8000 });
  });
  await cerrarModal(page);

  await shot(page, 'manual', 'bodegas-consulta', async (p) => {
    const campo = p.locator('input[placeholder*="arroz"], .contenido input[type="text"]').first();
    await campo.fill('arroz');
    await campo.press('Enter');
    await p.waitForTimeout(3500);
  }, 1200);

  await shot(page, 'manual', 'conteo-teclado', async (p) => {
    await menu('Conteo')(p);
    const t = p.locator('.tarjeta-bodega:has-text("RESTAURANTE FUENTES SUMIN")');
    if (await t.count() > 0) await t.first().click();
    await p.waitForSelector('button:has-text("Teclado")', { timeout: 15000 });
    await p.click('button:has-text("Teclado")');
    await p.waitForSelector('.modal', { timeout: 8000 });
  });
  await cerrarModal(page);

  await shot(page, 'manual', 'ayuda-escribir-admin', async (p) => {
    await menu('Ayuda')(p);
    await p.click('button:has-text("Escribirle al administrador")');
    await p.waitForSelector('.modal textarea', { timeout: 8000 });
    await p.locator('.modal textarea').fill('Necesito que me asigne la bodega del Kiosco Taquilla para el conteo de mañana.');
  });
  await cerrarModal(page);

  await shot(page, 'manual', 'ayuda-reportar-problema', async (p) => {
    await p.click('button:has-text("Reportar un problema")');
    await p.waitForSelector('.modal textarea', { timeout: 8000 });
    await p.locator('.modal textarea').fill('El micrófono no responde al confirmar un conteo en el Kiosco Taquilla.');
  });
  await cerrarModal(page);

  await shot(page, 'manual', 'mi-perfil-cerrar-todos', async (p) => {
    await menu('Mi perfil')(p);
    await p.click('button:has-text("Cerrar sesión en todos los dispositivos")');
    await p.waitForSelector('.modal', { timeout: 8000 });
  });
  await cerrarModal(page);

  await shot(page, 'tablet', 'cerrar-sesion', async (p) => {
    await menu('Conteo')(p);
    const t = p.locator('.tarjeta-bodega:has-text("RESTAURANTE FUENTES SUMIN")');
    if (await t.count() > 0) { await t.first().click(); await p.waitForTimeout(2500); }
    await p.click('.sidebar >> text=Cerrar sesión');
    await p.waitForSelector('.modal', { timeout: 8000 });
  });
  await page.close();

  // ─────────────────────────────── administrador
  console.log('Administrador (diana):');
  page = await nuevaPagina(browser);
  await entrar(page, 'diana');

  await shot(page, 'tablet', 'auditoria', menu('Auditoría', 2000));
  await shot(page, 'manual', 'auditoria-aprobaciones', pestana('Aprobaciones'));
  await shot(page, 'manual', 'auditoria-pedidos-pendientes', pestana('Pedidos pendientes'));
  await shot(page, 'manual', 'auditoria-bandeja-alertas', pestana('Bandeja de alertas'));

  await shot(page, 'tablet', 'reportes', menu('Reportes', 2000));
  await shot(page, 'manual', 'reportes-vista-consolidado', async (p) => {
    await p.click('button:has-text("Consolidado para My Inventory")');
    await p.waitForTimeout(2500);
  });
  await shot(page, 'manual', 'reportes-vista-diferencias', async (p) => {
    await p.click('button:has-text("Diferencias por bodega")');
    await p.waitForTimeout(2500);
  });
  await shot(page, 'manual', 'reportes-analisis-consumo', pestana('Análisis de consumo', 2000));

  await shot(page, 'tablet', 'panel', menu('Panel', 2200));
  await shot(page, 'manual', 'panel-bodegas-alertas', pestana('Bodegas y alertas', 1800));

  await shot(page, 'tablet', 'ajustes', menu('Ajustes', 1800));
  await shot(page, 'manual', 'ajustes-usuarios', pestana('Gestión de usuarios', 1800));
  await shot(page, 'manual', 'ajustes-recetas', pestana('Recetas', 1800));
  await shot(page, 'manual', 'ajustes-trazabilidad', pestana('Registro de trazabilidad', 1800));

  await shot(page, 'manual', 'mensajes-responder', async (p) => {
    await menu('Mensajes')(p);
    await p.click('button:has-text("Responder")');
    await p.waitForSelector('.modal', { timeout: 8000 });
  });
  await cerrarModal(page);

  await shot(page, 'manual', 'inicio-administrador', menu('Inicio'));
  await page.close();

  await browser.close();
  console.log('\n' + hechas + ' capturas nuevas');
  if (fallos.length) {
    console.log(fallos.length + ' fallaron:');
    fallos.forEach((f) => console.log('   ', f));
  }
})().catch((e) => { console.error('EXPLOTO', e); process.exit(1); });
