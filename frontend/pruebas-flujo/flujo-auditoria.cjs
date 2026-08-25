/* El control de calidad completo: recuento ciego, comparación y cierre
   con doble firma, recorrido por la pantalla y no por la API.

   Este es el recorrido que habría atrapado que «Cerrar bodega
   definitivamente» era inalcanzable: cada endpoint funcionaba por
   separado y sus pruebas pasaban, pero ninguna pantalla llamaba al que
   pone la primera firma. */
const { entrar, irA, respuesta, esperarRespuestaNueva,
        ESPERA_AGENTE } = require('./comun.cjs');

exports.titulo = 'Auditoría y cierre (administradora)';

exports.correr = async ({ navegador, WEB, API, prueba, afirmar }) => {
  const { contexto, p } = await entrar(navegador, WEB, 'diana');
  const token = await p.evaluate(() => localStorage.getItem('cv_token'));
  const cab = { Authorization: `Bearer ${token}` };
  let bodegaId = null;
  let bodegaNombre = null;

  const firmasDe = async (id) =>
    (await fetch(`${API}/api/bodegas/${id}/firmas`, { headers: cab })).json();

  await prueba('la administradora sí ve Auditoría y Panel', async () => {
    for (const opcion of ['Auditoría', 'Panel', 'Reportes', 'Ajustes']) {
      afirmar(await p.locator('.sidebar li > button')
        .filter({ hasText: opcion }).count() > 0, `no ve ${opcion}`);
    }
  });

  await prueba('encuentra la bodega que el auxiliar acaba de firmar', async () => {
    const bodegas = await (await fetch(`${API}/api/bodegas`, { headers: cab })).json();
    for (const b of bodegas) {
      const f = await firmasDe(b.id);
      if (f?.conteo?.firmada && !f?.auditoria?.firmada && b.estado !== 'cerrada') {
        bodegaId = b.id; bodegaNombre = b.bodega; break;
      }
    }
    afirmar(bodegaId !== null,
            'ninguna bodega con el conteo firmado y la auditoría pendiente');
  });

  await prueba('la pantalla la ofrece para auditar', async () => {
    await irA(p, 'Auditoría');
    const fila = p.locator('.registro').filter({ hasText: bodegaNombre }).first();
    await fila.waitFor({ timeout: 20000 });
    await fila.locator('button:has-text("Abrir")').click();
    await p.waitForTimeout(2500);
  });

  await prueba('el recuento ciego arranca desde la pantalla', async () => {
    const iniciar = p.locator('button:has-text("Iniciar recuento ciego")').first();
    afirmar(await iniciar.count() > 0, 'la pantalla no ofrece iniciar el recuento ciego');
    const antes = await respuesta(p);
    await iniciar.click();
    const dijo = await esperarRespuestaNueva(p, antes);
    afirmar(/recuento ciego iniciado/i.test(dijo), `el agente dijo: "${dijo}"`);
  });

  await prueba('con una sola firma el cierre se niega', async () => {
    const r = await fetch(`${API}/api/bodegas/${bodegaId}/cerrar`,
                          { method: 'POST', headers: cab });
    afirmar(r.status === 409, `cerró sin la segunda firma (respondió ${r.status})`);
  });

  await prueba('la comparación revela las tres columnas', async () => {
    // el recuento ciego no muestra el conteo del auxiliar mientras se
    // cuenta; solo al pedir la comparación se revelan los tres números
    const ver = p.locator('button:has-text("Ver comparación")').first();
    afirmar(await ver.count() > 0, 'la pantalla no ofrece ver la comparación');
    await ver.click();
    // la tarjeta de la comparación no es la primera de la pantalla: arriba
    // está la del agente. Se busca por su contenido, no por su posición.
    const tabla = p.locator('.card').filter({ hasText: /Diferencia/i }).first();
    await tabla.waitFor({ timeout: 25000 });
    const encabezados = (await tabla.textContent()) || '';
    for (const columna of ['Artículo', 'Conteo 1', 'Diferencia']) {
      afirmar(encabezados.includes(columna),
              `falta la columna "${columna}" en la comparación`);
    }
  });

  await prueba('firma la auditoría desde la pantalla de doble firma', async () => {
    await p.locator('button:has-text("Cerrar con doble firma")').first().click();
    await p.waitForTimeout(2000);
    const firmar = p.locator('button:has-text("Firmar la auditoría")').first();
    afirmar(await firmar.count() > 0, 'no aparece el botón de firmar la auditoría');
    await firmar.click();
    await p.waitForTimeout(3000);

    const f = await firmasDe(bodegaId);
    afirmar(f?.auditoria?.firmada, 'la auditoría no quedó firmada');
    afirmar(f.lista_para_cerrar, 'con las dos firmas sigue diciendo que no está lista');
  });

  await prueba('con las dos firmas, la bodega cierra desde la pantalla', async () => {
    const cerrar = p.locator('button:has-text("Cerrar bodega definitivamente")').first();
    afirmar(await cerrar.count() > 0, 'no aparece el botón de cerrar');
    afirmar(await cerrar.isEnabled(), 'el botón de cerrar sigue deshabilitado');
    await cerrar.click();
    await p.waitForTimeout(4000);

    const hasta = Date.now() + ESPERA_AGENTE;
    let estado = null;
    while (Date.now() < hasta) {
      const bodegas = await (await fetch(`${API}/api/bodegas`, { headers: cab })).json();
      estado = (bodegas.find((x) => x.id === bodegaId) || {}).estado;
      if (estado === 'cerrada') break;
      await p.waitForTimeout(800);
    }
    afirmar(estado === 'cerrada', `quedó en estado "${estado}"`);
  });

  await contexto.close();
};
