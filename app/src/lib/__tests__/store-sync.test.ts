import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { connect, disconnect, actions, getState, isCloud } from "../store";

// ---- Minimal fake Supabase client ----
// A chainable, awaitable query builder; results come from a per-test `resolve(op)`.
type Op = { table: string; type: string; value?: unknown; filters: Record<string, unknown>; single?: string };
type Resolver = (op: Op) => { data: unknown; error: unknown };

function makeClient(resolve: Resolver) {
  const calls: Op[] = [];
  function builder(table: string) {
    const op: Op = { table, type: "select", filters: {} };
    const b: Record<string, unknown> = {
      select: () => ((op.type = "select"), b),
      insert: (v: unknown) => ((op.type = "insert"), (op.value = v), b),
      update: (v: unknown) => ((op.type = "update"), (op.value = v), b),
      upsert: (v: unknown) => ((op.type = "upsert"), (op.value = v), b),
      delete: () => ((op.type = "delete"), b),
      eq: (k: string, v: unknown) => ((op.filters[k] = v), b),
      order: () => b,
      limit: () => b,
      maybeSingle: () => ((op.single = "maybe"), b),
      single: () => ((op.single = "one"), b),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        calls.push(op);
        const r = resolve(op);
        return Promise.resolve(r).then(res, rej);
      },
    };
    return b;
  }
  return {
    client: {
      from: (t: string) => builder(t),
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: async () => {},
    } as never,
    calls,
  };
}

const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

// Empty-household resolver: selects return [], writes succeed.
const emptyResolver: Resolver = (op) => {
  if (op.type === "select") return { data: [], error: null };
  if (op.type === "insert" && op.single) return { data: { id: "plan-1" }, error: null };
  return { data: null, error: null };
};

describe("store cloud sync", () => {
  afterEach(async () => {
    await disconnect();
  });
  beforeEach(async () => {
    try {
      localStorage.clear();
    } catch {
      /* no localStorage in this env — store falls back to in-memory */
    }
    await disconnect(); // reset singleton to the local/default snapshot
  });

  it("connect() hydrates and enters cloud mode (empty household, no local data)", async () => {
    const { client } = makeClient(emptyResolver);
    await connect(client, "hh-1", "user-1");
    expect(isCloud()).toBe(true);
    expect(getState().importAvailable).toBe(false);
    expect(getState().favorites).toEqual([]);
  });

  it("optimistic update is applied synchronously, then written through", async () => {
    const { client, calls } = makeClient(emptyResolver);
    await connect(client, "hh-1", "user-1");

    actions.toggleFavorite("recipe-x");
    // optimistic: visible immediately, before any network resolves
    expect(getState().favorites).toEqual(["recipe-x"]);

    await tick();
    const fav = calls.find((c) => c.table === "favorites" && c.type === "upsert");
    expect(fav).toBeTruthy();
    expect(getState().syncError).toBe(false);
  });

  it("reverts the optimistic change when the write fails (reconcile)", async () => {
    const failFavorites: Resolver = (op) => {
      if (op.table === "favorites" && op.type === "upsert") return { data: null, error: { message: "nope" } };
      return emptyResolver(op);
    };
    const { client } = makeClient(failFavorites);
    await connect(client, "hh-1", "user-1");

    actions.toggleFavorite("recipe-x");
    expect(getState().favorites).toEqual(["recipe-x"]); // optimistic

    await tick(120); // write rejects -> syncError -> scheduleSync re-hydrates empty
    expect(getState().favorites).toEqual([]); // reverted to server truth
  });

  it("markCooked applies optimistically and inserts a cook_log row", async () => {
    const { client, calls } = makeClient(emptyResolver);
    await connect(client, "hh-1", "user-1");

    const id = actions.markCooked({ recipeId: "r1", cookedOn: "2026-06-21", rating: 5, makeAgain: true });
    expect(getState().cookLog[0]).toMatchObject({ id, recipeId: "r1", rating: 5, makeAgain: true });

    await tick();
    expect(calls.find((c) => c.table === "cook_log" && c.type === "insert")).toBeTruthy();
    expect(getState().syncError).toBe(false);
  });

  it("offers a one-time import when the cloud is empty but local data exists", async () => {
    // seed local data in local mode (no cloud): importState writes in-memory, no network
    actions.importState({ favorites: ["local-fav"] });
    expect(getState().favorites).toEqual(["local-fav"]);

    const { client } = makeClient(emptyResolver);
    await connect(client, "hh-1", "user-1");
    expect(getState().importAvailable).toBe(true);
    expect(getState().favorites).toEqual(["local-fav"]); // local data still shown while prompting
  });
});
