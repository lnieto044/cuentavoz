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
  assert.equal(debeAbrirTutorial(), true);
});

test("marcarTutorialVisto hace que debeAbrirTutorial pase a false", () => {
  marcarTutorialVisto();
  assert.equal(debeAbrirTutorial(), false);
});
