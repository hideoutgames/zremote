/** Compact working-duration labels: 58s, 34m, 12h, 47h, 138h — never days. */

export const formatWorkingElapsed = (at: number, now: number): string => {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
};

/** Completed-turn labels: 38s, 14m 38s, 2h 12m, 73h 12m — never days. */
export const formatWorkedDuration = (secs: number): string => {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

export const formatWorkedDurationRange = (
  startedAt: number,
  endedAt: number,
): string =>
  formatWorkedDuration(Math.max(0, Math.floor((endedAt - startedAt) / 1000)));
