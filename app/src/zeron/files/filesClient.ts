// Workspace-files client — relay-forwarded RPC wrappers + a pure listing
// reducer. Wire shapes from crates/proto/src/entities.rs L384-640; method
// names from crates/rpc/src/lib.rs L153-160.

import { METHODS as RPC } from '../protocol/rpc';
import type { RelayLike } from '../attachments/upload';
import type {
  WorkspaceDirectoryPage,
  WorkspaceEntry,
  WorkspaceFileChanges,
  WorkspaceFileSearchMatch,
  WorkspaceFileText,
  WorkspaceImageChunk,
  WorkspaceTarget,
  WriteWorkspaceFileOutcome,
} from '../protocol/types';

export interface WorkspaceFilesClient {
  listDirectory(
    target: WorkspaceTarget,
    directory: string,
    opts?: { includeIgnored?: boolean; cursor?: string },
  ): Promise<WorkspaceDirectoryPage>;
  search(
    target: WorkspaceTarget,
    query: string,
    opts?: { includeIgnored?: boolean; limit?: number },
  ): Promise<WorkspaceFileSearchMatch[]>;
  readFile(target: WorkspaceTarget, path: string): Promise<WorkspaceFileText>;
  /** Chunked image read — follows nextOffset until done. */
  readImage(
    target: WorkspaceTarget,
    path: string,
    expectedCheckoutId: string,
    expectedContentHash?: string,
  ): Promise<WorkspaceImageChunk>;
  writeFile(
    target: WorkspaceTarget,
    args: {
      expectedCheckoutId: string;
      path: string;
      text: string;
      expectedContentHash: string;
      encoding?: 'utf8' | 'utf8Bom';
      lineEnding?: 'lf' | 'crlf';
    },
  ): Promise<WriteWorkspaceFileOutcome>;
  watchFiles(
    target: WorkspaceTarget,
  ): Promise<{ items: AsyncIterable<WorkspaceFileChanges>; cancel(): void }>;
}

export const workspaceFilesClient = (
  relay: RelayLike,
): WorkspaceFilesClient => ({
  listDirectory: (target, directory, opts) =>
    relay.call(RPC.LIST_WORKSPACE_DIRECTORY, {
      ...target,
      directory,
      includeIgnored: opts?.includeIgnored ?? false,
      ...(opts?.cursor !== undefined ? { cursor: opts.cursor } : {}),
    }),
  search: (target, query, opts) =>
    relay.call(RPC.SEARCH_WORKSPACE_FILES, {
      ...target,
      query,
      includeIgnored: opts?.includeIgnored ?? false,
      ...(opts?.limit !== undefined ? { limit: opts.limit } : {}),
    }),
  readFile: (target, path) =>
    relay.call(RPC.READ_WORKSPACE_FILE, { ...target, path }),
  readImage: async (target, path, expectedCheckoutId, expectedContentHash) => {
    let offset = 0;
    let merged: WorkspaceImageChunk | undefined;
    let data = '';
    for (;;) {
      const chunk = await relay.call<WorkspaceImageChunk>(
        RPC.READ_WORKSPACE_IMAGE,
        {
          ...target,
          path,
          expectedCheckoutId,
          offset,
          ...(expectedContentHash !== undefined ? { expectedContentHash } : {}),
        },
      );
      merged = { ...chunk, data };
      data += chunk.data;
      merged.data = data;
      if (chunk.done) return merged;
      offset = chunk.nextOffset;
    }
  },
  writeFile: (target, args) =>
    relay.call(RPC.WRITE_WORKSPACE_FILE, {
      expectedCheckoutId: args.expectedCheckoutId,
      ...target,
      path: args.path,
      text: args.text,
      expectedContentHash: args.expectedContentHash,
      encoding: args.encoding ?? 'utf8',
      lineEnding: args.lineEnding ?? 'lf',
    }),
  watchFiles: async target => {
    if (relay.stream === undefined)
      throw new Error('relay does not support streams');
    return relay.stream<WorkspaceFileChanges>(RPC.WATCH_WORKSPACE_FILES, {
      ...target,
    });
  },
});

// ── listing reducer (pure) ─────────────────────────────────────────────────

export type FilesPaneState = {
  directory: string;
  entries: WorkspaceEntry[];
  includeIgnored: boolean;
  nextCursor?: string;
  truncated: boolean;
  error?: string;
};

export const filesPaneReducer = (
  prev: FilesPaneState,
  event:
    | { type: 'page'; directory: string; page: WorkspaceDirectoryPage }
    | { type: 'toggleIgnored' }
    | { type: 'error'; message: string },
): FilesPaneState => {
  switch (event.type) {
    case 'page':
      return {
        ...prev,
        directory: event.directory,
        error: undefined,
        // .git is never listed by the host (ARCHITECTURE trust boundary);
        // belt-and-braces filter in case a path slips through.
        entries: event.page.entries.filter(e => e.name !== '.git'),
        nextCursor: event.page.nextCursor,
        truncated: event.page.truncated,
      };
    case 'toggleIgnored':
      return { ...prev, includeIgnored: !prev.includeIgnored };
    case 'error':
      return { ...prev, error: event.message };
  }
};
