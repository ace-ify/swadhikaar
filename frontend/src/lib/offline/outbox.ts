import { openDB, type IDBPDatabase } from "idb";

export type OutboxOp = {
  id: string; // uuid, client-generated
  table: string; // e.g. "patients", "symptoms"
  op: "insert" | "update";
  payload: Record<string, unknown>;
  createdAt: string; // ISO
  attempts?: number;
  lastError?: string;
};

/** Stored shape: OutboxOp plus the backoff gate. Extra field is invisible to consumers. */
type StoredOp = OutboxOp & { nextAttemptAt?: number };

const DB_NAME = "swadhikaar-offline";
const STORE = "outbox";
const MAX_BACKOFF_MS = 5 * 60_000;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore(STORE, { keyPath: "id" }).createIndex(
          "createdAt",
          "createdAt"
        );
      },
    });
  }
  return dbPromise;
}

const listeners = new Set<(count: number) => void>();

async function notify() {
  if (listeners.size === 0) return;
  const count = await pendingCount();
  for (const cb of listeners) cb(count);
}

/** Oldest first. IDB index gives insertion order via createdAt; id breaks ties. */
async function allOps(): Promise<StoredOp[]> {
  const db = await getDb();
  const ops = (await db.getAllFromIndex(STORE, "createdAt")) as StoredOp[];
  return ops.sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id.localeCompare(b.id)
      : a.createdAt.localeCompare(b.createdAt)
  );
}

export async function enqueue(
  op: Omit<OutboxOp, "id" | "createdAt">
): Promise<string> {
  const record: StoredOp = {
    ...op,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    attempts: op.attempts ?? 0,
  };
  const db = await getDb();
  await db.put(STORE, record);
  await notify();
  return record.id;
}

export async function pending(): Promise<OutboxOp[]> {
  return allOps();
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  return db.count(STORE);
}

export function onPendingChange(cb: (count: number) => void): () => void {
  listeners.add(cb);
  void pendingCount().then(cb);
  // ponytail: same-tab only. Add a BroadcastChannel if two tabs ever need to agree live.
  return () => listeners.delete(cb);
}

let syncing = false;

export async function syncNow(): Promise<{ synced: number; failed: number }> {
  if (syncing) return { synced: 0, failed: 0 };
  syncing = true;
  let synced = 0;
  let failed = 0;
  try {
    const { createClient } = await import("@/lib/supabase");
    const supabase = createClient();
    const db = await getDb();
    const now = Date.now();

    for (const op of await allOps()) {
      if (op.nextAttemptAt && op.nextAttemptAt > now) continue; // backing off
      try {
        let error;
        if (op.op === "insert") {
          ({ error } = await supabase.from(op.table).insert(op.payload));
        } else {
          const { id, ...rest } = op.payload as { id?: unknown };
          if (id === undefined)
            throw new Error(`update op for "${op.table}" has no payload.id`);
          ({ error } = await supabase.from(op.table).update(rest).eq("id", id));
        }
        if (error) throw new Error(error.message);
        await db.delete(STORE, op.id);
        synced++;
      } catch (e) {
        const attempts = (op.attempts ?? 0) + 1;
        const next: StoredOp = {
          ...op,
          attempts,
          lastError: e instanceof Error ? e.message : String(e),
          // 2s, 4s, 8s ... capped at 5min
          nextAttemptAt:
            Date.now() + Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS),
        };
        await db.put(STORE, next);
        failed++;
      }
    }
  } finally {
    syncing = false;
    await notify();
  }
  return { synced, failed };
}
