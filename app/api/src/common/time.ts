const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const existing = formatters.get(timeZone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(timeZone, created);
  return created;
};

interface WallClock {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
  readonly second: string;
}

const wallClock = (t: number, timeZone: string): WallClock => {
  const parts = new Map(formatterFor(timeZone).formatToParts(new Date(t)).map((part) => [part.type, part.value]));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.get(type) ?? '00';
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
};

const pad = (n: number) => String(n).padStart(2, '0');

const offsetLabel = (offsetMinutes: number): string => {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

/** ISO 8601 with the zone's offset at that instant, e.g. "2026-10-05T10:00:00+02:00". */
export const isoInZone = (t: number, timeZone: string): string => {
  const wall = wallClock(t, timeZone);
  const asUtc = Date.UTC(+wall.year, +wall.month - 1, +wall.day, +wall.hour, +wall.minute, +wall.second);
  const offsetMinutes = Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60_000);
  return `${wall.year}-${wall.month}-${wall.day}T${wall.hour}:${wall.minute}:${wall.second}${offsetLabel(offsetMinutes)}`;
};

export const localDate = (t: number, timeZone: string): string => isoInZone(t, timeZone).slice(0, 10);

export const localClock = (t: number, timeZone: string): string => isoInZone(t, timeZone).slice(11, 16);
