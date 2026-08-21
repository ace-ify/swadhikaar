// ponytail: MINIMAL LOCAL STUB. Another agent owns the real implementation at
// this path (IndexedDB + service-worker sync). This localStorage version exists
// only so the asha screening UI compiles and can be demoed. Delete on merge —
// the exported signatures are the agreed contract and must not drift.
"use client";

import { createClient } from "@/lib/supabase";

export type OutboxOp = {
  id: string;
  table: string;
  op: "insert" | "update";
  payload: Record<string, unknown>;
  createdAt: string;
  attempts?: number;
  lastError?: string;
};

const KEY = "swadhikaar.outbox.v1";
const listeners = new Set<(n: number) => void>();

function read(): OutboxOp[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "[]") as OutboxOp[];
  } catch {
    return [];
  }
}

function write(ops: OutboxOp[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(ops));
  for (const cb of listeners) cb(ops.length);
}

export async function enqueue(
  op: Omit<OutboxOp, "id" | "createdAt">
): Promise<string> {
  const id = crypto.randomUUID();
  write([...read(), { ...op, id, createdAt: new Date().toISOString() }]);
  return id;
}

export async function pending(): Promise<OutboxOp[]> {
  return read();
}

export async function pendingCount(): Promise<number> {
  return read().length;
}

export function onPendingChange(cb: (n: number) => void): () => void {
  listeners.add(cb);
  cb(read().length);
  return () => listeners.delete(cb);
}

export async function syncNow(): Promise<{ synced: number; failed: number }> {
  const ops = read();
  if (ops.length === 0) return { synced: 0, failed: 0 };

  const supabase = createClient();
  const remaining: OutboxOp[] = [];
  let synced = 0;

  for (const op of ops) {
    try {
      const q = supabase.from(op.table);
      const { error } =
        op.op === "insert"
          ? await q.insert(op.payload)
          : await q.update(op.payload).eq("id", op.payload.id as string);
      if (error) throw new Error(error.message);
      synced++;
    } catch (e) {
      remaining.push({
        ...op,
        attempts: (op.attempts ?? 0) + 1,
        lastError: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  write(remaining);
  return { synced, failed: remaining.length };
}
