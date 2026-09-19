/** Compact working-duration labels: 58s, 34m, 12h, 47h, 138h — never days. */

export const formatWorkingElapsed = (at: number, now: number): string => {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
};
