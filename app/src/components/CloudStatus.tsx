// Small, non-intrusive cloud-sync UI (M2): a one-time "import your local data" prompt and
// a transient sync-error banner. Reads ephemeral flags from the store; no-ops in local mode.
import { useStore, resolveImport, retrySync } from "../lib/store";

export function CloudStatus() {
  const importAvailable = useStore((s) => s.importAvailable);
  const syncError = useStore((s) => s.syncError);
  const loading = useStore((s) => s.loading);

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
