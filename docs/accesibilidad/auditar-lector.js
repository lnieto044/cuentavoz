// Lo que axe NO mide: el ARBOL DE ACCESIBILIDAD, que es exactamente lo
// que lee NVDA/JAWS/VoiceOver, y el recorrido real con teclado.
//
// axe revisa reglas sobre el HTML. Un lector de pantalla lee otra cosa:
// el arbol que el navegador construye a partir de ese HTML. Se puede
// cumplir todas las reglas y aun asi tener un boton que se anuncia
// "boton" a secas, un dialogo del que no se puede salir con teclado, o
// una respuesta del agente que nunca se anuncia.
const { chromium } = require('playwright');
const APP = 'http://localhost:5183';

let fallos = 0;
const problemas = [];
const ok = (etiqueta, bien, extra) => {
  console.log(`  ${bien ? 'ok  ' : 'FALLA'} ${etiqueta}${extra ? '  ' + extra : ''}`);
  if (!bien) { fallos++; problemas.push(etiqueta + (extra ? ' ' + extra : '')); }
};

/** El arbol de accesibilidad real, por el protocolo de Chrome: es
    literalmente lo que se le entrega a un lector de pantalla. */
async function arbolReal(cdp) {
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  return nodes
    .filter((n) => !n.ignored)
    .map((n) => ({
      role: n.role?.value || '',
      name: (n.name?.value || '').trim(),
    }));
}

const ACCIONABLES = new Set(['button', 'link', 'textbox', 'combobox', 'checkbox',
                             'radio', 'switch', 'searchbox', 'slider', 'spinbutton',
                             'menuitem', 'tab', 'option']);

