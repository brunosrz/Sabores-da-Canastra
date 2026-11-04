import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Network } from "@capacitor/network";

export async function isOnline(): Promise<boolean> {
  if (!Capacitor.isNativePlatform())
    return typeof navigator === "undefined" || navigator.onLine;
  try {
    return (await Network.getStatus()).connected;
  } catch {
    return typeof navigator === "undefined" || navigator.onLine;
  }
}

/** Register listeners and return a cleanup function, including during async registration. */
export function watchLifecycle(
  onConnection: (online: boolean) => void,
  onResume: () => void,
): () => void {
  let disposed = false;
  const cleanups: Array<() => void> = [];
  const remember = (cleanup: () => void) => {
    if (disposed) cleanup();
    else cleanups.push(cleanup);
  };
  if (Capacitor.isNativePlatform()) {
    void Network.addListener("networkStatusChange", (status) => {
      if (!disposed) onConnection(status.connected);
    })
      .then((handle) =>
        remember(() => {
          void handle.remove();
        }),
      )
      .catch(() => {});
    void App.addListener("appStateChange", (state) => {
      if (!disposed && state.isActive) onResume();
    })
      .then((handle) =>
        remember(() => {
          void handle.remove();
        }),
      )
      .catch(() => {});
  } else {
    const online = () => onConnection(true);
    const offline = () => onConnection(false);
    const visible = () => {
      if (document.visibilityState === "visible") onResume();
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    remember(() => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    });
  }
  return () => {
    disposed = true;
    cleanups.splice(0).forEach((cleanup) => cleanup());
  };
}
