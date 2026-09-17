// Ported from zeron@853872d apps/ios/Zeron/Sync/RegistryCore.swift
// (final class RegistryDoc, L334–576) mirroring crates/doc/src/registry.rs.
//
// The local registry replica: authoritative rows (server truth, replaced
// wholesale by state/rows frames — clients never re-merge server rows) plus
// a pending op-batch queue (local writes not yet acked, replayed over the
// authoritative rows for every read). Pure data, no I/O.

import {
  applyOp,
  encodeHlc,
  HlcClock,
  maxClock,
  rowToSeedOp,
  type FieldValue,
  type Hlc,
  type Op,
  type OpKind,
  type Row,
} from '../protocol/registryCore';

export interface RegistryPendingBatch {
  batch: string;
  ops: Op[];
  /** True while the batch is in flight on the CURRENT connection (cleared
   * on disconnect so reconnects re-push). Never persisted — a restart
   * implies a fresh connection. */
  inFlight: boolean;
}

/** What `applyState` decided about a `state` frame. */
export type RegistryStateOutcome = 'delta' | 'replaced' | 'reseeded';

interface Persisted {
  v: number;
  resyncEpoch?: number;
  deviceId: string;
  serverSeq: number;
  gcFloor: number;
  clock: { lastMs: number; counter: number };
  rows: Row[];
  pending: { batch: string; ops: Op[] }[];
}

export class RegistryDoc {
  /** Ops per push batch cap is 500 server-side; seeds chunk under it. */
  static readonly seedChunkOps = 400;

  /** Bump to force one full resync on next load (heals snapshots whose
   * cursor jumped past unapplied rows; mirrors the desktop epoch). */
  private static readonly currentResyncEpoch = 1;

  readonly deviceId: string;
  /** kind → id → row (server truth). */
  private authoritative: Map<string, Map<string, Row>> = new Map();
  private serverSeq = 0;
  private gcFloor = 0;
  private clock = new HlcClock();
  private pending: RegistryPendingBatch[] = [];
  /** Bumped on every mutation (local or applied) — feeds save debounces. */
  private generation = 0;
  private nowFn: () => number;

  constructor(deviceId: string, now: () => number = () => Date.now()) {
    this.deviceId = deviceId;
    this.nowFn = now;
  }

  /** Sync cursor: the last server seq this replica has fully applied. */
  get cursor(): number {
    return this.serverSeq;
  }

