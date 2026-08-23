import { openDB, type IDBPDatabase } from "idb";

export type OutboxOp = {
  id: string; // uuid, client-generated
  table: string; // e.g. "patients", "symptoms"
  op: "insert" | "update";
  payload: Record<string, unknown>;
  createdAt: string; // ISO
  attempts?: number;
  lastError?: string;
  /** Set once the op is abandoned. It stays in the store so the UI can show it. */
  dead?: boolean;
};

/** Stored shape: OutboxOp plus the backoff gate. Extra field is invisible to consumers. */
type StoredOp = OutboxOp & { nextAttemptAt?: number; deadAt?: number };

const DB_NAME = "swadhikaar-offline";
const STORE = "outbox";
const MAX_BACKOFF_MS = 5 * 60_000;
// Mirrors serwist's BackgroundSyncQueue `maxRetentionTime` default (7 days). Without
// a cap, an op the server will NEVER accept — RLS denial, schema violation, duplicate
// key — retried every 5 minutes forever while the ASHA saw "1 pending" indefinitely.
// A screening that is never going to land must say so, not impersonate progress.
const MAX_RETENTION_MS = 7 * 24 * 60 * 60_000;
// A 4xx other than 429/408 will fail identically on every future attempt. Give it a
// few tries in case the cause was transient (a race with a just-created parent row),
// then stop rather than retry for a week.
const MAX_ATTEMPTS = 8;

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
  return (await allOps()).filter((o) => !o.dead);
}

/** Counts only ops still trying. A dead op is not "pending" — it is lost. */
export async function pendingCount(): Promise<number> {
  return (await pending()).length;
}

export function onPendingChange(cb: (count: number) => void): () => void {
  listeners.add(cb);
  void pendingCount().then(cb);
  // ponytail: same-tab only. Add a BroadcastChannel if two tabs ever need to agree live.
  return () => listeners.delete(cb);
}

let syncing = false;

/** True for errors that will fail identically on every future attempt. */
function isPermanent(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("violates row-level security") ||
    m.includes("duplicate key") ||
    m.includes("violates check constraint") ||
    m.includes("violates foreign key") ||
    m.includes("column") && m.includes("does not exist") ||
    m.includes("invalid input syntax")
  );
}

export async function syncNow(): Promise<{
  synced: number;
  failed: number;
  dead: number;
}> {
  if (syncing) return { synced: 0, failed: 0, dead: 0 };
  syncing = true;
  let synced = 0;
  let failed = 0;
  let dead = 0;
  try {
    const { createClient } = await import("@/lib/supabase");
    const supabase = createClient();
    const db = await getDb();
    const now = Date.now();

    for (const op of await allOps()) {
      if (op.dead) continue; // abandoned; kept only so the UI can report it
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
        const message = e instanceof Error ? e.message : String(e);
        const age = Date.now() - new Date(op.createdAt).getTime();
        // Stop retrying when the server will clearly never take it, when we have
        // tried enough times, or when it has sat here for a week. Silence is the
        // failure mode being fixed: an op retried forever looks like progress.
        const giveUp =
          isPermanent(message) ||
          attempts >= MAX_ATTEMPTS ||
          age >= MAX_RETENTION_MS;
        const next: StoredOp = {
          ...op,
          attempts,
          lastError: message,
          ...(giveUp
            ? { dead: true, deadAt: Date.now() }
            : {
                // 2s, 4s, 8s ... capped at 5min, with jitter so a village of phones
                // coming back online together does not stampede the API in lockstep.
                nextAttemptAt:
                  Date.now() +
                  Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS) *
                    (0.75 + Math.random() * 0.5),
              }),
        };
        await db.put(STORE, next);
        if (giveUp) dead++;
        else failed++;
      }
    }
  } finally {
    syncing = false;
    await notify();
  }
  return { synced, failed, dead };
}

/** Ops that will never sync. Surface these — they are lost screenings otherwise. */
export async function deadOps(): Promise<OutboxOp[]> {
  return (await allOps()).filter((o) => o.dead);
}

/** Clears the dead-letter list after someone has dealt with it. */
export async function discardDead(): Promise<number> {
  const db = await getDb();
  const dead = await deadOps();
  for (const o of dead) await db.delete(STORE, o.id);
  await notify();
  return dead.length;
}
