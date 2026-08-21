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

const { enqueue, pending, pendingCount, syncNow } = await import("./outbox.ts");

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