  /** The cursor for a hello frame: undefined (ask for full state) only when
   * this replica has never seen or written anything. */
  get helloCursor(): number | undefined {
    return this.serverSeq === 0 &&
      this.pending.length === 0 &&
      this.generation === 0
      ? undefined
      : this.serverSeq;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get pendingBatches(): readonly RegistryPendingBatch[] {
    return this.pending;
  }

  get gcFloorSeq(): number {
    return this.gcFloor;
  }

  get generationCount(): number {
    return this.generation;
  }

  // ── Persistence ({rows, cursor, gcFloor, clock, pending} JSON blob) ──

  serialize(): string {
    const state: Persisted = {
      v: 1,
      resyncEpoch: RegistryDoc.currentResyncEpoch,
      deviceId: this.deviceId,
      serverSeq: this.serverSeq,
      gcFloor: this.gcFloor,
      clock: { lastMs: this.clock.lastMs, counter: this.clock.counter },
      rows: [...this.authoritative.values()].flatMap(byId => [
        ...byId.values(),
      ]),
      pending: this.pending.map(({ batch, ops }) => ({ batch, ops })),
    };
    return JSON.stringify(state);
  }

  static deserialize(data: string, deviceId: string): RegistryDoc {
    const state = JSON.parse(data) as Persisted;
    if (state.v !== 1) {
      throw new Error(`unknown registry snapshot version ${state.v}`);
    }
    const doc = new RegistryDoc(deviceId);
    // Pre-epoch snapshots may hide a jumped cursor: zero it once so the next
    // hello returns full state. Rows are kept.
    doc.serverSeq =
      (state.resyncEpoch ?? 0) < RegistryDoc.currentResyncEpoch
        ? 0
        : state.serverSeq;
    doc.gcFloor = state.gcFloor;
    doc.clock.lastMs = state.clock.lastMs;
    doc.clock.counter = state.clock.counter;
    doc.pending = state.pending.map(b => ({ ...b, inFlight: false }));
    for (const row of state.rows) doc.putAuthoritative(row);
    return doc;
  }

  // ── Server frames ────────────────────────────────────────────────────

  /**
   * Apply a hello `state` frame:
   * - `full=false`: delta over existing authoritative rows.
   * - `full=true`, `seq < serverSeq`: the server LOST state (reset/wipe) —
   *   local rows are the only copy: keep them, merge the server's rows in,
   *   and enqueue re-seed ops carrying ORIGINAL clocks.
   * - `full=true`, `seq >= serverSeq`: full replace; local-only rows the
   *   server never saw re-seed too (e.g. it GC-jumped our cursor).
   */
  applyState(
    seq: number,
    full: boolean,
    gcFloor: number,
    rows: Row[],
  ): RegistryStateOutcome {
    this.generation += 1;
    if (!full) {
      for (const row of rows) this.putAuthoritative(row);
      this.serverSeq = seq;
      this.gcFloor = gcFloor;
      return 'delta';
    }
    if (seq < this.serverSeq) {
      const seed = [...this.authoritative.values()]
        .flatMap(byId => [...byId.values()])
        .map(rowToSeedOp);
      for (const row of rows) this.putAuthoritative(row);
      this.serverSeq = seq;
      this.gcFloor = gcFloor;
      this.enqueueSeed(seed);
      return 'reseeded';
    }
    const incoming = new Map<string, Map<string, Row>>();
    for (const row of rows) {
      let byId = incoming.get(row.kind);
      if (byId === undefined) incoming.set(row.kind, (byId = new Map()));
      byId.set(row.id, row);
    }
    const seed: Op[] = [];
    for (const [kind, byId] of this.authoritative) {
      for (const [id, row] of byId) {
        if (incoming.get(kind)?.get(id) === undefined)
          seed.push(rowToSeedOp(row));
      }
    }
    this.authoritative = incoming;
    this.serverSeq = seq;
    this.gcFloor = gcFloor;
    if (seed.length === 0) return 'replaced';
    this.enqueueSeed(seed);
    return 'reseeded';
  }

  /**
   * Apply a `rows` broadcast (merged truth for the touched rows). Returns
   * false on a SEQ GAP — frames between the cursor and this batch were
   * missed: the rows still apply, but the cursor holds so the caller
   * resyncs (a fresh hello backfills the window). Advancing across a gap
   * makes the missed rows permanently invisible (desktop field incident).
   */
  applyRows(seq: number, rows: Row[]): boolean {
    this.generation += 1;
    for (const row of rows) this.putAuthoritative(row);
    if (seq > this.serverSeq + 1) return false;
    if (seq > this.serverSeq) this.serverSeq = seq;
    return true;
  }

  /**
   * Retire an acked batch. Deliberately does NOT advance the cursor: the
   * ack's seq is OUR batch's position, and peers' batches may sit between
   * the cursor and it — jumping skipped them forever; the cursor advances
   * only with actual row payloads.
   */
  ackBatch(batch: string, _seq: number): void {
    const before = this.pending.length;
    this.pending = this.pending.filter(b => b.batch !== batch);
    if (this.pending.length !== before) this.generation += 1;
  }

  /** Batches to push: everything not already in flight on this connection. */
  takePushable(): RegistryPendingBatch[] {
    const out: RegistryPendingBatch[] = [];
    for (const b of this.pending) {
      if (!b.inFlight) {
        b.inFlight = true;
        out.push(b);
      }
    }
    return out;
  }

  /** Connection dropped: everything unacked becomes pushable again. */
  markDisconnected(): void {
    for (const b of this.pending) b.inFlight = false;
  }

  private putAuthoritative(row: Row): void {
    let byId = this.authoritative.get(row.kind);
    if (byId === undefined)
      this.authoritative.set(row.kind, (byId = new Map()));
    byId.set(row.id, row);
  }

  // ── Local writes ─────────────────────────────────────────────────────

  private nextHlc(): Hlc {
    return this.clock.next(this.nowFn(), this.deviceId);
  }

  enqueueOps(ops: Op[]): void {
    if (ops.length === 0) return;
    this.generation += 1;
    // Batch ids only need device-lifetime uniqueness; the HLC of a fresh
    // tick provides exactly that.
    this.pending.push({ batch: `b-${this.nextHlc()}`, ops, inFlight: false });
  }

  /** Seeds can exceed the server's 500-op batch cap on a large workspace —
   * chunk them. */
  private enqueueSeed(ops: Op[]): void {
    for (let start = 0; start < ops.length; start += RegistryDoc.seedChunkOps) {
      this.enqueueOps(ops.slice(start, start + RegistryDoc.seedChunkOps));
    }
  }

  write(
    kind: string,
    id: string,
    op: OpKind,
    set: Record<string, FieldValue | null>,
  ): void {
    this.enqueueOps([
      {
        kind,
        id,
        op,
        set: op === 'delete' ? undefined : set,
        hlc: this.nextHlc(),
      },
    ]);
  }

  /** Tombstone rows in ONE batch (a space delete cascades space + chats +
   * sessions atomically). */
  deleteRows(keys: { kind: string; id: string }[]): void {
    const hlc = this.nextHlc();
    this.enqueueOps(
      keys.map(({ kind, id }) => ({ kind, id, op: 'delete' as const, hlc })),
    );
  }

  // ── Overlay reads (authoritative + pending ops replayed) ─────────────

  /** The row as this device should display it: authoritative + pending ops. */
  overlayRow(kind: string, id: string): Row | undefined {
    let row = this.authoritative.get(kind)?.get(id);
    for (const batch of this.pending) {
      for (const op of batch.ops) {
        if (op.kind === kind && op.id === id) {
          const next = applyOp(row, op).row;
          if (next !== undefined) row = next;
        }
      }
    }
    if (row === undefined || row.deleted) return undefined;
    return row;
  }

  /** All live rows of `kind`, overlay applied. */
  overlayRows(kind: string): Row[] {
    const ids = [...(this.authoritative.get(kind)?.keys() ?? [])];
    const seen = new Set(ids);
    for (const batch of this.pending) {
      for (const op of batch.ops) {
        if (op.kind === kind && !seen.has(op.id)) {
          seen.add(op.id);
          ids.push(op.id);
        }
      }
    }
    return ids
      .map(id => this.overlayRow(kind, id))
      .filter((r): r is Row => r !== undefined);
  }

  rowExists(kind: string, id: string): boolean {
    return this.overlayRow(kind, id) !== undefined;
  }
}

export { encodeHlc, maxClock };
export type { FieldValue, Hlc, Op, OpKind, Row };
