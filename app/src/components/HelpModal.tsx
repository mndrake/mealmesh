// A short, plain-language guide to the MealMesh workflow. Opened from the "?" button in the
// app bar. Content only — no app state.

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="content help">
          <h2 style={{ marginTop: 0 }}>How MealMesh works</h2>
          <p className="muted">
            Plan the week's meals, turn them into a shopping list, then check things off (or
            send them to your Mariano's cart) as you shop. Everything syncs across your
            household's devices.
          </p>

          <ol className="help-steps">
            <li>
              <strong>Browse</strong> recipes and ★ favorite the ones you like. Use{" "}
              <strong>Import</strong> (in Browse) to add a recipe from a link.
            </li>
            <li>
              <strong>Plan</strong> the week — auto-generate a plan, then swap or lock
              individual meals and regenerate the rest. Save plans as reusable menus.
            </li>
            <li>
              <strong>Shopping</strong> turns the plan into one combined list, grouped by store
              section with quantities merged across the week.
            </li>
            <li>
              <strong>History</strong> — tap “I made this” to log what you cooked, with a
              rating and notes.
            </li>
          </ol>

          <h3>In the Shopping tab</h3>
          <ul className="help-list">
            <li>
              <strong>Get prices &amp; aisles</strong> looks each item up at your Mariano's
              store, then shows an estimated <strong>price</strong> per item, a running total
              (to&nbsp;go / in&nbsp;cart / total), and lets you switch to <strong>Aisle
              order</strong> for an efficient store walk.
            </li>
            <li>
              <strong>Review &amp; send</strong> is where you fine-tune the
              ingredient→product match: swap to a different product, set how many packages to
              buy, and (optionally) send everything to your Mariano's cart. You review and
              check out on Mariano's — MealMesh only adds items.
            </li>
            <li>
              A “—” price means Kroger didn't find a match for that item; grab it in store.
            </li>
          </ul>

          <h3>Pantry staples</h3>
          <p>
            Spices, oils, vinegars, sauces and baking basics (flour, sugar, baking powder…)
            are things you usually keep on hand, so they're listed separately at the bottom as{" "}
            <strong>Pantry staples</strong> instead of cluttering every week's list. When
            you're running low on one, tap <strong>“Need to buy”</strong> and it joins your
            shopping list and cart like any other item (priced, aisle-sorted, checkable). Tap{" "}
            <strong>★ staple</strong> on it again to move it back to the pantry list.
          </p>
        </div>
      </div>
    </div>
  );
}
