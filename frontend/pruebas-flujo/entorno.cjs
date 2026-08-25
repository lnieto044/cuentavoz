/* Levanta la aplicación entera sobre una COPIA de la base y la baja al
 * terminar.
 *
 * Existe porque la primera versión de estas herramientas corría contra la
 * base de la demo: abría bodegas, contaba y firmaba de verdad, y dejaba
 * la demo con sesiones a medias y bodegas en estados raros. Eso se
 * descubrió comparando la base antes y después — no lo avisa nadie.
 * Cualquier cosa que recorra la aplicación de forma automática debería
 * pasar por aquí.
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RAIZ = path.resolve(__dirname, '..', '..');

function python() {
  return process.platform === 'win32'
    ? path.join(RAIZ, 'backend', '.venv', 'Scripts', 'python.exe')
    : path.join(RAIZ, 'backend', '.venv', 'bin', 'python');
}

async function esperarA(url, segundos = 90) {
  for (let i = 0; i < segundos * 2; i++) {
    try { if ((await fetch(url)).ok) return true; } catch (_) { /* aún no */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Devuelve { API, WEB, bajar } con la aplicación ya respondiendo. */
async function levantar({ puertoApi = 8011, puertoWeb = 5193, silencioso = false } = {}) {
  const API = `http://127.0.0.1:${puertoApi}`;
  const WEB = `http://localhost:${puertoWeb}`;
  const procesos = [];
  const copia = path.join(os.tmpdir(), `cuentavoz-pruebas-${Date.now()}.db`);

  const original = path.join(RAIZ, 'backend', 'cuentavoz.db');
  if (!fs.existsSync(original)) {
    throw new Error('No encuentro backend/cuentavoz.db (ver LEEME_PRIMERO.md).');
  }
  fs.copyFileSync(original, copia);
  if (!silencioso) {
    console.log(`  base de pruebas: ${path.basename(copia)} (copia, se borra al final)`);
  }

  procesos.push(spawn(python(), ['-m', 'uvicorn', 'main:app', '--port', String(puertoApi)], {
    cwd: path.join(RAIZ, 'backend'),
    env: { ...process.env,
           DB_URL: `sqlite:///${copia.replace(/\\/g, '/')}`,
           SEMBRAR_DEMO: '1',
           ORIGEN_PERMITIDO: `${WEB},http://127.0.0.1:${puertoWeb}` },
    stdio: 'ignore',
  }));

  procesos.push(spawn('npx', ['vite', '--port', String(puertoWeb), '--strictPort'], {
    cwd: path.join(RAIZ, 'frontend'),
    env: { ...process.env, VITE_API_URL: API },
    stdio: 'ignore', shell: true,
  }));

  function bajar() {
    for (const p of procesos) { try { p.kill(); } catch (_) {} }
    if (process.platform === 'win32') {
      for (const p of procesos) {
        try { execSync(`taskkill /F /T /PID ${p.pid}`, { stdio: 'ignore' }); } catch (_) {}
      }
    }
    try { fs.unlinkSync(copia); } catch (_) {}
  }
  process.on('exit', bajar);
  process.on('SIGINT', () => { bajar(); process.exit(130); });

  if (!await esperarA(`${API}/api/salud`)) { bajar(); throw new Error('el backend no levantó'); }
  if (!await esperarA(WEB)) { bajar(); throw new Error('vite no levantó'); }
  if (!silencioso) console.log('  aplicación arriba\n');

  return { API, WEB, bajar, RAIZ };
}

module.exports = { levantar, RAIZ };
