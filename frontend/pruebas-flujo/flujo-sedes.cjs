/* Las sedes desde la pantalla: crearlas, meterles bodegas y repartir una
   entera de un clic — que es el motivo por el que existen.

   Y lo más importante de todo: comprobar que agrupar dos bodegas en la
   misma sede NO le da a nadie acceso a la que no tiene asignada. La sede
   organiza; el permiso lo sigue decidiendo la asignación. */
const { entrar, irA } = require('./comun.cjs');

exports.titulo = 'Sedes (administradora)';

exports.correr = async ({ navegador, WEB, API, prueba, afirmar }) => {
  const { contexto, p } = await entrar(navegador, WEB, 'diana');
  const token = await p.evaluate(() => localStorage.getItem('cv_token'));
  const cab = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let sedeId = null;
  let bodegasDeLaSede = [];

  await prueba('las bodegas que ya existían no tienen sede', async () => {
    const r = await (await fetch(`${API}/api/sedes`, { headers: cab })).json();
    afirmar(r.bodegas_sin_sede > 0,
            'la migración se inventó sedes para bodegas que ya existían');
  });

  await prueba('se crea una sede desde Ajustes', async () => {
    await irA(p, 'Ajustes');
    await p.locator('.sidebar li > button').filter({ hasText: 'Ajustes' }).first().click();
    await p.waitForTimeout(1200);
    const pestana = p.locator('button').filter({ hasText: /Usuarios|Gestión de usuarios/ }).first();
    if (await pestana.count()) { await pestana.click(); await p.waitForTimeout(1500); }

    const nueva = p.locator('button:has-text("+ Nueva sede")').first();
    await nueva.waitFor({ timeout: 20000 });
    await nueva.click();
    await p.locator('#sede-nombre').waitFor({ timeout: 10000 });
    await p.locator('#sede-nombre').fill('Piscilago');
    await p.locator('#sede-ciudad').fill('Girardot');
    await p.locator('.modal button').filter({ hasText: /^Crear$/ }).first().click();
    await p.waitForTimeout(2500);

    const r = await (await fetch(`${API}/api/sedes`, { headers: cab })).json();
    const sd = (r.sedes || []).find((x) => x.nombre === 'PISCILAGO');
    afirmar(sd, `no se creó: ${JSON.stringify(r.sedes)}`);
    afirmar(sd.ciudad === 'Girardot', `la ciudad quedó como "${sd.ciudad}"`);
    sedeId = sd.id;
  });

  await prueba('se le meten bodegas', async () => {
    const bodegas = await (await fetch(`${API}/api/bodegas`, { headers: cab })).json();
    bodegasDeLaSede = bodegas.slice(0, 3).map((b) => b.id);
    for (const id of bodegasDeLaSede) {
      const r = await fetch(`${API}/api/bodegas/${id}/sede`,
                            { method: 'PUT', headers: cab, body: JSON.stringify({ sede_id: sedeId }) });
      afirmar(r.ok, `no se pudo asignar la bodega ${id} (${r.status})`);
    }
    const r = await (await fetch(`${API}/api/sedes`, { headers: cab })).json();
    const sd = r.sedes.find((x) => x.id === sedeId);
    afirmar(sd.bodegas === 3, `la sede quedó con ${sd.bodegas} bodegas`);
  });

  await prueba('la sede NO da acceso a una bodega no asignada', async () => {
    // lo esencial: agrupar no reparte permisos
    const aux = await entrar(navegador, WEB, 'stephanie');
    const tokenAux = await aux.p.evaluate(() => localStorage.getItem('cv_token'));
    const mias = new Set((await (await fetch(`${API}/api/bodegas`,
      { headers: { Authorization: `Bearer ${tokenAux}` } })).json()).map((b) => b.id));

    const ajenaEnLaSede = bodegasDeLaSede.find((id) => !mias.has(id));
    if (ajenaEnLaSede) {
      const r = await fetch(`${API}/api/bodegas/${ajenaEnLaSede}/detalle`,
                            { headers: { Authorization: `Bearer ${tokenAux}` } });
      afirmar(r.status === 403,
              `la sede le abrió una bodega ajena (respondió ${r.status})`);
    }
    await aux.contexto.close();
  });

  await prueba('marcar la sede entera al repartir la ofrece completa', async () => {
    const ids = await (await fetch(`${API}/api/sedes/${sedeId}/bodegas`, { headers: cab })).json();
    afirmar(Array.isArray(ids) && ids.length === 3,
            `la sede ofreció ${JSON.stringify(ids)} en vez de sus 3 bodegas`);
  });

  await prueba('eliminar la sede deja las bodegas en su sitio', async () => {
    const r = await fetch(`${API}/api/sedes/${sedeId}`, { method: 'DELETE', headers: cab });
    afirmar(r.ok, `no se pudo eliminar (${r.status})`);

    const bodegas = await (await fetch(`${API}/api/bodegas`, { headers: cab })).json();
    for (const id of bodegasDeLaSede) {
      const b = bodegas.find((x) => x.id === id);
      afirmar(b, `la bodega ${id} desapareció al borrar la sede`);
      afirmar(b.sede_id === null, `la bodega ${id} quedó apuntando a una sede borrada`);
    }
  });

  await contexto.close();
};
