// Structured JSON logs, one object per line on stdout (stderr for warn/error). BigInts become strings;
// any field whose name looks like a secret is redacted, as a last line of defence.

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET = /(private|secret|mnemonic|passw|^key$|apikey)/i;

let minLevel: Level = (process.env.LOG_LEVEL as Level) in ORDER ? (process.env.LOG_LEVEL as Level) : 'info';
let sink: ((line: string, level: Level) => void) | undefined;

export function setLogSink(fn: ((line: string, level: Level) => void) | undefined): void {
  sink = fn;
}

export function setLogLevel(l: Level): void {
  minLevel = l;
}

export function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (k, v) => {
      if (k && SECRET.test(k)) return '[redacted]';
      if (typeof v === 'bigint') return v.toString();
      if (v instanceof Error) return { name: v.name, message: v.message.split('\n')[0] };
      return v;
    }),
  );
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < ORDER[minLevel]) return;
  const line = JSON.stringify(jsonSafe({ t: new Date().toISOString(), level, event, ...fields }));
  if (sink) return sink(line, level);
  (level === 'warn' || level === 'error' ? process.stderr : process.stdout).write(line + '\n');
}
