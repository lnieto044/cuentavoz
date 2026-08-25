# Recorridos completos de la aplicación

`npm test` prueba **lógica pura**: el intérprete local, la cola sin conexión,
la confirmación por voz, las preferencias de accesibilidad. Son rápidas y
valen, pero no habrían detectado que «Cerrar bodega definitivamente» era
inalcanzable — cada pieza por separado funcionaba y sus pruebas pasaban; lo
que faltaba era que **ninguna pantalla llamaba** al endpoint que pone la
primera firma. Eso solo aparece recorriendo el flujo entero.

Esto levanta la aplicación de verdad y la recorre como lo haría una persona.

## Cómo se corre

```
npm install playwright        # no es dependencia del proyecto
npx playwright install chromium

node frontend/pruebas-flujo/correr.cjs
node frontend/pruebas-flujo/correr.cjs --ver     # con el navegador a la vista
```

No hay que levantar nada a mano: `correr.cjs` arranca el backend y vite en
puertos propios (8011 y 5193), así que puede correrse **sin bajar** lo que ya
tenga abierto en desarrollo. Sale con código 0 si todo pasa.

## Sobre una copia de la base

El recorrido abre bodegas, cuenta, firma y cierra **de verdad**. Todo eso
ocurre sobre una copia de `backend/cuentavoz.db` en el directorio temporal,
que se borra al terminar. La base de la demo no se toca.

Esto no fue así desde el principio: la primera versión corría contra la base
real y le dejaba sesiones a medias y bodegas en estados raros. Se descubrió
comparando la base antes y después — nadie avisa de eso. Por eso el arranque
aislado vive en `entorno.cjs` y lo usan también las auditorías de
`docs/accesibilidad/`: **cualquier cosa que recorra la aplicación sola
debería pasar por ahí**.

## Qué cubre

| Archivo | Recorrido |
| --- | --- |
| `flujo-conteo.cjs` | El auxiliar entra, abre una bodega asignada, dicta un artículo, resuelve la desambiguación («¿cuál de los dos?»), confirma y firma su conteo. |
| `flujo-pedidos.cjs` | Elegir un plato con receta, decir las porciones y ver los insumos calculados contra el stock real. |
| `flujo-auditoria.cjs` | Recuento ciego, comparación de las tres columnas, firma de la auditoría y cierre con doble firma — hasta ver la bodega en estado `cerrada`. |
| `flujo-permisos.cjs` | Que el límite por bodega se sostenga desde el navegador: el tablero, los ids ajenos a mano, el respaldo del agente y lo que es solo de administrador. |

Los cuatro corren en ese orden a propósito: la auditoría necesita una bodega
que el auxiliar acabe de firmar.

## Al escribir un recorrido nuevo

- **Nunca esperar un rato fijo al agente.** Si hay `GOOGLE_API_KEY`, cada
  turno intenta primero con Gemini y solo cae al intérprete local cuando ese
  intento se agota: una respuesta puede tardar bastantes segundos. Las
  primeras versiones de estas pruebas fallaban por eso, sobre respuestas que
  llegaban bien un segundo después. Use `decir()`, `pulsar()` o
  `esperarRespuestaNueva()` de `comun.cjs`, que esperan a que la respuesta
  **cambie**.
- **Dictar artículos con nombre dictable.** El catálogo real trae cosas como
  `AFVT) ANTIMICROBIANO FRUTAS Y VERDURAS`. Ver `articuloDictable()`.
- **Ubicar por contenido, no por posición.** `.card` primero es casi siempre
  la del agente, no la que se busca. Filtre por texto.
- Si una prueba falla, el mensaje debe decir **qué contestó la aplicación**,
  no solo que no pasó lo esperado. Media hora de esta sesión se fue en
  fallos que solo decían «el avance no se movió».
