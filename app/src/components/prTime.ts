// Relative timestamps and day grouping for the PR commit timeline.

export const parseCommitTime = (iso: string): number => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
};

const startOfLocalDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export type CommitDayKey = 'today' | 'yesterday' | string;

export const commitDayKey = (atMs: number, nowMs: number): CommitDayKey => {
  const day = startOfLocalDay(atMs);
  const today = startOfLocalDay(nowMs);
  const days = Math.round((today - day) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return new Date(atMs).toLocaleDateString();
};

export const formatRelativeShort = (atMs: number, nowMs: number): string => {
  const s = Math.max(0, Math.floor((nowMs - atMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(atMs).toLocaleDateString();
};

export interface CommitDayGroup<T> {
  key: CommitDayKey;
  items: T[];
}

export const groupByCommitDay = <T extends { authoredAt: string }>(
  commits: readonly T[],
  nowMs: number,
): CommitDayGroup<T>[] => {
  const groups: CommitDayGroup<T>[] = [];
  for (const commit of commits) {
    const key = commitDayKey(parseCommitTime(commit.authoredAt), nowMs);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.items.push(commit);
    else groups.push({ key, items: [commit] });
  }
  return groups;
};
