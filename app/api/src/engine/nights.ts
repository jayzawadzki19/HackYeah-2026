import { groupBy, mean } from './math';
import { ensureSorted, samplesIn } from './series';
import { localDate } from './time';
import type { Sample, SleepSession } from './types';

/** The main sleep per local wake date with the mean of the HRV readings recorded inside it. */
export interface Night {
  /** local date the session ended (wake-up date) */
  readonly date: string;
  readonly session: SleepSession;
  readonly hrvMean: number | null;
}

const longest = (sessions: readonly SleepSession[]): SleepSession =>
  sessions.reduce((best, s) => (s.asleepMin > best.asleepMin || (s.asleepMin === best.asleepMin && s.end > best.end) ? s : best));

export const buildNights = (sleeps: readonly SleepSession[], hrv: readonly Sample[], timeZone: string): readonly Night[] => {
  const sortedHrv = ensureSorted(hrv);
  return [...groupBy(sleeps, (s) => localDate(s.end, timeZone))]
    .map(([date, sessions]) => {
      const session = longest(sessions);
      return { date, session, hrvMean: mean(samplesIn(sortedHrv, session.start, session.end + 1).map((s) => s.v)) };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
};
