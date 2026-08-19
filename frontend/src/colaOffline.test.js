// Corre con: node --test src/*.test.js
// node:test no trae localStorage/window (a diferencia del navegador) -
// se simulan aquí mismo, con lo mínimo que colaOffline.js necesita, en vez
// de meter jsdom solo para esto.
import { test } from "node:test";
import assert from "node:assert/strict";

const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, v),
};
let eventosDisparados = [];
globalThis.window = {
  dispatchEvent: (e) => eventosDisparados.push(e.type),
};
globalThis.Event = class { constructor(tipo) { this.type = tipo; } };

const { leerCola, guardarCola, CLAVE_COLA, EVENTO_COLA } = await import("./colaOffline.js");

test("leerCola devuelve [] cuando no hay nada guardado", () => {
  assert.deepEqual(leerCola("nueva-sesion"), []);
});

test("leerCola devuelve [] si lo guardado no es JSON válido (corrupción de localStorage)", () => {
  almacen.set(CLAVE_COLA("rota"), "{no es json");
  assert.deepEqual(leerCola("rota"), []);
});

test("guardarCola y leerCola hacen ida y vuelta con los mismos datos", () => {
  const items = [{ articulo: "ARROZ", cantidad: 5, unidad: "Kilogram" }];
  guardarCola("s1", items);
  assert.deepEqual(leerCola("s1"), items);
});

test("guardarCola dispara el evento para que otras pantallas se enteren", () => {
  eventosDisparados = [];
  guardarCola("s2", []);
  assert.ok(eventosDisparados.includes(EVENTO_COLA));
});

test("la cola es independiente por sesión", () => {
  guardarCola("sesion-a", [{ articulo: "A" }]);
  guardarCola("sesion-b", [{ articulo: "B" }]);
  assert.deepEqual(leerCola("sesion-a"), [{ articulo: "A" }]);
  assert.deepEqual(leerCola("sesion-b"), [{ articulo: "B" }]);
});
