import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/inter";
import "./index.css";

import { startAppServices } from "./appInit";
import { AppRoot } from "./AppRoot";
import { clearChunkReloadGuard, reloadOnceForChunkLoadError } from "./lib/chunkReloadGuard";
import { scheduleIdle } from "./lib/scheduleIdle";

const router = startAppServices();
const settingsRouteIds = ["/_chat/settings", "/_chat/settings/general"] as const;

let chunkLoadFailed = false;
let reloadScheduled = false;
window.addEventListener("vite:preloadError", (event) => {
  chunkLoadFailed = true;
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
  .then(() => {
    // Route chunk failures resolve router.load() and surface later through the error boundary.
    if (reloadScheduled) return;
    if (!chunkLoadFailed) clearChunkReloadGuard();
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
