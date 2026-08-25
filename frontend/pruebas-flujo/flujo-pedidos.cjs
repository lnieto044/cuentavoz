/* Armar un pedido: elegir un plato con receta, decir para cuántas
   porciones y ver los insumos calculados contra el stock real. */
const { entrar, irA } = require('./comun.cjs');

exports.titulo = 'Pedidos (auxiliar)';

exports.correr = async ({ navegador, WEB, prueba, afirmar }) => {
  const { contexto, p } = await entrar(navegador, WEB, 'stephanie');
  await irA(p, 'Pedidos');

  await prueba('ofrece los platos que sabe calcular', async () => {
    const chips = p.locator('.card').filter({ hasText: 'Platos con receta' })
      .locator('button.chip');
    afirmar(await chips.count() > 0, 'no hay ningún plato con receta registrada');
  });

  await prueba('elegir un plato pregunta las porciones', async () => {
    await p.locator('.card').filter({ hasText: 'Platos con receta' })
      .locator('button.chip').first().click();
    await p.locator('.modal').first().waitFor({ timeout: 15000 });
    const titulo = (await p.locator('.modal').first().textContent()) || '';
    afirmar(/porciones/i.test(titulo), `el diálogo dice: "${titulo.slice(0, 60)}"`);
  });

  await prueba('calcula los insumos para esas porciones', async () => {
    await p.locator('.modal textarea, .modal input').first().fill('4');
    await p.locator('.modal button').filter({ hasText: /^Aceptar$/ }).first().click();
    await p.waitForTimeout(4000);

    // el cálculo puede dispararse solo al aceptar; si no, con el botón
    const yaSalio = await p.locator('.card').filter({ hasText: /Insumos calculados/i }).count();
    if (!yaSalio) {
      await p.locator('button:has-text("Calcular el pedido")').first().click();
      await p.waitForTimeout(5000);
    }
    const tarjeta = p.locator('.card').filter({ hasText: /Insumos calculados/i }).first();
    afirmar(await tarjeta.count() > 0,
            'no apareció la tarjeta de insumos calculados');
    const filas = await tarjeta.locator('tbody tr, .registro').count();
    afirmar(filas > 0, 'la tarjeta de insumos salió vacía');
  });

  await prueba('el pedido se puede enviar al almacén', async () => {
    const enviar = p.locator('button:has-text("Enviar pedido al almacén")').first();
    afirmar(await enviar.count() > 0, 'no hay botón para enviar el pedido');
    afirmar(await enviar.isEnabled(), 'el botón de enviar está deshabilitado');
  });

  await contexto.close();
};
