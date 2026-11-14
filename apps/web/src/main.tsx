import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/inter";
import "./index.css";

import { startAppServices } from "./appInit";
import { AppRoot } from "./AppRoot";
import { whenLocaleReady } from "./i18n/runtime";
import { reloadOnceForChunkLoadError } from "./lib/chunkReloadGuard";
import { scheduleIdle } from "./lib/scheduleIdle";

const router = startAppServices();
const settingsRouteIds = ["/_chat/settings", "/_chat/settings/general"] as const;

let reloadScheduled = false;
window.addEventListener("vite:preloadError", (event) => {
  if (reloadOnceForChunkLoadError()) {
    reloadScheduled = true;
    event.preventDefault();
  }
});

const app = <AppRoot router={router} />;

// The root route awaits the auth request before the router touches any route chunk. Start the
// matched routes' chunks now so they load while that request is in flight.
for (const route of router.getMatchedRoutes(router.latestLocation.pathname).matchedRoutes) {
  void router.loadRouteChunk(route)?.catch(() => undefined);
}

export const startup = router
  .load()
  // Chained so settings have usually hydrated; English resolves without a chunk load.
  .then(whenLocaleReady)
  .then(() => {
    // Route chunk failures resolve router.load() and surface later through the error boundary.
    if (reloadScheduled) return;
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>{app}</React.StrictMode>,
    );
    scheduleIdle(() => {
      for (const id of settingsRouteIds) {
        void router.loadRouteChunk(router.routesById[id])?.catch(() => undefined);
      }
    });
  })
  .catch((error: unknown) => {
    if (reloadScheduled) return;
    throw error;
  });
