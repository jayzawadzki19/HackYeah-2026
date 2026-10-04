import type { EpochMs } from './types';

/** Wall-clock parts in a time zone. `weekday`: 0 = Sunday ... 6 = Saturday. */
export interface LocalParts {
  readonly date: string;
  readonly hour: number;
  readonly minute: number;
  readonly weekday: number;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const MAX_CACHED_HOURS_PER_ZONE = 200_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
const offsetsByZone = new Map<string, Map<number, number>>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  formatters.set(timeZone, created);
  return created;
};

const computeOffset = (t: EpochMs, timeZone: string): number => {
  const parts = new Map(formatterFor(timeZone).formatToParts(new Date(t)).map((p) => [p.type, Number(p.value)]));
  const part = (type: Intl.DateTimeFormatPartTypes): number => parts.get(type) ?? 0;
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second'));
  return wall - t;
};

/**
 * UTC offset (ms) of `timeZone` at instant `t`. Cached per UTC hour: zone transitions
 * happen on whole UTC hours, so every instant inside an hour shares one offset.
 */
export const offsetAt = (t: EpochMs, timeZone: string): number => {
  const hourStart = Math.floor(t / HOUR_MS) * HOUR_MS;
  const zoneCache = offsetsByZone.get(timeZone) ?? new Map<number, number>();
  if (!offsetsByZone.has(timeZone)) offsetsByZone.set(timeZone, zoneCache);
  const cached = zoneCache.get(hourStart);
  if (cached !== undefined) return cached;
  if (zoneCache.size >= MAX_CACHED_HOURS_PER_ZONE) zoneCache.clear();
  const offset = computeOffset(hourStart, timeZone);
  zoneCache.set(hourStart, offset);
  return offset;
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

const isoDate = (d: Date): string => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

export const localParts = (t: EpochMs, timeZone: string): LocalParts => {
  const wall = new Date(t + offsetAt(t, timeZone));
  return { date: isoDate(wall), hour: wall.getUTCHours(), minute: wall.getUTCMinutes(), weekday: wall.getUTCDay() };
};

/** Hot-path variant of `localParts(t).hour`. */
export const localHour = (t: EpochMs, timeZone: string): number =>
  ((Math.floor((t + offsetAt(t, timeZone)) / HOUR_MS) % 24) + 24) % 24;

export const localDate = (t: EpochMs, timeZone: string): string => isoDate(new Date(t + offsetAt(t, timeZone)));

interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const parseDate = (date: string): CivilDate => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const [year, month, day] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [NaN, NaN, NaN];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (!match || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  }
  return { year, month, day };
};

const parseHm = (hm: string): { readonly hour: number; readonly minute: number } => {
  const match = /^(\d{2}):(\d{2})$/.exec(hm);
  const [hour, minute] = match ? [Number(match[1]), Number(match[2])] : [NaN, NaN];
  if (!match || hour > 23 || minute > 59) throw new Error(`Invalid time "${hm}", expected HH:mm`);
  return { hour, minute };
};

/**
 * Epoch ms of a local wall-clock time. DST-safe with "compatible" disambiguation:
 * an ambiguous time (fall-back) resolves to the earlier instant, a non-existent
 * time (spring-forward gap) shifts forward by the gap.
 */
export const localDateTime = (date: string, hm: string, timeZone: string): EpochMs => {
  const { year, month, day } = parseDate(date);
  const { hour, minute } = parseHm(hm);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsetBefore = offsetAt(wall - DAY_MS, timeZone);
  const offsetAfter = offsetAt(wall + DAY_MS, timeZone);
  const valid = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => wall - offset)
    .filter((t) => t + offsetAt(t, timeZone) === wall)
    .sort((a, b) => a - b);
  return valid[0] ?? wall - offsetBefore;
};

export const startOfLocalDay = (date: string, timeZone: string): EpochMs => localDateTime(date, '00:00', timeZone);

export const addLocalDays = (date: string, days: number): string => {
  const { year, month, day } = parseDate(date);
  return isoDate(new Date(Date.UTC(year, month - 1, day + days)));
};

export const weekdayOf = (date: string): number => {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};
