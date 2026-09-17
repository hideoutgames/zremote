// Attachment escorts — port of SessionStore.swift `spawnEscort` /
// `respawnEscorts` (doc_host.rs TRANSFER_BACKOFF_BASE/CAP +
// ATTACHMENT_WAIT_MAX): after a queued send lands `pending://` refs in the
// doc, the bytes chase it over the relay — retry-forever with doubling
// backoff (2s → 30s cap) until landed or the host's 15-minute defer window
// closes. Escorts re-arm on relaunch from the stash index.

import type { Clock } from '../transport/clock';
import { systemClock } from '../transport/clock';
import type { DocDisk } from '../native/docDisk';
import { pendingRef } from '../protocol/messages';
import { uploadAttachmentChunked, type RelayLike } from './upload';

export const ESCORT_BACKOFF_BASE_MS = 2_000;
export const ESCORT_BACKOFF_CAP_MS = 30_000;
export const ESCORT_DEADLINE_MS = 15 * 60_000;

export interface EscortTransfer {
  uploadId: string;
  name: string;
  /** Byte size — reported progress uses it; 0 allowed. */
  size: number;
}

export interface EscortDeps {
  orgId: string;
  userId: string;
  docDisk: DocDisk;
  clock?: Clock;
  /** Fresh relay per attempt — a dead link must not pin the loop. */
  relayFor: () => RelayLike;
  /** Push the committed bytes fraction (0–0.99) for the status strip. */
  onProgress?: (fraction: number | undefined) => void;
  /** Called once the last transfer lands — the host drains on nudge. */
  nudgeHost?: () => void;
  log?: (line: string) => void;
}

/** Push each transfer's stashed bytes until landed or the deadline closes.
 * Dedupes on uploadId — concurrent spawn/respawn never doubles a push. */
export class AttachmentEscort {
  private readonly active = new Set<string>();
  private readonly deps: EscortDeps;

  constructor(deps: EscortDeps) {
    this.deps = deps;
  }

  /** Fire-and-forget; resolves when the batch lands or gives up. */
  spawn(transfers: EscortTransfer[]): Promise<void> {
    const remaining = transfers.filter(t => !this.active.has(t.uploadId));
    if (remaining.length === 0) return Promise.resolve();
    for (const t of remaining) this.active.add(t.uploadId);
    return this.run(remaining).finally(() => {
      for (const t of remaining) this.active.delete(t.uploadId);
      this.deps.onProgress?.(undefined);
    });
  }

  private async run(transfers: EscortTransfer[]): Promise<void> {
    const clock = this.deps.clock ?? systemClock;
    const { orgId, userId, docDisk } = this.deps;
    const deadline = clock.now() + ESCORT_DEADLINE_MS;
    let pending = [...transfers];
    const totalBytes = Math.max(
      pending.reduce((n, t) => n + t.size, 0),
      1,
    );
    const totalDone = () =>
      totalBytes - pending.reduce((n, t) => n + t.size, 0);

    let backoff = ESCORT_BACKOFF_BASE_MS;
    while (pending.length > 0 && clock.now() < deadline) {
      try {
        while (pending.length > 0) {
          const t = pending[0];
          const base = totalDone();
          const dataB64 = await docDisk.loadUpload(orgId, userId, t.uploadId);
          if (dataB64 === undefined)
            throw new Error(`stash missing for ${t.uploadId}`);
          await uploadAttachmentChunked(
            this.deps.relayFor(),
            t.name,
            t.uploadId,
            {
              readBase64: () => Promise.resolve(dataB64),
              clock,
              onProgress: fraction =>
                this.deps.onProgress?.(
                  Math.min((base + fraction * t.size) / totalBytes, 0.99),
                ),
            },
          );
          await docDisk.deleteUpload(orgId, userId, t.uploadId);
          pending = pending.slice(1);
        }
        this.deps.nudgeHost?.();
        return;
      } catch (e) {
        this.deps.log?.(
          `attachment escort failed (${e}); retrying in ${backoff}ms`,
        );
        await new Promise<void>(resolve => clock.setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, ESCORT_BACKOFF_CAP_MS);
      }
    }
    this.deps.log?.(
      `attachment escort gave up after ${
        ESCORT_DEADLINE_MS / 60_000
      }min; send stays queued`,
    );
  }
}

/** The `pending://` refs for a batch of staged transfers (what the doc row's
 * `attachments` carries before the host rewrites them). */
export const pendingRefsFor = (transfers: EscortTransfer[]): string[] =>
  transfers.map(t => pendingRef(t.uploadId, t.name));
