import type { EpochMs } from '../../src/engine/types';

/** Calendar date in the persona's time zone, `YYYY-MM-DD`. */
export type LocalDate = string;

export interface LocalParts {
  readonly date: LocalDate;
  readonly hour: number;
  readonly minute: number;
  readonly minuteOfDay: number;
  /** 0 = Sunday ... 6 = Saturday */
  readonly weekday: number;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const formatters = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
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

/** UTC offset in minutes; cached per UTC hour because zone transitions happen on hour boundaries. */
const offsetMinutes = (t: EpochMs, timeZone: string): number => {
  const hourStart = Math.floor(t / HOUR_MS) * HOUR_MS;
  const key = `${timeZone}|${hourStart}`;
  const cached = offsets.get(key);
  if (cached !== undefined) return cached;
  const parts = formatterFor(timeZone).formatToParts(new Date(hourStart));
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  const offset = Math.round((wallAsUtc - hourStart) / MINUTE_MS);
  offsets.set(key, offset);
  return offset;
};

const parseDate = (date: LocalDate): readonly [number, number, number] => {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) throw new Error(`Invalid date ${date}`);
  return [year, month, day];
};

const utcMidnight = (date: LocalDate): EpochMs => {
  const [year, month, day] = parseDate(date);
  return Date.UTC(year, month - 1, day);
};

const pad = (n: number): string => String(n).padStart(2, '0');

export const localParts = (t: EpochMs, timeZone: string): LocalParts => {
  const wall = new Date(t + offsetMinutes(t, timeZone) * MINUTE_MS);
  const hour = wall.getUTCHours();
  const minute = wall.getUTCMinutes();
  return {
    date: wall.toISOString().slice(0, 10),
    hour,
    minute,
    minuteOfDay: hour * 60 + minute,
    weekday: wall.getUTCDay(),
  };
};

/** Epoch ms of a local wall time; two passes make it correct on DST transition days. */
export const localDateTime = (date: LocalDate, minuteOfDay: number, timeZone: string): EpochMs => {
  const wallAsUtc = utcMidnight(date) + minuteOfDay * MINUTE_MS;
  const firstGuess = wallAsUtc - offsetMinutes(wallAsUtc, timeZone) * MINUTE_MS;
  return wallAsUtc - offsetMinutes(firstGuess, timeZone) * MINUTE_MS;
};

export const startOfLocalDay = (date: LocalDate, timeZone: string): EpochMs => localDateTime(date, 0, timeZone);

export const addDays = (date: LocalDate, days: number): LocalDate =>
  new Date(utcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10);

export const weekdayOf = (date: LocalDate): number => new Date(utcMidnight(date)).getUTCDay();

export const zoneOffset = (t: EpochMs, timeZone: string): string => {
  const offset = offsetMinutes(t, timeZone);
  const sign = offset < 0 ? '-' : '+';
  return `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
};

export const isoWithOffset = (t: EpochMs, timeZone: string): string => {
  const wall = new Date(t + offsetMinutes(t, timeZone) * MINUTE_MS);
  return `${wall.toISOString().slice(0, 19)}${zoneOffset(t, timeZone)}`;
};
