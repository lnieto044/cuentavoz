// Corre con: node --test src/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, v),
};

const { debeAbrirTutorial, marcarTutorialVisto } = await import("./tutorial.js");

test("debeAbrirTutorial es true la primera vez (nada guardado todavía)", () => {
  assert.equal(debeAbrirTutorial(11), true);
});

test("marcarTutorialVisto hace que debeAbrirTutorial pase a false, solo para ESE usuario", () => {
  marcarTutorialVisto(11);
  assert.equal(debeAbrirTutorial(11), false);
  // otro usuario en el mismo dispositivo (tablet compartida en bodega)
  // debe seguir viendo el video la primera vez que él entra.
  assert.equal(debeAbrirTutorial(22), true);
});
