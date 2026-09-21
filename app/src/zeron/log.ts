// Redacted logging for the app/runtime boundary. NEVER logs tokens, prompts,
// repo paths, or doc payloads by default — callers pass a redaction-safe
// string. `log.debug` is a no-op unless DEV logging is enabled.

export type LogSink = (line: string) => void;

const SENSITIVE =
  /(token|bearer|authorization|password|secret|prompt|refresh|transcript|dictation|whisper|cleanup output|\baudio\b)/i;

const defaultSink: LogSink = line => {
  console.log(`[zeron] ${line}`);
};

/**
 * `redact(text)` scrubs anything that looks like a credential or free-form
 * user content out of a log line. Prefer structured fields (`log('room
 * connected', {chat: id})`) over interpolating values.
 */
export const redact = (line: string): string =>
  line
    .replace(
      /(token|bearer|authorization|key|secret)=?\s*\S+/gi,
      '$1=<redacted>',
    )
    .replace(/user[\w.+-]*@[\w.-]+/g, 'user@<redacted>');

export const createLog = (sink: LogSink = defaultSink) => ({
  info: (line: string) => sink(redact(line)),
  warn: (line: string) => sink(`warn: ${redact(line)}`),
  error: (line: string) => sink(`error: ${redact(line)}`),
  /** Debug lines can mention payload sizes, never contents. */
  debug: (line: string) => {
    if (__DEV__ && !SENSITIVE.test(line)) sink(`debug: ${redact(line)}`);
  },
});

export type ZeronLog = ReturnType<typeof createLog>;
