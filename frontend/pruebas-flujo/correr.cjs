/* Levanta la aplicación entera y la recorre como lo haría una persona.
 *
 *  Las pruebas de `npm test` son de lógica pura: el intérprete local, la
 *  cola sin conexión, la confirmación por voz. Valen, pero no habrían
 *  detectado que «Cerrar bodega definitivamente» era inalcanzable, porque
 *  cada pieza por separado funcionaba — lo que faltaba era que nadie
 *  llamara a una de ellas. Eso solo aparece recorriendo el flujo.
 *
 *  Sobre una COPIA de la base: el recorrido cuenta, firma y cierra
 *  bodegas de verdad, y sería inaceptable que dejara la demo revuelta.
 *  La copia se borra al terminar.
 *
 *      node frontend/pruebas-flujo/correr.js
 *      node frontend/pruebas-flujo/correr.js --ver     (con navegador visible)
 */
const path = require('path');
const { levantar } = require('./entorno.cjs');

const PUERTO_API = 8011;          // aparte de los de desarrollo, para poder
const PUERTO_WEB = 5193;          // correr esto sin bajar lo que este abierto
const VER = process.argv.includes('--ver');
let entorno = null;

// ── el marcador ──
let ok = 0; const fallos = [];
async function prueba(nombre, fn) {
  const t0 = Date.now();
  try {
    await fn();
    ok++;
    console.log(`  ok    ${nombre}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    fallos.push({ nombre, error: e.message });
    console.log(`  FALLA ${nombre}\n          ${e.message.split('\n')[0]}`);
  }
}
function afirmar(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }

module.exports = { VER, prueba, afirmar };

// ── arranque ──
if (require.main === module) {
  (async () => {
    console.log('\nRecorrido completo de CuentaVoz\n');
    entorno = await levantar({ puertoApi: PUERTO_API, puertoWeb: PUERTO_WEB });
    const { API, WEB } = entorno;
    const { chromium } = require('playwright');
    const navegador = await chromium.launch({ headless: !VER, slowMo: VER ? 120 : 0 });

    for (const archivo of ['flujo-conteo.cjs', 'flujo-pedidos.cjs',
                           'flujo-auditoria.cjs', 'flujo-permisos.cjs',
                           'flujo-sedes.cjs']) {
      const grupo = require(path.join(__dirname, archivo));
      console.log(`\n── ${grupo.titulo} ──`);
      await grupo.correr({ navegador, WEB, API, prueba, afirmar });
    }

    await navegador.close();
    console.log(`\n══ ${ok} bien, ${fallos.length} mal ══`);
    fallos.forEach((f) => console.log(`  · ${f.nombre}: ${f.error.split('\n')[0]}`));
    entorno.bajar();
    process.exit(fallos.length ? 1 : 0);
  })().catch((e) => {
    console.error('\nEXPLOTO:', e.message);
    if (entorno) entorno.bajar();
    process.exit(1);
  });
}
