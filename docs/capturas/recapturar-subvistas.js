// Las subvistas que faltaban en docs/capturas/manual/: toda la
// autenticacion y varios estados internos de las vistas.
//
// Lo que NO se toma aqui, a proposito:
//   · ingreso-registro-codigo  crear la cuenta de verdad deja un usuario
//     nuevo en el User Pool de Cognito de produccion.
//   · ingreso-login-mfa        exige una cuenta con segundo factor ya
//     activado, y activarselo a una cuenta de la demo la deja inservible
//     para el resto de las pruebas.
// Las dos quedan descritas en la guia, sin captura.
const { chromium } = require('playwright');
const path = require('path');

const APP = process.env.CV_URL || 'http://localhost:5183';
const RAIZ = path.join(__dirname, path.sep).split(path.sep).join('/');
const DIR = RAIZ + 'manual/';
const VP = { width: 820, height: 1180 };

let hechas = 0;
const fallos = [];

async function nueva(browser) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2 });
  return ctx.newPage();
}

async function limpio(page) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    try {
      localStorage.clear();
      for (let id = 1; id <= 12; id++) localStorage.setItem('cv_tutorial_deshabilitado_' + id, '1');
    } catch (_) {}
  });
  await page.goto(APP, { waitUntil: 'networkidle' });
}

async function entrar(page, usuario) {
  for (let i = 1; i <= 4; i++) {
    await limpio(page);
    const inp = await page.locator('.ingreso input').all();
    await inp[0].fill(usuario);
    await inp[1].fill('StockXperts1');
    await page.click('button:has-text("ENTRAR")');
    try {
      await page.locator('.sidebar').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(1200);
      for (const b of await page.locator('.modal button:has-text("Cerrar")').all()) {
        await b.click().catch(() => {});
      }
      return;
    } catch (_) { console.log('    (reintento', i, ')'); }
  }
  throw new Error('no entro: ' + usuario);
}

async function shot(page, nombre, preparar, espera = 1000) {
  try {
    if (preparar) await preparar(page);
    await page.waitForTimeout(espera);
    const alto = await page.evaluate(() => {
      const c = document.querySelector('.contenido') || document.body;
      let max = 0;
      c.querySelectorAll('*').forEach((n) => {
        const r = n.getBoundingClientRect();
        if (r.height > 0 && r.width > 0 && r.bottom > max) max = r.bottom;
      });
      return Math.max(360, Math.min(Math.ceil(max + 28), window.innerHeight));
    }).catch(() => null);
    const clip = alto ? { clip: { x: 0, y: 0, width: 820, height: alto } } : {};
    await page.screenshot(Object.assign({ path: DIR + nombre + '.png' }, clip));
    hechas++;
    console.log('  ✓', nombre);
  } catch (e) {
    fallos.push(nombre + ' — ' + e.message.split('\n')[0]);
    console.log('  ✗', nombre, '—', e.message.split('\n')[0]);
  }
}

const menu = (n, esp = 1500) => async (p) => {
  await p.click('.sidebar >> text=' + n);
  await p.waitForTimeout(esp);
};
const pestana = (n, esp = 1500) => async (p) => {
  await p.click('.chips button:has-text("' + n + '")');
  await p.waitForTimeout(esp);
};
const verSeccion = (t) => async (p) => {
  await p.evaluate((x) => {
    const el = Array.from(document.querySelectorAll('h1,h2,h3,h4,.rotulo'))
      .find((n) => (n.textContent || '').toLowerCase().includes(x.toLowerCase()));
    if (el) el.scrollIntoView({ block: 'center' });
  }, t);
  await p.waitForTimeout(900);
};
const cerrarModal = async (p) => {
  for (const t of ['Cancelar', 'Ahora no', 'Cerrar']) {
    const b = p.locator('.modal button:has-text("' + t + '"), button:has-text("' + t + '")');
    if (await b.count() > 0) { await b.first().click().catch(() => {}); await p.waitForTimeout(500); return; }
  }
  await p.keyboard.press('Escape').catch(() => {});
  await p.waitForTimeout(400);
};

