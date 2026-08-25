/* Lo que todos los recorridos necesitan: entrar, abrir una bodega,
   dictar por teclado y esperar a que el agente conteste. */

const CLAVE = 'StockXperts1';

/* Cuánto se le da al agente para contestar. Es generoso a propósito: si
   hay GOOGLE_API_KEY configurada, cada turno intenta primero con Gemini y
   solo cae al intérprete local cuando ese intento se agota, así que una
   respuesta puede tardar bastantes segundos. Esperar un rato fijo -lo
   primero que se intentó aquí- daba fallos que no existían: la respuesta
   llegaba bien, un segundo después de mirarla. */
const ESPERA_AGENTE = 45000;

async function entrar(navegador, WEB, usuario) {
  const contexto = await navegador.newContext({ viewport: { width: 1360, height: 940 } });
  const p = await contexto.newPage();
  await p.goto(WEB, { waitUntil: 'networkidle' });
  // el recorrido en video se abre solo la primera vez y tapa la pantalla
  await p.evaluate(() => {
    try {
      localStorage.clear();
      for (let i = 1; i <= 60; i++) localStorage.setItem('cv_tutorial_deshabilitado_' + i, '1');
    } catch (_) { /* navegador sin almacenamiento */ }
  });
  await p.goto(WEB, { waitUntil: 'networkidle' });

  const campos = await p.locator('.ingreso input').all();
  await campos[0].fill(usuario);
  await campos[1].fill(CLAVE);
  await p.click('button:has-text("ENTRAR")');
  await p.locator('.sidebar').first().waitFor({ timeout: 40000 });
  await p.waitForTimeout(1500);
  for (const c of await p.locator('.modal button:has-text("Cerrar")').all()) {
    await c.click().catch(() => {});
  }
  await p.waitForTimeout(300);
  return { contexto, p };
}

/** Va a una opción del menú por su nombre visible. */
async function irA(p, nombre) {
  await p.locator('.sidebar li > button').filter({ hasText: nombre }).first().click();
  await p.waitForTimeout(1500);
}

/** Lo último que respondió el agente. */
async function respuesta(p) {
  const b = p.locator('.burbuja').first();
  if (!await b.count()) return '';
  return ((await b.textContent()) || '').trim();
}

/** Espera a que el agente diga algo DISTINTO de lo que decía antes. */
async function esperarRespuestaNueva(p, anterior, limite = ESPERA_AGENTE) {
  const hasta = Date.now() + limite;
  while (Date.now() < hasta) {
    const ahora = await respuesta(p);
    if (ahora && ahora !== anterior) return ahora;
    await p.waitForTimeout(400);
  }
  return await respuesta(p);
}

/** Dicta usando el respaldo de teclado - el reconocimiento de voz del
 *  navegador no existe en un Chromium sin micrófono, y el teclado recorre
 *  exactamente el mismo camino en el backend. Devuelve lo que contestó. */
async function decir(p, texto, botonTeclado = 'Teclado') {
  const antes = await respuesta(p);
  await p.locator(`button:has-text("${botonTeclado}")`).first().click();
  await p.locator('.modal').first().waitFor({ timeout: 15000 });
  await p.locator('.modal textarea, .modal input').first().fill(texto);
  await p.locator('.modal button').filter({ hasText: /^Aceptar$/ }).first().click();
  return esperarRespuestaNueva(p, antes);
}

/** Pulsa un botón de la conversación y espera la respuesta nueva. */
async function pulsar(p, nombre) {
  const antes = await respuesta(p);
  await p.locator('button').filter({ hasText: nombre }).first().click();
  return esperarRespuestaNueva(p, antes);
}

/** Abre una bodega que esté libre para contar y devuelve su nombre. */
async function abrirBodegaLibre(p) {
  const tarjeta = p.locator('button').filter({ hasText: /PENDIENTE|dejó a medias/ }).first();
  if (!await tarjeta.count()) throw new Error('no hay ninguna bodega libre para abrir');
  const nombre = ((await tarjeta.textContent()) || '').split(/PENDIENTE|EN CONTEO/)[0].trim();
  await tarjeta.click();
  await p.locator('button:has-text("Terminar y firmar mi conteo")').first()
    .waitFor({ timeout: ESPERA_AGENTE });
  return nombre;
}

/** Espera a que el chip de avance deje de marcar el valor que traía. */
async function esperarAvanceDistinto(p, anterior, limite = ESPERA_AGENTE) {
  const hasta = Date.now() + limite;
  while (Date.now() < hasta) {
    const t = await p.locator('.chip', { hasText: 'Avance' }).first().textContent();
    if (t && t !== anterior) return t;
    await p.waitForTimeout(500);
  }
  return await p.locator('.chip', { hasText: 'Avance' }).first().textContent();
}

module.exports = { CLAVE, ESPERA_AGENTE, entrar, irA, decir, pulsar, respuesta,
                   esperarRespuestaNueva, esperarAvanceDistinto, abrirBodegaLibre };
