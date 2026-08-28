import type {
  CollectionReferenceLike, DocumentReferenceLike, DocumentSnapshotLike, FirestoreLike,
  QueryLike, QueryOperator, QuerySnapshotLike, SetOptionsLike, TransactionLike, WriteBatchLike,
} from "../src/firestore-rest.ts";

type Row = Record<string, unknown>;
type Operation = { kind: "set" | "create" | "delete"; path: string; value?: unknown; merge?: boolean };
const clone = <T>(value: T): T => structuredClone(value);

function merge(left: Row, right: Row): Row {
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (value === undefined) continue;
    result[key] = value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length
      ? merge((result[key] as Row) ?? {}, value as Row) : clone(value);
  }
  return result;
}

class MemoryDocument implements DocumentReferenceLike {
  readonly db: MemoryFirestore;
  readonly path: string;
  constructor(db: MemoryFirestore, path: string) { this.db = db; this.path = path; }
  get id() { return this.path.split("/").at(-1)!; }
  collection(name: string) { return new MemoryCollection(this.db, `${this.path}/${name}`); }
  async listCollections() {
    await this.db.read(this.path);
    const prefix = `${this.path}/`;
    const ids = new Set([...this.db.store.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length).split("/")[0]!));
    return [...ids].map((id) => new MemoryCollection(this.db, `${this.path}/${id}`));
  }
  snapshot(store = this.db.store): DocumentSnapshotLike {
    const value = clone(store.get(this.path));
    return { exists: value !== undefined, id: this.id, ref: this, data: () => clone(value) };
  }
  async get() { await this.db.read(this.path); return this.snapshot(); }
  async set(value: unknown, options?: SetOptionsLike) { await this.db.batch().set(this, value, options).commit(); }
}

class MemoryQuery implements QueryLike {
  readonly db: MemoryFirestore;
  readonly path: string;
  readonly filters: Array<[string, QueryOperator, unknown]>;
  readonly orders: Array<[string, "asc" | "desc"]>;
  readonly count?: number;
  readonly cursor?: unknown[];
  constructor(db: MemoryFirestore, path: string, filters: Array<[string, QueryOperator, unknown]> = [], orders: Array<[string, "asc" | "desc"]> = [], count?: number, cursor?: unknown[]) {
    this.db = db; this.path = path; this.filters = filters; this.orders = orders; this.count = count; this.cursor = cursor;
  }
  where(field: string, operator: QueryOperator, value: unknown) { return new MemoryQuery(this.db, this.path, [...this.filters, [field, operator, value]], this.orders, this.count, this.cursor); }
  orderBy(field: string, direction: "asc" | "desc" = "asc") { return new MemoryQuery(this.db, this.path, this.filters, [...this.orders, [field, direction]], this.count, this.cursor); }
  limit(count: number) { return new MemoryQuery(this.db, this.path, this.filters, this.orders, count, this.cursor); }
  startAfter(...values: unknown[]) { return new MemoryQuery(this.db, this.path, this.filters, this.orders, this.count, values); }
  snapshot(store = this.db.store): QuerySnapshotLike {
    const prefix = `${this.path}/`;
    let entries = [...store.entries()].filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"));
    entries = entries.filter(([, value]) => this.filters.every(([field, op, expected]) => {
      const actual = (value as Row)[field];
      if (actual === undefined) return false;
      if (op === "==") return actual === expected;
      const comparison = typeof actual === "number" && typeof expected === "number" ? actual - expected : String(actual).localeCompare(String(expected));
      return op === "<=" ? comparison <= 0 : op === "<" ? comparison < 0 : op === ">=" ? comparison >= 0 : comparison > 0;
    }));
    if (this.orders.length) entries = entries.filter(([, value]) => this.orders.every(([field]) => (value as Row)[field] !== undefined)).sort(([, a], [, b]) => {
      for (const [field, direction] of this.orders) {
        const comparison = String((a as Row)[field]).localeCompare(String((b as Row)[field]));
        if (comparison) return direction === "asc" ? comparison : -comparison;
      }
      return 0;
    });
    if (this.cursor) entries = entries.filter(([, value]) => {
      for (let index = 0; index < this.orders.length; index++) {
        const [field, direction] = this.orders[index]!;
        const comparison = String((value as Row)[field]).localeCompare(String(this.cursor![index]));
        if (comparison) return direction === "asc" ? comparison > 0 : comparison < 0;
      }
      return false;
    });
    if (this.count !== undefined) entries = entries.slice(0, this.count);
    return { docs: entries.map(([path]) => new MemoryDocument(this.db, path).snapshot(store)) };
  }
  async get() { await this.db.read(this.path); return this.snapshot(); }
}

