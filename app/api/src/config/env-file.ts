import { existsSync, readFileSync } from 'node:fs';

type EnvRecord = Readonly<Record<string, string | undefined>>;

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

const unquote = (value: string): string => {
  const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0];
  return quoted ? value.slice(1, -1) : value;
};

const parseLine = (line: string): readonly [string, string] | null => {
  const match = LINE.exec(line);
  return match?.[1] !== undefined && match[2] !== undefined ? [match[1], unquote(match[2])] : null;
};

const isEntry = (entry: readonly [string, string] | null): entry is readonly [string, string] => entry !== null;

/** Minimal dotenv reader: KEY=VALUE lines, `#` comments, optional quotes and `export` prefix. */
export const parseEnvFile = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('#'))
      .map(parseLine)
      .filter(isEntry),
  );

const formatValue = (value: string): string => (/[\s#"']/.test(value) ? JSON.stringify(value) : value);

/** Updates keys in place, keeps every other line (comments included) and appends keys that were missing. */
export const mergeEnvFile = (existing: string, updates: Readonly<Record<string, string>>): string => {
  const lines = existing === '' ? [] : existing.replace(/\r?\n$/, '').split(/\r?\n/);
  const keyOf = (line: string) => (line.trimStart().startsWith('#') ? null : (parseLine(line)?.[0] ?? null));
  const present = new Set(lines.map(keyOf).filter((key): key is string => key !== null));
  const replaced = lines.map((line) => {
    const key = keyOf(line);
    return key !== null && key in updates ? `${key}=${formatValue(updates[key] ?? '')}` : line;
  });
  const appended = Object.entries(updates)
    .filter(([key]) => !present.has(key))
    .map(([key, value]) => `${key}=${formatValue(value)}`);
  return `${[...replaced, ...appended].join('\n')}\n`;
};

/** Reads an optional env file and overlays the process environment on top of it. */
export const loadEnvironment = (filePath: string, processEnv: EnvRecord): EnvRecord => ({
  ...(existsSync(filePath) ? parseEnvFile(readFileSync(filePath, 'utf8')) : {}),
  ...Object.fromEntries(Object.entries(processEnv).filter(([, value]) => value !== undefined)),
});
