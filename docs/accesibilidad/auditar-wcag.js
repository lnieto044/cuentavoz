// Auditoria WCAG con axe-core sobre la app real, vista por vista y en los
// dos roles. No sustituye a un lector de pantalla, pero mide lo que un
// lector de pantalla necesita: rotulos, landmarks, orden de encabezados,
// contraste y nombres accesibles.
const { chromium } = require('playwright');
const fs = require('fs');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
// Sobre una COPIA de la base: estos recorridos abren bodegas y cuentan
// de verdad. La primera version corria contra la base de la demo y le
// dejaba sesiones a medias y bodegas en estados raros.
const { levantar } = require('../../frontend/pruebas-flujo/entorno.cjs');
let APP = null;
let entorno = null;

const VISTAS_AUX = ['inicio', 'conteo', 'pedido', 'legalizacion', 'bodegas',
                    'mensajes', 'ayuda', 'perfil'];
const VISTAS_ADM = ['inicio', 'auditoria', 'panel', 'reportes', 'ajustes',
                    'bodegas', 'mensajes', 'perfil'];

async function auditar(page, etiqueta, acumulado) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa',
                                     'wcag22aa', 'best-practice'] },
  }));
  const graves = r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  const leves = r.violations.filter((v) => v.impact !== 'critical' && v.impact !== 'serious');
  console.log(`  ${etiqueta.padEnd(26)} ${String(r.passes.length).padStart(3)} ok  ` +
              `${graves.length} graves  ${leves.length} leves`);
  for (const v of r.violations) {
    acumulado.push({ vista: etiqueta, id: v.id, impacto: v.impact,
                     n: v.nodes.length, desc: v.help });
  }
}

async function entrar(page, usuario) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.evaluate(() => { try {
    localStorage.clear();
    for (let i = 1; i <= 40; i++) localStorage.setItem('cv_tutorial_deshabilitado_' + i, '1');
  } catch (_) {} });
  await page.goto(APP, { waitUntil: 'networkidle' });
  const inp = await page.locator('.ingreso input').all();
  await inp[0].fill(usuario); await inp[1].fill('StockXperts1');
  await page.click('button:has-text("ENTRAR")');
  await page.locator('.sidebar').first().waitFor({ timeout: 25000 });
  await page.waitForTimeout(1800);
  for (const c of await page.locator('.modal button:has-text("Cerrar")').all())
    await c.click().catch(() => {});
  await page.waitForTimeout(400);
}

(async () => {
  entorno = await levantar({ puertoApi: 8012, puertoWeb: 5194 });
  APP = entorno.WEB;
  const b = await chromium.launch();
  const acumulado = [];

  // ── pantalla de ingreso ──
  let p = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  await p.goto(APP, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  console.log('\nSIN SESION');
  await auditar(p, 'ingreso', acumulado);
  await p.close();

  for (const [rol, usuario, vistas] of [['AUXILIAR', 'stephanie', VISTAS_AUX],
                                        ['ADMINISTRADORA', 'diana', VISTAS_ADM]]) {
    console.log(`\n${rol} (${usuario})`);
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    p = await ctx.newPage();
    await entrar(p, usuario);
    for (const v of vistas) {
      const item = p.locator(`.sidebar li[data-vista="${v}"], .sidebar li`).first();
      const porTexto = p.locator('.sidebar li').filter({ hasText: new RegExp(v, 'i') }).first();
      const objetivo = (await porTexto.count()) ? porTexto : item;
      await objetivo.click().catch(() => {});
      await p.waitForTimeout(1400);
      await auditar(p, `${rol.toLowerCase()}/${v}`, acumulado);
    }
    await ctx.close();
  }
  await b.close();
  entorno.bajar();

  console.log('\n══ RESUMEN ══');
  const porId = {};
  for (const x of acumulado) {
    porId[x.id] = porId[x.id] || { impacto: x.impacto, desc: x.desc, vistas: new Set(), nodos: 0 };
    porId[x.id].vistas.add(x.vista); porId[x.id].nodos += x.n;
  }
  const filas = Object.entries(porId).sort((a, b2) =>
    (b2[1].impacto === 'critical') - (a[1].impacto === 'critical'));
  if (!filas.length) { console.log('  sin incumplimientos WCAG A/AA'); }
  for (const [id, d] of filas) {
    console.log(`  [${(d.impacto || '?').padEnd(8)}] ${id}  (${d.nodos} elementos, ${d.vistas.size} vistas)`);
    console.log(`             ${d.desc}`);
  }
  // sin esto node no termina: los servidores hijos mantienen vivo el
  // bucle de eventos aunque ya se hayan matado sus procesos
  process.exit(filas.length ? 1 : 0);
})().catch((e) => { console.error('EXPLOTO', e.message);
               if (entorno) entorno.bajar();
               process.exit(1); });
