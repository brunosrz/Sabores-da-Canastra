import { useEffect, type ReactNode } from "react";

export function PwaRuntime({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  useEffect(() => {
    if ("storage" in navigator && "persist" in navigator.storage) {
      void navigator.storage.persist().catch(() => false);
    }
    if (!enabled || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .catch((error) => {
        console.error("Não foi possível registrar o modo instalável.", error);
      });
  }, [enabled]);
  return children;
}
