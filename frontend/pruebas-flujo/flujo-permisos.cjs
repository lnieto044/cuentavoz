/* Que el límite por bodega se sostenga desde el navegador, no solo en las
   pruebas del backend: lo que ve el menú, lo que ofrece la voz y lo que
   contesta la API cuando se le pide una bodega ajena a mano. */
const { entrar, irA } = require('./comun.cjs');

exports.titulo = 'Permisos por bodega';

exports.correr = async ({ navegador, WEB, API, prueba, afirmar }) => {
  const { contexto, p } = await entrar(navegador, WEB, 'stephanie');
  const token = await p.evaluate(() => localStorage.getItem('cv_token'));

  let mias = [];
  let ajena = null;

  await prueba('el auxiliar solo ve sus bodegas en el tablero', async () => {
    mias = await (await fetch(`${API}/api/bodegas`,
      { headers: { Authorization: `Bearer ${token}` } })).json();
    afirmar(Array.isArray(mias) && mias.length > 0, 'no ve ninguna bodega');
    afirmar(mias.length < 54, `ve ${mias.length} bodegas: no está restringido`);
  });

  await prueba('pedir una bodega ajena por su id devuelve 403', async () => {
    const propios = new Set(mias.map((b) => b.id));
    for (let id = 1; id <= 80 && ajena === null; id++) if (!propios.has(id)) ajena = id;
    afirmar(ajena !== null, 'no se encontró un id ajeno con que probar');

    for (const ruta of [`/api/bodegas/${ajena}/detalle`,
                        `/api/bodegas/${ajena}/articulos`,
                        `/api/bodegas/${ajena}/firmas`]) {
      const r = await fetch(API + ruta, { headers: { Authorization: `Bearer ${token}` } });
      afirmar(r.status === 403 || r.status === 404,
              `${ruta} respondió ${r.status} en vez de 403`);
    }
  });

  await prueba('el respaldo del agente no abre una bodega ajena', async () => {
    const r = await fetch(`${API}/api/agente/turno`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: 'hay diez unidades de algo', sesion_id: 999123,
                             bodega_id_respaldo: ajena }),
    });
    afirmar(r.status === 403, `respondió ${r.status}: se pudo entrar por el respaldo`);
  });

  await prueba('un auxiliar no alcanza lo que es solo de administrador', async () => {
    afirmar(await p.locator('.sidebar li > button')
      .filter({ hasText: /Auditoría|Panel|Reportes|Ajustes/ }).count() === 0,
      'el menú le muestra opciones de administrador');
    for (const ruta of ['/api/reportes/recientes', '/api/pedidos/pendientes']) {
      const r = await fetch(API + ruta, { headers: { Authorization: `Bearer ${token}` } });
      afirmar(r.status === 403, `${ruta} respondió ${r.status} en vez de 403`);
    }
  });

  await prueba('sin sesión no se alcanza nada', async () => {
    const r = await fetch(`${API}/api/bodegas`);
    afirmar(r.status === 401 || r.status === 403, `respondió ${r.status}`);
  });

  await irA(p, 'Conteo');
  await contexto.close();
};
