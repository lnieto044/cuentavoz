/* Contar una bodega de punta a punta: abrirla, dictar un artículo,
   resolver lo que el agente pregunte, confirmarlo, verlo en el avance y
   firmar. */
const { entrar, irA, decir, respuesta, abrirBodegaLibre,
        esperarAvanceDistinto, ESPERA_AGENTE } = require('./comun.cjs');

exports.titulo = 'Conteo (auxiliar)';

/** Un artículo con nombre limpio: el catálogo real trae cosas como
 *  «AFVT) ANTIMICROBIANO FRUTAS Y VERDURAS» o códigos entre paréntesis,
 *  que nadie dicta en voz alta. Buscar uno normal evita que la prueba
 *  falle por algo que no es lo que se está probando. */
function articuloDictable(filas) {
  return filas.find((f) =>
    /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]{5,28}$/.test((f.articulo || '').trim())) || filas[0];
}

/** Lleva el turno hasta el final, conteste lo que conteste el agente.
 *
 *  Un dictado real no siempre guarda a la primera: si el nombre se parece
 *  a varios del catálogo, el agente ofrece opciones («¿cuál de los dos?»),
 *  y antes de guardar pide confirmación. Las dos cosas son parte del
 *  flujo, no un caso raro, así que la prueba las recorre en vez de
 *  esquivarlas eligiendo un artículo que nunca sea ambiguo. */
async function resolverTurno(p, avanceAntes) {
  const hasta = Date.now() + ESPERA_AGENTE;
  while (Date.now() < hasta) {
    const chip = await p.locator('.chip', { hasText: 'Avance' }).first().textContent();
    if (chip !== avanceAntes) return { guardado: true, dijo: await respuesta(p) };

    if (await p.locator('.opciones .opcion').count()) {
      await p.locator('.opciones .opcion').first().click();
      await p.waitForTimeout(1200);
      continue;
    }
    const dijo = await respuesta(p);
    if (/confirma/i.test(dijo)) {
      const boton = p.locator('button').filter({ hasText: /^Confirmar$/ }).first();
      if (await boton.count()) { await boton.click(); await p.waitForTimeout(1500); continue; }
    }
    await p.waitForTimeout(600);
  }
  return { guardado: false, dijo: await respuesta(p) };
}

exports.correr = async ({ navegador, WEB, API, prueba, afirmar }) => {
  const { contexto, p } = await entrar(navegador, WEB, 'stephanie');

  await prueba('el auxiliar entra y ve su menú', async () => {
    const opciones = await p.locator('.sidebar li > button').count();
    afirmar(opciones >= 8, `solo ${opciones} opciones en el menú`);
    afirmar(await p.locator('.sidebar li > button')
      .filter({ hasText: 'Auditoría' }).count() === 0,
      'un auxiliar no debería ver Auditoría');
  });

  await prueba('abre una bodega asignada', async () => {
    await irA(p, 'Conteo');
    await abrirBodegaLibre(p);
    const dijo = await respuesta(p);
    afirmar(/abierta/i.test(dijo), `el agente dijo: "${dijo}"`);
  });

  await prueba('cuenta un artículo por teclado y queda registrado', async () => {
    const token = await p.evaluate(() => localStorage.getItem('cv_token'));
    const cab = { Authorization: `Bearer ${token}` };
    const bodegas = await (await fetch(`${API}/api/bodegas?propias=1`, { headers: cab })).json();
    const abierta = bodegas.find((b) => b.estado === 'en_conteo');
    afirmar(abierta, 'ninguna bodega quedó en conteo tras abrirla');

    const filas = await (await fetch(`${API}/api/bodegas/${abierta.id}/articulos`,
      { headers: cab })).json();
    afirmar(Array.isArray(filas) && filas.length, 'la bodega no trae artículos');
    const art = articuloDictable(filas);

    const antes = await p.locator('.chip', { hasText: 'Avance' }).first().textContent();
    await decir(p, `hay nueve ${art.articulo.toLowerCase()}`);
    const r = await resolverTurno(p, antes);
    afirmar(r.guardado,
            `el avance no se movió ("${antes}"). Dictado: "${art.articulo}". `
            + `El agente se quedó en: "${r.dijo}"`);
  });

  await prueba('firma su conteo y ya no puede seguir contando', async () => {
    const boton = p.locator('button:has-text("Terminar y firmar mi conteo")').first();
    afirmar(await boton.isEnabled(), 'el botón de firmar sigue deshabilitado');
    await boton.click();
    await p.locator('.modal').first().waitFor({ timeout: 12000 });
    const aviso = (await p.locator('.modal').first().textContent()) || '';
    afirmar(/no podrá agregar/i.test(aviso), 'no advierte que la firma es definitiva');
    await p.locator('.modal button').filter({ hasText: /^Firmar$/ }).first().click();
    await p.locator('text=Conteo firmado').first().waitFor({ timeout: 25000 });
  });

  await contexto.close();
};