class MemoryCollection extends MemoryQuery implements CollectionReferenceLike {
  doc(id: string) { return new MemoryDocument(this.db, `${this.path}/${id}`); }
  async listDocuments() {
    await this.db.read(this.path);
    const prefix = `${this.path}/`;
    const ids = new Set([...this.db.store.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length).split("/")[0]!));
    return [...ids].map((id) => this.doc(id));
  }
}

class MemoryWriter implements WriteBatchLike, TransactionLike {
  readonly db: MemoryFirestore;
  readonly snapshotStore: Map<string, unknown>;
  readonly operations: Operation[] = [];
  constructor(db: MemoryFirestore, snapshotStore = db.store) { this.db = db; this.snapshotStore = snapshotStore; }
  set(ref: DocumentReferenceLike, value: unknown, options?: SetOptionsLike) { this.operations.push({ kind: "set", path: ref.path, value: clone(value), merge: options?.merge }); return this; }
  create(ref: DocumentReferenceLike, value: unknown) { this.operations.push({ kind: "create", path: ref.path, value: clone(value) }); return this; }
  delete(ref: DocumentReferenceLike) { this.operations.push({ kind: "delete", path: ref.path }); return this; }
  get(ref: DocumentReferenceLike): Promise<DocumentSnapshotLike>;
  get(query: QueryLike | CollectionReferenceLike): Promise<QuerySnapshotLike>;
  async get(value: DocumentReferenceLike | QueryLike | CollectionReferenceLike) {
    if (this.operations.length) throw new Error("All transaction reads must precede writes.");
    if (!(value instanceof MemoryDocument) && !(value instanceof MemoryQuery)) throw new Error("Incompatible memory reference.");
    await this.db.read(value.path);
    return value.snapshot(this.snapshotStore);
  }
  async commit() { this.db.commit(this.operations); }
}

/** Unit-test fixture only. Adapter integration contracts run against the real Firestore emulator. */
export class MemoryFirestore implements FirestoreLike {
  readonly store = new Map<string, unknown>();
  readonly values = this.store as Map<string, Row>;
  writes = 0;
  commits = 0;
  failReads = 0;
  failCommits = 0;
  beforeRead?: (path: string) => Promise<void>;
  beforeCommit?: (operations: Operation[]) => void;
  collection(path: string) { return new MemoryCollection(this, path); }
  batch() { return new MemoryWriter(this); }
  async read(path: string) {
    if (this.failReads > 0) { this.failReads--; throw new Error("INJECTED_READ_FAILURE"); }
    await this.beforeRead?.(path);
  }
  commit(operations: Operation[]) {
    if (!operations.length) return;
    this.beforeCommit?.(operations);
    if (this.failCommits > 0) { this.failCommits--; throw new Error("INJECTED_COMMIT_FAILURE"); }
    if (operations.length > 500) throw new Error("Commit exceeds 500 writes.");
    const next = clone(this.store);
    for (const operation of operations) {
      if (operation.kind === "delete") { next.delete(operation.path); continue; }
      if (operation.kind === "create" && next.has(operation.path)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
      const value = operation.merge ? merge((next.get(operation.path) as Row) ?? {}, operation.value as Row) : clone(operation.value);
      next.set(operation.path, value);
    }
    this.store.clear();
    for (const [path, value] of next) this.store.set(path, value);
    this.writes += operations.length;
    this.commits++;
  }
  async runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const before = JSON.stringify([...this.store]);
      const writer = new MemoryWriter(this, clone(this.store));
      const result = await fn(writer);
      if (JSON.stringify([...this.store]) !== before) continue;
      await writer.commit();
      return result;
    }
    throw Object.assign(new Error("ABORTED"), { code: 10 });
  }
}

export function barrier(participants: number) {
  let entered = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return async () => { if (++entered >= participants) release(); await ready; };
}

export function fixedClock(iso = "2026-08-23T23:00:00.000Z") {
  let value = Date.parse(iso);
  return { now: () => new Date(value), advance: (ms: number) => { value += ms; } };
}
