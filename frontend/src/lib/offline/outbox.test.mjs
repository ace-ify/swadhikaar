/**
 * Runnable check for the outbox. No test framework installs beyond node:test.
 *   node --test src/lib/offline/outbox.test.ts
 * fake-indexeddb supplies IndexedDB; the Supabase URL points at a dead port so
 * syncNow() takes the failure path deterministically (no network needed).
 */
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Resolve the "@/..." path alias the way the bundler does.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      return {
        url: new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href,
        shortCircuit: true,
      };
    }
    return next(specifier, context);
  },
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";

const { enqueue, pending, pendingCount, syncNow, deadOps, discardDead } =
  await import("./outbox.ts");

test("enqueue then pending returns the op", async () => {
  const id = await enqueue({
    table: "symptoms",
    op: "insert",
    payload: { note: "बुखार" },
  });
  const ops = await pending();
  const op = ops.find((o) => o.id === id);
  assert.ok(op, "enqueued op should come back from pending()");
  assert.equal(op.table, "symptoms");
  assert.equal(op.op, "insert");
  assert.equal(op.attempts, 0);
  assert.ok(Date.parse(op.createdAt) > 0);
  assert.equal(await pendingCount(), ops.length);
});

test("a failed sync keeps the op and increments attempts", async () => {
  const before = await pendingCount();
  const id = await enqueue({
    table: "patients",
    op: "insert",
    payload: { name: "राम" },
  });

  const result = await syncNow();
  assert.equal(result.synced, 0, "nothing should sync against a dead endpoint");
  assert.ok(result.failed >= 1);

  const kept = (await pending()).find((o) => o.id === id);
  assert.ok(kept, "failed op must never be lost");
  assert.equal(kept.attempts, 1);
  assert.ok(kept.lastError, "failure should be recorded");
  assert.equal(await pendingCount(), before + 1);

  // Backoff gate: an immediate second run must not retry (attempts stays 1).
  await syncNow();
  const again = (await pending()).find((o) => o.id === id);
  assert.equal(again?.attempts, 1, "backoff should skip an immediate retry");
});

// --- an op the server will never accept must not retry forever -------------
// A connection failure is transient, so it must NOT be treated as permanent —
// that is the case an offline ASHA is in all day.

test("a transient failure is never marked dead", async () => {
  await discardDead();
  const id = await enqueue({
    table: "patients",
    op: "insert",
    payload: { name: "सीता" },
  });
  const r = await syncNow();
  assert.equal(r.dead, 0, "a dead endpoint is transient, not permanent");
  const op = (await pending()).find((o) => o.id === id);
  assert.ok(op, "a transient failure must keep the op pending");
  assert.equal(op.dead, undefined);
});

test("an op is abandoned after MAX_ATTEMPTS and leaves the pending count", async () => {
  await discardDead();
  const id = await enqueue({
    table: "patients",
    op: "insert",
    payload: { name: "गीता" },
  });

  // Drive it to the attempt ceiling, clearing the backoff gate each round so the
  // test does not sleep. 8 is MAX_ATTEMPTS in outbox.ts.
  const { openDB } = await import("idb");
  for (let i = 0; i < 8; i++) {
    const db = await openDB("swadhikaar-offline", 1);
    const rec = await db.get("outbox", id);
    if (!rec || rec.dead) break;
    await db.put("outbox", { ...rec, nextAttemptAt: 0 });
    await syncNow();
  }

  const stillPending = (await pending()).find((o) => o.id === id);
  assert.equal(stillPending, undefined, "abandoned op must leave pending()");

  const dead = await deadOps();
  const found = dead.find((o) => o.id === id);
  assert.ok(found, "abandoned op must be retrievable as dead, not silently dropped");
  assert.equal(found.dead, true);
  assert.ok(found.attempts >= 8);
  assert.ok(found.lastError, "the reason it was abandoned must survive");

  // The whole point: the chip stops counting it, so "0 pending" is honest and the
  // loss is visible somewhere else instead of hiding as perpetual progress.
  const counted = await pendingCount();
  const all = await pending();
  assert.equal(counted, all.length);
  assert.ok(!all.some((o) => o.dead));

  assert.ok((await discardDead()) >= 1);
  assert.equal((await deadOps()).length, 0);
});
