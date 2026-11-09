import { showBootError } from "./lib/bootError";

// Shared dev chunks need the React refresh preamble first. Catch failures before React mounts.
const backendReady =
  window.desktopBridge?.awaitBackendReady?.().catch(() => undefined) ?? Promise.resolve();

void backendReady
  .then(() => import("./main"))
  .then(({ startup }) => startup)
  .catch(showBootError);
