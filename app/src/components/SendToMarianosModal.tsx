// "Send to Mariano's" flow: connect (OAuth) -> pick store -> review matched products
// (swap/remove/qty) -> choose pickup/delivery -> send to cart -> open cart. We only add
// items; the user reviews and checks out on Mariano's.
import { useEffect, useRef, useState } from "react";
import type { Section } from "../lib/types";
import { type ShoppingList, SECTION_LABELS } from "../lib/shopping";
import { sectionMismatch } from "../lib/krogerSections";
import { actions, getState } from "../lib/store";
import { krogerClient, type ReviewRow, type KrogerStore, type SentItem, type ProductMatch } from "../lib/krogerClient";

type Step = "loading" | "needs-auth" | "store" | "review" | "sending" | "done" | "error";

export function SendToMarianosModal({ list, onClose, anchor = null }: { list: ShoppingList; onClose: () => void; anchor?: string | null }) {
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
  const [research, setResearch] = useState<number | null>(null); // row index showing the search box
  // What MealMesh has already added to the cart (we can't read the real cart, so we track
  // our own sends) — used to flag duplicates and items to remove.
  const [sentItems, setSentItems] = useState<SentItem[]>([]);

  // The list section each item is grouped under, to cross-check against Kroger's department
  // and to bias matching toward same-section products (shallots → Produce, not Deli). Built
  // immutably (no mutation during render) so the compiler keeps callbacks pure.
  const sectionByName = new Map<string, Section>(
    list.sections.flatMap((s) => s.items.map(([name]) => [name, s.section] as [string, Section]))
  );
  // Items to match (with their expected aisle). Staples not marked "need" are already excluded
  // from list.sections upstream. When opened from an item's "change" link (anchor), we only
  // match that one item — editing one product shouldn't re-match the whole list (slow).
  const items = list.sections.flatMap((s) => s.items.map(([name, displayQty]) => ({ name, displayQty, section: s.section })));
  const reviewItems = anchor ? items.filter((it) => it.name === anchor) : items;
  const editingOne = Boolean(anchor);
  const anchorRef = useRef<HTMLDivElement | null>(null);

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

  /** Persist the current product/price/aisle/quantity mapping back to the shopping list so
   *  the in-store checklist reflects any swaps or quantity edits made here. */
  function persistMapping() {
    const now = Date.now();
    const locs = rows
      .filter((r) => r.matched)
      .map((r) => ({
        name: r.listName,
        aisle: r.matched!.aisle,
        aisleNumber: r.matched!.aisleNumber,
        bay: r.matched!.bay,
        shelf: r.matched!.shelf,
        side: r.matched!.side,
        department: r.matched!.department,
        price: r.matched!.price,
        product: r.matched!.description,
        quantity: r.quantity,
        fetchedAt: now,
      }));
    if (locs.length) actions.saveItemLocations(locs);
  }

  function handleClose() {
    persistMapping();
    onClose();
  }

  async function startReview(sent: SentItem[] = sentItems) {
    setStep("loading");
    try {
      // Editing a single item forces a fresh search (bypass the cache) AND ignores any saved
      // alias (noAlias), so the picker shows the full current product list to choose from — the
      // cached/aliased entry can be a stale or narrowed match with no alternates. The full
      // review uses the cache + aliases (fast, and aliases improve the bulk auto-match).
      const { rows } = await krogerClient.match(reviewItems, editingOne, editingOne);
      // Default already-sent or unavailable matches OFF so we don't duplicate the cart or
      // add things that can't be fulfilled — the user can still re-check them. Seed each row's
      // package quantity from what was saved previously (this is the place qty is edited).
      const sentUpcs = new Set(sent.map((x) => x.upc));
      const savedQty = new Map(getState().itemLocations.map((l) => [l.name, l.quantity]));
      setRows(
        rows.map((r) => {
          const off = r.matched && (sentUpcs.has(r.matched.upc) || !r.matched.available);
          return { ...r, quantity: savedQty.get(r.listName) ?? r.quantity, include: off ? false : r.include };
        })
      );
      // Persist store locations back to the shopping list (by item name) so it can be
      // organized by aisle and show location info while shopping.
      const now = Date.now();
      const locs = rows
        .filter((r) => r.matched)
        .map((r) => ({
          name: r.listName,
          aisle: r.matched!.aisle,
          aisleNumber: r.matched!.aisleNumber,
          bay: r.matched!.bay,
          shelf: r.matched!.shelf,
          side: r.matched!.side,
          department: r.matched!.department,
          price: r.matched!.price,
          product: r.matched!.description,
          fetchedAt: now,
        }));
      if (locs.length) actions.saveItemLocations(locs);
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

  // When opened via an item's "change" link, scroll that row into view in the review step.
  useEffect(() => {
    if (step === "review" && anchor && anchorRef.current) {
      anchorRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [step, anchor, rows.length]);

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

  // Re-search a no-match row with an alternative term. On success, fill the row and remember
  // the term (so future matches use it) + cache the product's store location.
  async function resolveNoMatch(i: number, term: string): Promise<boolean> {
    const t = term.trim();
    if (!t) return false;
    const row = rows[i];
    // Section bias is omitted here on purpose — re-search uses the explicit term the user typed.
    const { rows: res } = await krogerClient.match([{ name: t, displayQty: row.displayQty }], true);
    const m = res[0]?.matched;
    if (!m) return false;
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, matched: m, alternates: res[0].alternates, include: true } : r)));
    setResearch(null);
    void krogerClient.saveAlias(row.listName, t).catch(() => {});
    const now = Date.now();
    actions.saveItemLocations([
      { name: row.listName, aisle: m.aisle, aisleNumber: m.aisleNumber, bay: m.bay, shelf: m.shelf, side: m.side, department: m.department, price: m.price, product: m.description, fetchedAt: now },
    ]);
    return true;
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
  // When editing a single item, don't reconcile against the whole cart (every other item
  // would look like it needs removing).
  const toRemove = editingOne ? [] : sentItems.filter((s) => !currentUpcs.has(s.upc));

  return (
    <div className="overlay" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <button className="close" onClick={handleClose} aria-label="Close">
          ×
        </button>
        <div className="content">
          <h2 style={{ marginTop: 0 }}>{editingOne ? `🛒 Change product: ${anchor}` : "🛒 Review products & prices"}</h2>

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
                {editingOne
                  ? `${storeName} · pick the product to map, then Save`
                  : `${storeName} · ${includedCount} item${includedCount === 1 ? "" : "s"} to add${skipped ? ` · ${skipped} with no match` : ""}`}
              </p>
              {!editingOne && (
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
              )}
              <div className="kroger-review">
                {rows.map((r, i) => (
                  <div
                    key={i}
                    ref={anchor === r.listName ? anchorRef : undefined}
                    className={`kroger-row ${!r.matched ? "nomatch" : ""} ${anchor === r.listName ? "anchor" : ""}`}
                  >
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
                    {r.matched && research !== i ? (
                      <>
                        <ProductPicker
                          options={[r.matched, ...r.alternates]}
                          value={r.matched.upc}
                          onChange={(upc) => swap(i, upc)}
                        />
                        <input
                          className="kr-qty"
                          type="number"
                          min={1}
                          value={r.quantity}
                          onChange={(e) => update(i, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                        />
                        <button
                          className="btn ghost small"
                          title="Search a different term"
                          onClick={() => setResearch(i)}
                        >
                          🔍
                        </button>
                      </>
                    ) : (
                      <NoMatchSearch
                        index={i}
                        defaultTerm={r.listName}
                        onResolve={resolveNoMatch}
                        onCancel={r.matched ? () => setResearch(null) : undefined}
                      />
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
              {!editingOne && (
                <p className="muted" style={{ fontSize: "0.76rem", marginBottom: 8 }}>
                  Items are <strong>added</strong> to your existing Mariano's cart (sending again
                  makes duplicates). Your cart's store/fulfillment is whatever's set in your
                  Mariano's account — this picker only chooses where prices &amp; matches come from.
                </p>
              )}
              {!editingOne && sentItems.length > 0 && (
                <p className="muted" style={{ fontSize: "0.76rem", marginBottom: 8 }}>
                  MealMesh has {sentItems.length} item{sentItems.length === 1 ? "" : "s"} on record
                  as already sent.{" "}
                  <button className="linklike" onClick={resetSent}>
                    Reset after checkout
                  </button>
                </p>
              )}
              <div className="row" style={{ marginTop: 4 }}>
                {editingOne ? (
                  <button className="btn" onClick={handleClose}>
                    Save
                  </button>
                ) : (
                  <button className="btn" onClick={send} disabled={!includedCount}>
                    Send {includedCount} to cart
                  </button>
                )}
                <button className="btn ghost" onClick={editingOne ? onClose : handleClose}>
                  {editingOne ? "Cancel" : "Done"}
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

/** Product image with a graceful placeholder when missing / failed to load. */
function ProductThumb({ src, alt }: { src: string | null; alt: string }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return <span className="kr-thumb placeholder" aria-hidden="true" />;
  return <img className="kr-thumb" src={src} alt={alt} loading="lazy" onError={() => setOk(false)} />;
}

const optionLabel = (m: ProductMatch) =>
  `${m.description}${m.price != null ? ` — $${m.price.toFixed(2)}` : ""}${m.available ? "" : " — unavailable"}`;

/** Image dropdown to pick a matched product / alternate. Replaces a native <select> so we
 *  can show thumbnails; unavailable options are disabled. */
function ProductPicker({
  options,
  value,
  onChange,
}: {
  options: ProductMatch[];
  value: string;
  onChange: (upc: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.upc === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="kr-picker" ref={ref}>
      <button
        type="button"
        className="kr-picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ProductThumb src={current?.image ?? null} alt="" />
        <span className="kr-picker-label">{current ? optionLabel(current) : "—"}</span>
        <span className="kr-picker-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="kr-picker-menu" role="listbox">
          {options.map((m) => (
            <li key={m.upc} role="option" aria-selected={m.upc === value}>
              <button
                type="button"
                className={`kr-option ${m.upc === value ? "sel" : ""}`}
                disabled={!m.available}
                onClick={() => {
                  onChange(m.upc);
                  setOpen(false);
                }}
              >
                <ProductThumb src={m.image} alt="" />
                <span className="kr-option-label">{optionLabel(m)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Inline re-search for a no-match review row: type a better term (e.g. "tortilla chips"
 *  for "broken tortilla chips") and pick the result; the term is then remembered. */
function NoMatchSearch({
  index,
  defaultTerm,
  onResolve,
  onCancel,
}: {
  index: number;
  defaultTerm: string;
  onResolve: (i: number, term: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [term, setTerm] = useState(defaultTerm);
  const [state, setState] = useState<"idle" | "searching" | "none">("idle");

  async function go() {
    if (!term.trim()) return;
    setState("searching");
    const ok = await onResolve(index, term).catch(() => false);
    setState(ok ? "idle" : "none");
  }

  return (
    <div className="kr-research">
      <input
        className="search"
        value={term}
        placeholder="Search term"
        style={{ maxWidth: 150 }}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      <button className="btn small secondary" onClick={go} disabled={state === "searching" || !term.trim()}>
        {state === "searching" ? "…" : "Search"}
      </button>
      {onCancel && (
        <button className="btn ghost small" onClick={onCancel} title="Keep current selection">
          Cancel
        </button>
      )}
      {state === "none" && <span className="muted" style={{ fontSize: "0.74rem" }}>no results</span>}
    </div>
  );
}
