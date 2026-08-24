// Corre con: node --test src/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, v),
  removeItem: (k) => almacen.delete(k),
};

const { debeAbrirTutorial, deshabilitarTutorial, habilitarTutorial } =
  await import("./tutorial.js");

test("debeAbrirTutorial es true por defecto (nadie lo ha desactivado)", () => {
  assert.equal(debeAbrirTutorial(11), true);
});

test("deshabilitarTutorial hace que debeAbrirTutorial pase a false, solo para ESE usuario", () => {
  deshabilitarTutorial(11);
  assert.equal(debeAbrirTutorial(11), false);
  // otro usuario en el mismo dispositivo (tablet compartida en bodega)
  // debe seguir viendo el video: la desactivacion es por persona.
  assert.equal(debeAbrirTutorial(22), true);
});

test("habilitarTutorial revierte la desactivacion", () => {
  deshabilitarTutorial(33);
  assert.equal(debeAbrirTutorial(33), false);
  habilitarTutorial(33);
  assert.equal(debeAbrirTutorial(33), true);
});
