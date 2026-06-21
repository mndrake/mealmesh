// "Send to Mariano's" flow: connect (OAuth) -> pick store -> review matched products
// (swap/remove/qty) -> choose pickup/delivery -> send to cart -> open cart. We only add
// items; the user reviews and checks out on Mariano's.
import { useEffect, useState } from "react";
import type { Section } from "../lib/types";
import { type ShoppingList, SECTION_LABELS } from "../lib/shopping";
import { sectionMismatch } from "../lib/krogerSections";
import { krogerClient, type ReviewRow, type KrogerStore, type SentItem } from "../lib/krogerClient";

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
  const [failedItems, setFailedItems] = useState<string[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // What MealMesh has already added to the cart (we can't read the real cart, so we track
  // our own sends) — used to flag duplicates and items to remove.
  const [sentItems, setSentItems] = useState<SentItem[]>([]);

  // Non-staple shopping items to match (staples are "check pantry", not bought here).
  const items = list.sections.flatMap((s) => s.items).map(([name, displayQty]) => ({ name, displayQty }));
  // The list section each item is grouped under, to cross-check against Kroger's department.
  const sectionByName = new Map<string, Section>();
  for (const s of list.sections) for (const [name] of s.items) sectionByName.set(name, s.section);

  /** Location hint for a matched row: aisle + a flag when Kroger's department disagrees
   *  with the section the list grouped the item under. */
  function locationHint(r: ReviewRow) {
    if (!r.matched) return null;
    const mism = sectionMismatch(sectionByName.get(r.listName), r.matched.department);
    const listSection = sectionByName.get(r.listName);
    return (
      <>
        {r.matched.aisle && <span className="kr-aisle">📍 {r.matched.aisle}</span>}
        {mism ? (
          <span
            className="kr-aisle warn"
            title={listSection ? `Your list groups this under ${SECTION_LABELS[listSection].label}` : undefined}
          >
            ⚠ Kroger: {SECTION_LABELS[mism].label}
          </span>
        ) : (
          !r.matched.aisle && r.matched.department && <span className="kr-aisle">📍 {r.matched.department}</span>
        )}
      </>
    );
  }

  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
    setStep("error");
  }

  async function startReview(sent: SentItem[] = sentItems) {
    setStep("loading");
    try {
      const { rows } = await krogerClient.match(items);
      // Default already-sent or unavailable matches OFF so we don't duplicate the cart or
      // add things that can't be fulfilled — the user can still re-check them.
      const sentUpcs = new Set(sent.map((x) => x.upc));
      setRows(
        rows.map((r) =>
          r.matched && (sentUpcs.has(r.matched.upc) || !r.matched.available)
            ? { ...r, include: false }
            : r
        )
      );
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
        setSentItems(s.sentItems ?? []);
        if (s.storeName) void startReview(s.sentItems ?? []);
        else setStep("store");
      })
      .catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resetSent() {
    try {
      const res = await krogerClient.clearSent();
      setSentItems(res.sentItems);
    } catch (e) {
      fail(e);
    }
  }

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
    const included = rows.filter((r) => r.include && r.matched);
    const payload = included.map((r) => ({ upc: r.matched!.upc, quantity: r.quantity }));
    setProgress({ done: 0, total: payload.length });
    setStep("sending");
    // Send in small chunks so we can show real progress; a failed chunk doesn't abort.
    let ok = 0;
    const failedUpcs: string[] = [];
    const CHUNK = 4;
    for (let i = 0; i < payload.length; i += CHUNK) {
      const chunk = payload.slice(i, i + CHUNK);
      try {
        const res = await krogerClient.cart(chunk, modality);
        ok += res.added;
        for (const f of res.failed ?? []) failedUpcs.push(f.upc);
      } catch {
        for (const it of chunk) failedUpcs.push(it.upc);
      }
      setProgress({ done: Math.min(i + CHUNK, payload.length), total: payload.length });
    }
    // Map the refused UPCs back to the user's item names so the receipt is readable.
    const nameByUpc = new Map(included.map((r) => [r.matched!.upc, r.listName]));
    setFailedItems(failedUpcs.map((u) => nameByUpc.get(u) ?? u));
    setAdded(ok);

    // Record the items that actually landed in the cart so future sends can flag
    // duplicates/removals. Best-effort: a failure here doesn't affect the send result.
    const failedSet = new Set(failedUpcs);
    const addedItems = included
      .filter((r) => !failedSet.has(r.matched!.upc))
      .map((r) => ({ upc: r.matched!.upc, name: r.listName, quantity: r.quantity }));
    if (addedItems.length) {
      try {
        const res = await krogerClient.recordSent(addedItems);
        setSentItems(res.sentItems);
      } catch {
        /* history is best-effort */
      }
    }
    setStep("done");
  }

  const includedCount = rows.filter((r) => r.include && r.matched).length;
  const noMatchItems = rows.filter((r) => !r.matched).map((r) => r.listName);
  const skipped = noMatchItems.length;
  // Reconcile our send-history against the current list (best-effort, by UPC): which rows
  // are already in the cart, and which previously-sent items are no longer needed.
  const sentUpcs = new Set(sentItems.map((s) => s.upc));
  const currentUpcs = new Set(rows.filter((r) => r.matched).map((r) => r.matched!.upc));
  const toRemove = sentItems.filter((s) => !currentUpcs.has(s.upc));

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
                      {r.matched && sentUpcs.has(r.matched.upc) && (
                        <span className="kr-badge sent">in cart</span>
                      )}
                      {r.matched && !r.matched.available && (
                        <span className="kr-badge warn">unavailable</span>
                      )}
                      {locationHint(r)}
                    </div>
                    {r.matched ? (
                      <>
                        <select value={r.matched.upc} onChange={(e) => swap(i, e.target.value)}>
                          {[r.matched, ...r.alternates].map((m) => (
                            <option key={m.upc} value={m.upc} disabled={!m.available}>
                              {m.description}
                              {m.price != null ? ` — $${m.price.toFixed(2)}` : ""}
                              {m.available ? "" : " — unavailable"}
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
              {toRemove.length > 0 && (
                <div className="kroger-receipt error">
                  <strong>
                    Already in your cart but not on this list ({toRemove.length}) — remove in
                    Mariano's:
                  </strong>
                  <ul>
                    {toRemove.map((s) => (
                      <li key={s.upc}>{s.name || s.upc}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="muted" style={{ fontSize: "0.76rem", marginBottom: 8 }}>
                Items are <strong>added</strong> to your existing Mariano's cart (sending again
                makes duplicates). Your cart's store/fulfillment is whatever's set in your
                Mariano's account — this picker only chooses where prices &amp; matches come from.
              </p>
              {sentItems.length > 0 && (
                <p className="muted" style={{ fontSize: "0.76rem", marginBottom: 8 }}>
                  MealMesh has {sentItems.length} item{sentItems.length === 1 ? "" : "s"} on record
                  as already sent.{" "}
                  <button className="linklike" onClick={resetSent}>
                    Reset after checkout
                  </button>
                </p>
              )}
              <div className="row" style={{ marginTop: 4 }}>
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
            <>
              <p className="muted">
                Adding to your Mariano's cart… {progress.done} of {progress.total}
              </p>
              <div className="progress">
                <div
                  className="progress-fill"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
            </>
          )}

          {step === "done" && (
            <>
              <p>
                ✅ Added <strong>{added}</strong> item{added === 1 ? "" : "s"} to your Mariano's
                cart ({modality.toLowerCase()}).
              </p>

              {failedItems.length > 0 && (
                <div className="kroger-receipt error">
                  <strong>Couldn't add to cart ({failedItems.length}) — buy these separately:</strong>
                  <ul>
                    {failedItems.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {noMatchItems.length > 0 && (
                <div className="kroger-receipt">
                  <strong>No Mariano's match ({noMatchItems.length}) — grab in store:</strong>
                  <ul>
                    {noMatchItems.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {toRemove.length > 0 && (
                <div className="kroger-receipt error">
                  <strong>
                    In your cart but not on this list ({toRemove.length}) — remove in Mariano's:
                  </strong>
                  <ul>
                    {toRemove.map((s) => (
                      <li key={s.upc}>{s.name || s.upc}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="muted" style={{ fontSize: "0.76rem" }}>
                Tip: Kroger's API can only add items — it can't read or clear your cart, so
                MealMesh can't verify the final cart or remove duplicates. It tracks what it sent
                so it can flag duplicates &amp; removals next time. Review the cart on Mariano's
                before checkout.
              </p>
              <div className="row" style={{ marginTop: 4 }}>
                <a className="btn" href="https://www.marianos.com/cart" target="_blank" rel="noreferrer">
                  Open Mariano's cart ↗
                </a>
                {sentItems.length > 0 && (
                  <button className="btn ghost" onClick={resetSent}>
                    Reset sent list
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
