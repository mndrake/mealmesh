// Small, non-intrusive cloud-sync UI (M2; offline added M4): a one-time "import your local
// data" prompt, an offline notice, a transient sync-error banner, and a loading note.
// Reads ephemeral flags from the store; no-ops in local mode.
import { useEffect, useState } from "react";
import { useStore, resolveImport, retrySync, isCloud } from "../lib/store";

/** Track browser connectivity (SSR-safe: assumes online when navigator is absent). */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function CloudStatus() {
  const importAvailable = useStore((s) => s.importAvailable);
  const syncError = useStore((s) => s.syncError);
  const loading = useStore((s) => s.loading);
  const online = useOnline();

  if (importAvailable) {
    return (
      <div className="cloud-banner">
        <span>
          You have an existing plan &amp; favorites saved on this device. Import them to your
          family's synced account?
        </span>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn small" onClick={() => void resolveImport(true)}>
            Import
          </button>
          <button className="btn ghost small" onClick={() => void resolveImport(false)}>
            Keep cloud (discard local)
          </button>
        </div>
      </div>
    );
  }

  // Offline takes priority over the sync-error banner (the error is just a symptom of it).
  if (isCloud() && !online) {
    return (
      <div className="cloud-banner muted-banner">
        You're offline — changes are saved on this device and will sync when you reconnect.
      </div>
    );
  }

  if (syncError) {
    return (
      <div className="cloud-banner error">
        <span>Couldn't sync your latest change — your edits are saved on this device.</span>
        <button className="btn ghost small" onClick={retrySync}>
          Retry
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="cloud-banner muted-banner">Syncing your family's plan…</div>;
  }

  return null;
}