async function entrar(p, usuario) {
  await p.goto(APP, { waitUntil: 'networkidle' });
  await p.evaluate(() => { try {
    localStorage.clear();
    for (let i = 1; i <= 40; i++) localStorage.setItem('cv_tutorial_deshabilitado_' + i, '1');
  } catch (_) {} });
  await p.goto(APP, { waitUntil: 'networkidle' });
  const inp = await p.locator('.ingreso input').all();
  await inp[0].fill(usuario); await inp[1].fill('StockXperts1');
  await p.click('button:has-text("ENTRAR")');
  await p.locator('.sidebar').first().waitFor({ timeout: 25000 });
  await p.waitForTimeout(1800);
  for (const c of await p.locator('.modal button:has-text("Cerrar")').all()) await c.click().catch(() => {});
  await p.waitForTimeout(400);
}

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Accessibility.enable');

  console.log('\n── 1. Lo que el lector oye: nodos sin nombre ──');
  await entrar(p, 'diana');
  const VISTAS = ['inicio', 'auditoria', 'panel', 'reportes', 'ajustes',
                  'bodegas', 'mensajes', 'ayuda', 'perfil'];
  let totalAccionables = 0, sinNombre = [];
  for (const v of VISTAS) {
    await p.locator('.sidebar li > button').filter({ hasText: new RegExp(v, 'i') })
      .first().click().catch(() => {});
    await p.waitForTimeout(1300);
    const arbol = await arbolReal(cdp);
    const acc = arbol.filter((x) => ACCIONABLES.has(x.role));
    totalAccionables += acc.length;
    for (const x of acc.filter((y) => !y.name)) sinNombre.push(`${v}: <${x.role}>`);
  }
  ok('todo control accionable tiene nombre', sinNombre.length === 0,
     `(${totalAccionables} controles revisados${sinNombre.length ? ' — ' + sinNombre.slice(0, 6).join(', ') : ''})`);

  console.log('\n── 2. Puntos de referencia y encabezados ──');
  const est = await p.evaluate(() => {
    const h = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .map((x) => ({ n: +x.tagName[1], t: x.textContent.trim().slice(0, 30) }));
    let salto = null;
    for (let i = 1; i < h.length; i++) if (h[i].n - h[i - 1].n > 1) salto = `${h[i - 1].n}→${h[i].n} en "${h[i].t}"`;
    return {
      nav: document.querySelectorAll('nav').length,
      main: document.querySelectorAll('main').length,
      h1: h.filter((x) => x.n === 1).length,
      encabezados: h.length,
      salto,
      idioma: document.documentElement.lang,
    };
  });
  ok('hay exactamente un <main>', est.main === 1);
  ok('hay navegacion identificada', est.nav >= 1, `(${est.nav})`);
  ok('la pagina declara idioma', /^es/.test(est.idioma || ''), `("${est.idioma}")`);
  ok('los encabezados no saltan niveles', !est.salto, est.salto ? `(${est.salto})` : `(${est.encabezados} encabezados)`);

  console.log('\n── 3. Recorrido con teclado: sin trampas ni tabindex inventado ──');
  const tab = await p.evaluate(() => {
    const positivos = [...document.querySelectorAll('[tabindex]')]
      .filter((x) => +x.getAttribute('tabindex') > 0).length;
    return { positivos };
  });
  ok('nadie usa tabindex positivo', tab.positivos === 0,
     tab.positivos ? `(${tab.positivos} elementos)` : '');

  // recorrer con Tab y comprobar que se llega a todo y se vuelve al inicio
  await p.locator('.sidebar li > button').filter({ hasText: /inicio/i }).first().click();
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.body.focus());
  const recorrido = [];
  for (let i = 0; i < 60; i++) {
    await p.keyboard.press('Tab');
    const d = await p.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      return { tag: a.tagName, texto: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 28),
               visible: a.getBoundingClientRect().width > 0 };
    });
    if (!d) break;
    recorrido.push(d);
  }
  ok('el tabulador recorre la pantalla', recorrido.length > 8, `(${recorrido.length} paradas)`);
  const invisibles = recorrido.filter((x) => !x.visible && !/saltar/i.test(x.texto));
  ok('no se enfoca nada invisible', invisibles.length === 0,
     invisibles.length ? `(${invisibles.length}: ${invisibles.slice(0, 3).map((x) => x.tag).join(', ')})` : '');

  console.log('\n── 4. Dialogos: se pueden cerrar y devuelven el foco ──');
  await p.locator('.sidebar li > button').filter({ hasText: /perfil/i }).first().click();
  await p.waitForTimeout(1500);
  const disparador = p.locator('button').filter({ hasText: /Cerrar todas|cerrar sesión en todos/i }).first();
  if (await disparador.count()) {
    await disparador.focus();
    const antes = await p.evaluate(() => (document.activeElement.textContent || '').trim().slice(0, 30));
    await disparador.click();
    await p.locator('.modal').first().waitFor({ timeout: 8000 });
    await p.waitForTimeout(600);
    const dlg = await p.evaluate(() => {
      const m = document.querySelector('.modal');
      const dentro = m.contains(document.activeElement);
      return { rol: m.getAttribute('role'), modal: m.getAttribute('aria-modal'),
               nombrado: Boolean(m.getAttribute('aria-labelledby') || m.getAttribute('aria-label')),
               focoDentro: dentro };
    });
    ok('el dialogo se anuncia como dialogo', dlg.rol === 'dialog' && dlg.modal === 'true',
       `(role=${dlg.rol}, aria-modal=${dlg.modal})`);
    ok('el dialogo tiene titulo accesible', dlg.nombrado);
    ok('el foco entra al dialogo', dlg.focoDentro);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(700);
    const cerrado = (await p.locator('.modal').count()) === 0;
    ok('Escape cierra el dialogo', cerrado);
    const despues = await p.evaluate(() => (document.activeElement.textContent || '').trim().slice(0, 30));
    ok('el foco vuelve a donde estaba', despues === antes, `("${antes}" → "${despues}")`);
  } else {
    ok('se encontro un dialogo que probar', false, '(no hay boton que lo abra)');
  }

  console.log('\n── 5. Lo que cambia solo: ¿se anuncia? ──');
  const vivos = await p.evaluate(() => {
    const n = [...document.querySelectorAll('[aria-live]')];
    return n.map((x) => ({ nivel: x.getAttribute('aria-live'),
                           clase: (x.className || '').toString().slice(0, 28) }));
  });
  console.log('    regiones activas en Mi perfil:', vivos.length
    ? vivos.map((v) => `${v.clase || '?'}(${v.nivel})`).join(', ') : 'ninguna');

  // La respuesta del agente, que es el corazon de la app. Ojo: la burbuja
  // solo existe con una bodega ABIERTA - mirarla en la pantalla de
  // seleccion daba un falso positivo.
  await p.locator('.sidebar li > button').filter({ hasText: /^Conteo$/ }).first().click();
  await p.waitForTimeout(1600);
  await p.locator('button').filter({ hasText: /PENDIENTE|dej\u00f3 a medias/ })
    .first().click().catch(() => {});
  await p.locator('button:has-text("Terminar y firmar mi conteo")').first()
    .waitFor({ timeout: 45000 }).catch(() => {});
  const enConteo = await p.evaluate(() => {
    const n = [...document.querySelectorAll('[aria-live]')];
    return n.map((x) => ({ nivel: x.getAttribute('aria-live'),
                           clase: (x.className || '').toString().slice(0, 28),
                           texto: (x.textContent || '').trim().slice(0, 45) }));
  });
  console.log('    regiones activas en Conteo:', enConteo.length
    ? enConteo.map((v) => `${v.clase || '?'}(${v.nivel})`).join(', ') : 'ninguna');
  ok('la respuesta del agente se anuncia sola', enConteo.length > 0);

  console.log('\n── 6. El foco se ve ──');
  // Tabulando de verdad, no con .focus(): el navegador solo aplica
  // :focus-visible cuando el foco llega por teclado. Medirlo con .focus()
  // decia "no se ve" aunque se viera perfectamente.
  await p.evaluate(() => document.body.focus());
  await p.keyboard.press('Tab');
  await p.keyboard.press('Tab');
  await p.waitForTimeout(300);
  const anillo = await p.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return { contorno: s.outlineStyle, ancho: s.outlineWidth, sombra: s.boxShadow };
  });
  ok('el elemento enfocado se distingue',
     (anillo.contorno !== 'none' && parseFloat(anillo.ancho) > 0) || anillo.sombra !== 'none',
     `(outline ${anillo.contorno} ${anillo.ancho})`);

  await b.close();
  console.log('\n══ RESULTADO ══');
  if (!fallos) console.log('  sin hallazgos');
  else problemas.forEach((x) => console.log('  · ' + x));
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('EXPLOTO', e.message); process.exit(1); });
