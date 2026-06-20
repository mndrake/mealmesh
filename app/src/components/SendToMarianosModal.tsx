// "Send to Mariano's" flow: connect (OAuth) -> pick store -> review matched products
// (swap/remove/qty) -> choose pickup/delivery -> send to cart -> open cart. We only add
// items; the user reviews and checks out on Mariano's.
import { useEffect, useState } from "react";
import type { ShoppingList } from "../lib/shopping";
import { krogerClient, type ReviewRow, type KrogerStore } from "../lib/krogerClient";

type Step = "loading" | "needs-auth" | "store" | "review" | "sending" | "done" | "error";

export function SendToMarianosModal({ list, onClose }: { list: ShoppingList; onClose: () => void }) {
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [stores, setStores] = useState<KrogerStore[]>([]);
  const [zip, setZip] = useState("");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [modality, setModality] = useState("PICKUP");
  const [added, setAdded] = useState(0);

  // Non-staple shopping items to match (staples are "check pantry", not bought here).
  const items = list.sections.flatMap((s) => s.items).map(([name, displayQty]) => ({ name, displayQty }));

  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
    setStep("error");
  }

  async function startReview() {
    setStep("loading");
    try {
      const { rows } = await krogerClient.match(items);
      setRows(rows);
      setStep("review");
    } catch (e) {
      if (e instanceof Error && e.message === "no_store") setStep("store");
      else fail(e);
    }
  }

  useEffect(() => {
    krogerClient
      .status()
      .then((s) => {
        if (!s.connected) return setStep("needs-auth");
        setModality(s.modality || "PICKUP");
        setStoreName(s.storeName);
        if (s.storeName) void startReview();
        else setStep("store");
      })
      .catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    try {
      const { url } = await krogerClient.authUrl();
      window.location.href = url; // full-page redirect to Kroger; returns to /?kroger=connected
    } catch (e) {
      fail(e);
    }
  }

  async function findStores() {
    try {
      setStores((await krogerClient.locations(zip)).stores);
    } catch (e) {
      fail(e);
    }
  }

  async function chooseStore(s: KrogerStore) {
    try {
      await krogerClient.saveLocation(s.locationId, s.name);
      setStoreName(s.name);
      void startReview();
    } catch (e) {
      fail(e);
    }
  }

  function update(i: number, patch: Partial<ReviewRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function swap(i: number, upc: string) {
    setRows((rs) =>
      rs.map((r, idx) => {
        if (idx !== i || !r.matched) return r;
        const all = [r.matched, ...r.alternates];
        const chosen = all.find((m) => m.upc === upc) ?? r.matched;
        return { ...r, matched: chosen, alternates: all.filter((m) => m.upc !== chosen.upc) };
      })
    );
  }

  async function send() {
    setStep("sending");
    const payload = rows
      .filter((r) => r.include && r.matched)
      .map((r) => ({ upc: r.matched!.upc, quantity: r.quantity }));
    try {
      const res = await krogerClient.cart(payload, modality);
      setAdded(res.added);
      setStep("done");
    } catch (e) {
      fail(e);
    }
  }

  const includedCount = rows.filter((r) => r.include && r.matched).length;
  const skipped = rows.filter((r) => !r.matched).length;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="content">
          <h2 style={{ marginTop: 0 }}>🛒 Send to Mariano's</h2>

          {step === "loading" && <p className="muted">Loading…</p>}
          {step === "error" && <p className="login-error">Something went wrong: {error}</p>}

          {step === "needs-auth" && (
            <>
              <p>
                Connect your Kroger / Mariano's account once so MealMesh can build your cart.
                We only <strong>add items</strong> — you review and check out on Mariano's. The
                one-time login and final checkout stay with you.
              </p>
              <button className="btn" onClick={connect}>
                Connect to Kroger
              </button>
            </>
          )}

          {step === "store" && (
            <>
              <p>Pick your Mariano's store.</p>
              <div className="row">
                <input
                  className="search"
                  placeholder="ZIP (optional)"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  style={{ maxWidth: 160 }}
                />
                <button className="btn secondary" onClick={findStores}>
                  Find stores
                </button>
              </div>
              {stores.map((s) => (
                <div key={s.locationId} className="shop-item">
                  <label style={{ flex: 1 }}>
                    {s.name} <span className="muted">— {s.address}</span>
                  </label>
                  <button className="btn small" onClick={() => chooseStore(s)}>
                    Choose
                  </button>
                </div>
              ))}
            </>
          )}

          {step === "review" && (
            <>
              <p className="muted">
                {storeName} · {includedCount} item{includedCount === 1 ? "" : "s"} to add
                {skipped ? ` · ${skipped} with no match` : ""}
              </p>
              <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                {["PICKUP", "DELIVERY"].map((m) => (
                  <button
                    key={m}
                    className={`toggle ${modality === m ? "on" : ""}`}
                    onClick={() => setModality(m)}
                  >
                    {m.toLowerCase()}
                  </button>
                ))}
              </div>
              <div className="kroger-review">
                {rows.map((r, i) => (
                  <div key={i} className={`kroger-row ${!r.matched ? "nomatch" : ""}`}>
                    <input
                      type="checkbox"
                      checked={r.include && !!r.matched}
                      disabled={!r.matched}
                      onChange={(e) => update(i, { include: e.target.checked })}
                    />
                    <div className="kr-item">
                      <b>{r.listName}</b> <span className="muted">{r.displayQty}</span>
                    </div>
                    {r.matched ? (
                      <>
                        <select value={r.matched.upc} onChange={(e) => swap(i, e.target.value)}>
                          {[r.matched, ...r.alternates].map((m) => (
                            <option key={m.upc} value={m.upc}>
                              {m.description}
                              {m.price != null ? ` — $${m.price.toFixed(2)}` : ""}
                            </option>
                          ))}
                        </select>
                        <input
                          className="kr-qty"
                          type="number"
                          min={1}
                          value={r.quantity}
                          onChange={(e) => update(i, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                        />
                      </>
                    ) : (
                      <span className="muted">no match — buy in store</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={send} disabled={!includedCount}>
                  Send {includedCount} to cart
                </button>
                <button className="btn ghost" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {step === "sending" && (
            <p className="muted">Adding {includedCount} items to your Mariano's cart…</p>
          )}

          {step === "done" && (
            <>
              <p>
                ✅ Added <strong>{added}</strong> item{added === 1 ? "" : "s"} to your Mariano's
                cart ({modality.toLowerCase()}).
                {skipped ? ` ${skipped} item(s) had no match — grab those in store.` : ""}
              </p>
              <a className="btn" href="https://www.marianos.com/cart" target="_blank" rel="noreferrer">
                Open Mariano's cart ↗
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
