const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const pad = (value: number): string => String(value).padStart(2, '0');

const partsOf = (iso: string, timeZone: string): { year: string; month: string; day: string } => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const read = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? '';
  return { year: read('year'), month: read('month'), day: read('day') };
};

const utcNoon = (isoDate: string): Date => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12));
};

/** Local calendar date (YYYY-MM-DD) for an instant in the user's time zone. */
export const localDate = (iso: string, timeZone: string): string => {
  const { year, month, day } = partsOf(iso, timeZone);
  return `${year}-${month}-${day}`;
};

/** 24-hour local time, `HH:mm`. */
export const timeOf = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

export const weekdayOf = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long' }).format(new Date(iso));

/** A calendar date, not an instant, so it never shifts with the time zone. */
export const shortDate = (isoDate: string): string => {
  const date = utcNoon(isoDate);
  const weekday = WEEKDAYS_SHORT[date.getUTCDay()] ?? 'Mon';
  const month = MONTHS_SHORT[date.getUTCMonth()] ?? 'Jan';
  return `${weekday} ${date.getUTCDate()} ${month}`;
};

export const addDays = (isoDate: string, days: number): string => {
  const date = utcNoon(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

export const dayLabel = (date: string, today: string): string => {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return shortDate(date);
};

export const relativeAgo = (iso: string | null, now: number): string => {
  if (!iso) return 'never';
  const delta = now - Date.parse(iso);
  if (delta < 60_000) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
};

export const durationText = (minutes: number): string => {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
};

export const weekdayOfDate = (isoDate: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(utcNoon(isoDate));