(async () => {
  const browser = await chromium.launch();

  // ═══════════ autenticacion, sin sesion ═══════════
  console.log('Autenticación:');
  let page = await nueva(browser);

  await limpio(page);
  await shot(page, 'ingreso-login', async (p) => {
    const inp = await p.locator('.ingreso input').all();
    await inp[0].pressSequentially('stephanie', { delay: 40 });
    await p.waitForTimeout(900);
  }, 900);

  await limpio(page);
  await shot(page, 'ingreso-registro', async (p) => {
    await p.click('text=Crear una cuenta');
    await p.waitForTimeout(700);
    const campos = await p.locator('.ingreso input').all();
    if (campos.length >= 5) {
      await campos[0].fill('María Fernanda Ríos');
      await campos[2].fill('mfrios@colsubsidio.com');
      await campos[3].fill('mfrios');
      await campos[4].fill('Bodega2026');
    }
  }, 900);

  await limpio(page);
  await shot(page, 'ingreso-recuperar', async (p) => {
    await p.click('text=Olvidé mi clave');
    await p.waitForTimeout(700);
    const c = p.locator('.ingreso input').first();
    await c.fill('stephanie');
  }, 800);

  await page.close();

  // ═══════════ auxiliar ═══════════
  console.log('Auxiliar (stephanie):');
  page = await nueva(browser);
  await entrar(page, 'stephanie');

  await shot(page, 'conteo-bodega-abierta', async (p) => {
    await menu('Conteo')(p);
    const t = p.locator('.tarjeta-bodega:has-text("RESTAURANTE FUENTES SUMIN")');
    if (await t.count() > 0) await t.first().click();
    await p.waitForSelector('button:has-text("Teclado")', { timeout: 15000 });
  }, 1400);

  await shot(page, 'bodegas-detalle', async (p) => {
    await menu('Bodegas')(p);
    const t = p.locator('.tarjeta-bodega').first();
    await t.click();
    await p.waitForTimeout(2000);
  }, 1200);

  await shot(page, 'ayuda-estado-sistema', async (p) => {
    await menu('Ayuda')(p);
    await verSeccion('Estado del sistema')(p);
  }, 900);

  await shot(page, 'mi-perfil-accesibilidad', async (p) => {
    await menu('Mi perfil')(p);
    await verSeccion('Accesibilidad')(p);
  }, 900);

  await shot(page, 'mi-perfil-mfa', async (p) => {
    await menu('Mi perfil')(p);
    const a = p.locator('button:has-text("Activar")');
    if (await a.count() > 0) {
      await a.first().click();
      await p.waitForSelector('.mfa-qr', { timeout: 12000 });
      await p.evaluate(() => {
        const q = document.querySelector('.mfa-qr');
        if (q) q.scrollIntoView({ block: 'center' });
      });
    }
  }, 1200);
  await cerrarModal(page);
  await page.close();          // se cierra sin confirmar: no queda activada

  // ═══════════ administrador ═══════════
  console.log('Administrador (diana):');
  page = await nueva(browser);
  await entrar(page, 'diana');

  await shot(page, 'mensajes-administrador', menu('Mensajes'), 1200);

  await shot(page, 'ajustes-nuevo-usuario', async (p) => {
    await menu('Ajustes')(p);
    await pestana('Gestión de usuarios')(p);
    const b = p.locator('button:has-text("Nuevo usuario")');
    if (await b.count() > 0) { await b.first().click(); await p.waitForSelector('.modal', { timeout: 8000 }); }
  }, 1000);
  await cerrarModal(page);

  await shot(page, 'panel-grafica', async (p) => {
    await menu('Panel')(p);
    await verSeccion('Diferencia absoluta por bodega')(p);
  }, 1200);

  await shot(page, 'auditoria-recuento-bodega', async (p) => {
    await menu('Auditoría')(p);
    const t = p.locator('.tarjeta-bodega').first();
    if (await t.count() > 0) { await t.click(); await p.waitForTimeout(2500); }
  }, 1200);

  await page.close();
  await browser.close();

  console.log('\n' + hechas + ' capturas nuevas');
  if (fallos.length) { console.log(fallos.length + ' fallaron:'); fallos.forEach((f) => console.log('   ', f)); }
})().catch((e) => { console.error('EXPLOTO', e); process.exit(1); });
