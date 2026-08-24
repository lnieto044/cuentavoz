import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // amazon-cognito-identity-js (via su dependencia "buffer") asume que
  // existe el global de Node "global" - en el navegador no existe, y sin
  // esto la app entera quedaba en blanco (ReferenceError: global is not
  // defined) apenas se importaba cognito.js. globalThis es el equivalente
  // real en cualquier entorno (navegador o Node).
  define: {
    global: "globalThis",
  },
  plugins: [
    react(),   // <-- con paréntesis
    // registra un service worker que deja cacheado el cascarón de la app
    // (HTML/JS/CSS/logos) la primera vez que carga con señal: después de
    // eso, la URL abre igual sin Wi-Fi - el problema real no es "la app se
    // cae sin internet", es que sin un service worker el navegador ni
    // siquiera puede pedir el archivo si no hay red la primera vez.
    // Las llamadas a la API (otro dominio: cuentavoz-api en Render) no se
    // cachean aquí - eso ya lo resuelve por su cuenta cada pantalla
    // (sesión guardada, catálogo local, cola de sincronización).
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["logo.png", "colsubsidio-blanco.png", "colsubsidio-color.png"],
      manifest: {
        name: "CuentaVoz · Colsubsidio",
        short_name: "CuentaVoz",
        description: "Asistente conversacional para la toma física de inventarios de Colsubsidio.",
        lang: "es-CO",
        start_url: "/",
        display: "standalone",
        background_color: "#F5F7FB",
        theme_color: "#0067B1",
        icons: [
          { src: "/logo.png", sizes: "203x203", type: "image/png" },
          { src: "/logo.png", sizes: "203x203", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // el rewrite de Render (/* -> /index.html) ya resuelve las rutas
        // de la SPA con red; navigateFallback hace lo mismo sin red.
        navigateFallback: "/index.html",
        // Los recorridos en video pesan varios megas cada uno. Precachearlos
        // obligaria a bajarlos completos la primera vez que alguien abre el
        // login, con datos de celular y en una bodega con mala señal, para
        // algo que quizas nunca abra. Se sirven a demanda (ver
        // VideoRecorrido.jsx, preload="metadata").
        globIgnores: ["**/recorrido*.mp4"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: {
    host: true,
    allowedHosts: true,
  },
});

