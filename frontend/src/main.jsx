import React from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";

// Apagado por defecto (sin VITE_SENTRY_DSN, Sentry.init() nunca llama a
// ningun lado) - el ErrorBoundary de abajo es inofensivo sin DSN, solo no
// reporta nada. Activarlo en produccion es poner la variable de entorno,
// sin tocar codigo.
const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) Sentry.init({ dsn, tracesSampleRate: 0 });

createRoot(document.getElementById("root")).render(
  <Sentry.ErrorBoundary fallback={<p style={{ padding: 20 }}>Ocurrió un error. Recargue la página.</p>}>
    <App />
  </Sentry.ErrorBoundary>
);
