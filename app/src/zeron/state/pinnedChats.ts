/** Split a recency-sorted chat list into pinned (prefs order) vs the rest. */

export const partitionPinnedChats = <T extends { id: string }>(
  chats: readonly T[],
  pinnedIds: readonly string[],
): { pinned: T[]; rest: T[] } => {
  const byId = new Map(chats.map(c => [c.id, c]));
  const pinned: T[] = [];
  const pinnedSet = new Set<string>();
  for (const id of pinnedIds) {
    const chat = byId.get(id);
    if (chat === undefined) continue;
    pinned.push(chat);
    pinnedSet.add(id);
  }
  return {
    pinned,
    rest: chats.filter(c => !pinnedSet.has(c.id)),
  };
};
