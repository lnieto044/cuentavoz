// Corre con: node --test src/*.test.js
// node:test no trae localStorage/document (a diferencia del navegador) -
// se simulan aquí mismo con lo mínimo que accesibilidad.js necesita.
import { test } from "node:test";
import assert from "node:assert/strict";

const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, v),
};
const atributos = {};
globalThis.document = {
  documentElement: {
    setAttribute: (k, v) => { atributos[k] = v; },
  },
};

const { leerPreferencias, guardarPreferencias, aplicarPreferencias } =
  await import("./accesibilidad.js");

test("leerPreferencias devuelve {} cuando no hay nada guardado", () => {
  assert.deepEqual(leerPreferencias(), {});
});

test("leerPreferencias devuelve {} si lo guardado no es JSON válido", () => {
  almacen.set("cv_accesibilidad", "no-es-json");
  assert.deepEqual(leerPreferencias(), {});
  almacen.delete("cv_accesibilidad");
});

test("guardarPreferencias y leerPreferencias hacen ida y vuelta", () => {
  guardarPreferencias({ contraste: true, tamano: "grande" });
  assert.deepEqual(leerPreferencias(), { contraste: true, tamano: "grande" });
});

test("aplicarPreferencias pone data-contraste=alto solo si contraste es true", () => {
  aplicarPreferencias({ contraste: true, tamano: "grande" });
  assert.equal(atributos["data-contraste"], "alto");
  assert.equal(atributos["data-tamano"], "grande");
  aplicarPreferencias({ contraste: false, tamano: "" });
  assert.equal(atributos["data-contraste"], "");
  assert.equal(atributos["data-tamano"], "");
});
