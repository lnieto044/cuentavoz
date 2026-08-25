// Las capturas de Sedes, que se agregaron despues del resto.
//
// Se toman sobre una COPIA de la base y creando una sede de ejemplo: sin
// ninguna sede creada la tarjeta solo dice "Todavia no hay sedes", que no
// explica nada a quien lee el manual. La copia se borra al terminar, asi
// que la base de la demo no queda con una sede inventada.
//
//     node docs/capturas/recapturar-sedes.js
const { chromium } = require('playwright');
const path = require('path');
const { levantar } = require('../../frontend/pruebas-flujo/entorno.cjs');

const DIR = path.join(__dirname, 'manual') + path.sep;
const VP = { width: 820, height: 1180 };
const CLAVE = 'StockXperts1';

let hechas = 0;
const fallos = [];

async function guardar(page, nombre, selector, locator) {
  try {
    const donde = locator || (selector ? page.locator(selector).first() : page);
    await donde.screenshot({ path: DIR + nombre + '.png' });
    console.log('  ok   ' + nombre);
    hechas++;
  } catch (e) {
    console.log('  FALLA ' + nombre + '  ' + e.message.split('\n')[0]);
    fallos.push(nombre);
  }
}

(async () => {
  const entorno = await levantar({ puertoApi: 8014, puertoWeb: 5196 });
  const APP = entorno.WEB;
  const nav = await chromium.launch();
  const ctx = await nav.newContext({ viewport: VP, deviceScaleFactor: 2 });
  const p = await ctx.newPage();

  await p.goto(APP, { waitUntil: 'networkidle' });
  await p.evaluate(() => {
    try {
      localStorage.clear();
      for (let id = 1; id <= 40; id++) localStorage.setItem('cv_tutorial_deshabilitado_' + id, '1');
    } catch (_) {}
  });
  await p.goto(APP, { waitUntil: 'networkidle' });
  const campos = await p.locator('.ingreso input').all();
  await campos[0].fill('diana');
  await campos[1].fill(CLAVE);
  await p.click('button:has-text("ENTRAR")');
  await p.locator('.sidebar').first().waitFor({ timeout: 40000 });
  await p.waitForTimeout(1500);

  // ── datos de ejemplo, por la API: mas rapido y no depende de la pantalla
  const token = await p.evaluate(() => localStorage.getItem('cv_token'));
  const cab = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const crear = async (nombre, ciudad) => (await (await fetch(`${entorno.API}/api/sedes`, {
    method: 'POST', headers: cab, body: JSON.stringify({ nombre, ciudad }),
  })).json()).id;

  const piscilago = await crear('Piscilago', 'Girardot');
  const calle26 = await crear('Calle 26', 'Bogotá');
  const bodegas = await (await fetch(`${entorno.API}/api/bodegas`, { headers: cab })).json();
  for (const [i, b] of bodegas.slice(0, 9).entries()) {
    await fetch(`${entorno.API}/api/bodegas/${b.id}/sede`, {
      method: 'PUT', headers: cab,
      body: JSON.stringify({ sede_id: i < 6 ? piscilago : calle26 }),
    });
  }
  console.log('  sedes de ejemplo creadas (Piscilago 6 bodegas, Calle 26 tres)');

  // ── Ajustes -> Gestion de usuarios ──
  await p.locator('.sidebar li > button').filter({ hasText: 'Ajustes' }).first().click();
  await p.waitForTimeout(1500);
  const pest = p.locator('button').filter({ hasText: /Usuarios|Gestión de usuarios/ }).first();
  if (await pest.count()) { await pest.click(); await p.waitForTimeout(1800); }

  // 1) la tarjeta con las sedes desplegadas
  await p.locator('button:has-text("Ver sedes")').first().click();
  await p.waitForTimeout(1200);
  // Esperar a que la tabla "De que sede es cada bodega" traiga filas: se
  // llena de /api/bodegas y salia con solo los encabezados.
  await p.locator('select[aria-label^="Sede de"]').first()
    .waitFor({ timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(800);

  // .last() y no .first(): hay una tarjeta que envuelve a la otra, y la
  // primera en el DOM es la exterior -la que trae la tabla de usuarios
  // entera-. La de Sedes es la interior. Capturar el elemento, ademas, es
  // mejor que recortar por coordenadas: el area de Ajustes tiene su propio
  // desplazamiento, asi que un recorte del documento salia cortado.
  const tarjeta = p.locator('.card')
    .filter({ has: p.locator('h2:text-is("Sedes")') }).last();
  await tarjeta.scrollIntoViewIfNeeded().catch(() => {});
  await p.waitForTimeout(600);
  await guardar(p, 'ajustes-sedes', null, tarjeta);

  // 2) el dialogo de crear una sede
  await p.locator('button:has-text("+ Nueva sede")').first().click();
  await p.locator('#sede-nombre').waitFor({ timeout: 10000 });
  await p.locator('#sede-nombre').fill('Calle 26');
  await p.locator('#sede-ciudad').fill('Bogotá');
  await p.waitForTimeout(400);
  await guardar(p, 'ajustes-sede-nueva', '.modal');
  await p.locator('.modal button:has-text("Cancelar")').first().click();
  await p.waitForTimeout(600);

  // 3) marcar una sede entera al repartir bodegas
  const asignar = p.locator('button:has-text("Asignar bodegas")').first();
  if (await asignar.count()) {
    await asignar.click();
    await p.locator('.modal').first().waitFor({ timeout: 10000 });
    await p.waitForTimeout(1200);
    await guardar(p, 'ajustes-asignar-por-sede', '.modal');
  } else {
    console.log('  FALLA ajustes-asignar-por-sede  no hay boton "Asignar bodegas"');
    fallos.push('ajustes-asignar-por-sede');
  }

  await nav.close();
  entorno.bajar();
  console.log(`\n  ${hechas} capturas` + (fallos.length ? `, ${fallos.length} fallaron` : ''));
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error('EXPLOTO', e.message); process.exit(1); });
