/**
 * Synthetic Garmin series for Marta. Stress inverts the engine load formula
 * (architecture 7.3): a plateau of 0.4*L during the meeting, then a shaped
 * exponential that is back within 2 of the daily curve after 0.5*L minutes
 * and stays above the engine's recovery band until just before that.
 */
import type { CalendarFile } from '../../src/calendar/calendar-file';
import type { EpochMs, HealthData, Sample, SleepSession, WorkoutIntensity } from '../../src/engine/types';
import { expectedLoad, meetingModifiers } from './loads';
import { LOAD_NOISE_SD, PINNED_LOAD_NOISE, TODAY_STATE, TRAINING } from './persona.truth';
import type { Rng } from './prng';
import { scheduledEvents, type ScheduledMeeting } from './schedule';
import { addDays, localDateTime, MINUTE_MS, type LocalDate } from './time';

const STRESS_ASLEEP = 10;
const STRESS_DESK = 25;
const STRESS_SD = 4;
const PLATEAU_FACTOR = 0.4;
const TAIL_FACTOR = 0.5;
/** Excess at which the curve counts as back to the daily curve. */
const WITHIN = 2;
/** Engine RECOVERY_EPSILON. The curve stays above this until just before `0.5 * L`. */
const RECOVERY_EPSILON = 5;
const HR_ASLEEP = 58;
const HR_SEDENTARY = 68;
const HR_STRESS_FACTOR = 0.25;
const WAKE_MINUTE = 6 * 60 + 30;
const SLEEP_LATENCY_MIN = 15;
const TYPICAL_ASLEEP_MIN = 450;
const STEP_MS = 15 * MINUTE_MS;
const STRESS_MS = 3 * MINUTE_MS;
const HR_MS = 2 * MINUTE_MS;

export interface HealthAnchor {
  readonly today: LocalDate;
  readonly timeZone: string;
}

interface LoadedMeeting extends ScheduledMeeting {
  readonly load: number;
}

interface Span {
  readonly start: EpochMs;
  readonly end: EpochMs;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const roundTo = (value: number, digits: number): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const alignUp = (t: EpochMs, step: EpochMs): EpochMs => Math.ceil(t / step) * step;

const inSpan = (spans: readonly Span[], t: EpochMs): boolean => spans.some((span) => t >= span.start && t < span.end);

/** Excess over the daily curve for one meeting. `minutesFromStart` is 0 at the meeting start. */
export const meetingStressExcess = (load: number, minutesFromStart: number, durationMin: number): number => {
  if (!(load > 0) || minutesFromStart < 0 || !(durationMin > 0)) return 0;
  const plateau = PLATEAU_FACTOR * load;
  if (minutesFromStart <= durationMin) return plateau;
  return decayedExcess(plateau, minutesFromStart - durationMin, TAIL_FACTOR * load);
};

/**
 * Weibull-shaped exponential: flat near the plateau, equal to {@link WITHIN} at `tailMin`,
 * and crossing {@link RECOVERY_EPSILON} about 1.5 minutes before that so a 3-minute
 * sample grid records the recovery tail as `0.5 * L`.
 */
const decayedExcess = (plateau: number, minutesAfter: number, tailMin: number): number => {
  if (minutesAfter <= 0 || !(tailMin > 0)) return Math.max(0, plateau);
  if (plateau <= WITHIN) return 0;
  const targetU = Math.min(0.98, Math.max(0.5, 1 - 1.5 / tailMin));
  const logWithin = Math.log(WITHIN / plateau);
  const logEpsilon = Math.log(Math.min(RECOVERY_EPSILON, plateau - 0.01) / plateau);
  const ratio = logEpsilon / logWithin;
  const p = ratio > 0 && ratio < 1 && targetU > 0 && targetU < 1 ? Math.log(ratio) / Math.log(targetU) : 1;
  const u = minutesAfter / tailMin;
  return Math.max(0, plateau * Math.exp(logWithin * u ** Math.max(p, 1)));
};

const workoutStress = (intensity: WorkoutIntensity): number =>
  intensity === 'intervals' ? 64 : intensity === 'tempo' ? 50 : intensity === 'long' ? 42 : 36;

const workoutHeartRate = (intensity: WorkoutIntensity, minuteInto: number): number => {
  if (intensity === 'intervals') return minuteInto % 6 < 3 ? 172 : 128;
  if (intensity === 'tempo') return 158;
  if (intensity === 'long') return 142;
  return 132;
};

const lastWeekday = (today: LocalDate): LocalDate =>
  [1, 2, 3].map((days) => addDays(today, -days)).find((date) => {
    const utc = new Date(`${date}T00:00:00Z`).getUTCDay();
    return utc !== 0 && utc !== 6;
  }) ?? addDays(today, -1);

const bucketStart = (t: EpochMs): EpochMs => Math.floor(t / STEP_MS) * STEP_MS;

interface NightPlan {
  readonly wakeDate: LocalDate;
  readonly session: SleepSession;
  readonly hrvMean: number;
}

const daysBefore = (today: LocalDate, wakeDate: LocalDate): number =>
  Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${wakeDate}T00:00:00Z`)) / 86_400_000);

const nightPlans = (anchor: HealthAnchor, hardWakeDates: ReadonlySet<LocalDate>): readonly NightPlan[] => {
  const { today, timeZone } = anchor;
  const means: number[] = [];
  const plans: NightPlan[] = [];
  for (let wakeDate = addDays(today, -42); wakeDate <= today; wakeDate = addDays(wakeDate, 1)) {
    const daysAgo = daysBefore(today, wakeDate);
    const previous = means.slice(-7);
    const previousMean =
      previous.length > 0 ? previous.reduce((sum, value) => sum + value, 0) / previous.length : TODAY_STATE.personalHrvMs;
    const asleepMin =
      daysAgo >= 0 && daysAgo < TODAY_STATE.recentAsleepMin.length ? TODAY_STATE.recentAsleepMin[daysAgo]! : TYPICAL_ASLEEP_MIN;
    const recentFactor =
      daysAgo >= 1 && daysAgo <= TODAY_STATE.recentHrvFactors.length ? TODAY_STATE.recentHrvFactors[daysAgo - 1] : undefined;
    const hrvMean =
      daysAgo === 0
        ? TODAY_STATE.lastNightHrvRatio * previousMean
        : recentFactor !== undefined
          ? TODAY_STATE.personalHrvMs * recentFactor
          : hardWakeDates.has(wakeDate)
            ? TRAINING.hrvFactorAfterHardBeforeHeavy * previousMean
            : TODAY_STATE.personalHrvMs;
    means.push(hrvMean);
    const end = localDateTime(wakeDate, WAKE_MINUTE, timeZone);
    const start = end - (asleepMin + SLEEP_LATENCY_MIN) * MINUTE_MS;
    plans.push({ wakeDate, session: { start, end, asleepMin }, hrvMean });
  }
  return plans;
};

const loadMeetings = (
  meetings: readonly ScheduledMeeting[],
  pendingId: string | undefined,
  boardId: string | undefined,
  timeZone: string,
  rng: Rng,
): readonly LoadedMeeting[] => {
  const byDate = new Map<LocalDate, ScheduledMeeting[]>();
  meetings.forEach((meeting) => {
    const day = byDate.get(meeting.date) ?? [];
    day.push(meeting);
    byDate.set(meeting.date, day);
  });
  return [...meetings]
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    .map((meeting) => {
      const noise =
        meeting.id === boardId
          ? PINNED_LOAD_NOISE.mostRecentBoard
          : meeting.id === pendingId
            ? PINNED_LOAD_NOISE.pendingCheckIn
            : rng.gaussian(0, LOAD_NOISE_SD);
      const sameDay = byDate.get(meeting.date) ?? [meeting];
      return { ...meeting, load: expectedLoad(meeting, meetingModifiers(meeting, sameDay, timeZone)) + noise };
    });
};

const walkingBuckets = (meetings: readonly LoadedMeeting[], rng: Rng): ReadonlySet<EpochMs> => {
  const eligible = meetings.filter((meeting) => {
    const bucket = bucketStart(meeting.start - 1);
    const bucketEnd = bucket + STEP_MS;
    return bucketEnd <= meeting.start && meetings.every((other) => other.end <= bucket || other.start >= bucketEnd);
  });
  const wanted = Math.round(meetings.length * 0.2);
  return new Set(rng.shuffle(eligible).slice(0, Math.min(wanted, eligible.length)).map((meeting) => bucketStart(meeting.start - 1)));
};

const curveExcess = (meetings: readonly LoadedMeeting[], t: EpochMs): number =>
  meetings.reduce((sum, meeting) => {
    if (t < meeting.start) return sum;
    const durationMin = (meeting.end - meeting.start) / MINUTE_MS;
    return sum + meetingStressExcess(meeting.load, (t - meeting.start) / MINUTE_MS, durationMin);
  }, 0);

const rangeOf = (nights: readonly NightPlan[], anchor: HealthAnchor, now: EpochMs): Span => {
  const historyStart = localDateTime(addDays(anchor.today, -42), 0, anchor.timeZone);
  const firstSleep = nights[0]?.session.start ?? historyStart;
  return { start: Math.min(historyStart, firstSleep), end: now };
};

const samplesBetween = (range: Span, step: EpochMs, value: (t: EpochMs) => number): Sample[] => {
  const samples: Sample[] = [];
  for (let t = alignUp(range.start, step); t <= range.end; t += step) samples.push({ t, v: value(t) });
  return samples;
};

export const generateHealth = (calendar: CalendarFile, anchor: HealthAnchor, now: EpochMs, rng: Rng): HealthData => {
  const { meetings, workouts } = scheduledEvents(calendar, anchor.timeZone);
  const history = meetings.filter((meeting) => meeting.date < anchor.today && meeting.end <= now);
  const pendingDay = lastWeekday(anchor.today);
  const pendingId = history.filter((meeting) => meeting.date === pendingDay).sort((a, b) => b.start - a.start)[0]?.id;
  const boardId = history.filter((meeting) => meeting.type === 'board').sort((a, b) => a.start - b.start).at(-1)?.id;
  const loaded = loadMeetings(history, pendingId, boardId, anchor.timeZone, rng);
  const hardWakeDates = new Set(
    workouts
      .filter((workout) => workout.date < anchor.today && workout.intensity === 'intervals')
      .map((workout) => addDays(workout.date, 1))
      .filter((date) => history.some((meeting) => meeting.type === 'board' && meeting.date === date)),
  );
  const nights = nightPlans(anchor, hardWakeDates).filter((night) => night.session.end <= now);
  const sleeps = nights.map((night) => night.session);
  const pastWorkouts = workouts.filter((workout) => workout.start < now);
  const range = rangeOf(nights, anchor, now);
  const walking = walkingBuckets(loaded, rng);
  const runBuckets = new Set(
    pastWorkouts.flatMap((workout) => {
      const buckets: EpochMs[] = [];
      for (let t = bucketStart(workout.start); t < workout.end; t += STEP_MS) buckets.push(t);
      return buckets;
    }),
  );

  const baseStress = (t: EpochMs): number => {
    if (inSpan(sleeps, t)) return STRESS_ASLEEP;
    const workout = pastWorkouts.find((item) => t >= item.start && t < item.end);
    if (workout) return workoutStress(workout.intensity);
    return STRESS_DESK + curveExcess(loaded, t);
  };

  const stress = samplesBetween(range, STRESS_MS, (t) =>
    roundTo(clamp(baseStress(t) + rng.gaussian(0, STRESS_SD), 0, 100), 1),
  );

  const heartRate = samplesBetween(range, HR_MS, (t) => {
    if (inSpan(sleeps, t)) return roundTo(clamp(HR_ASLEEP + rng.gaussian(0, 1.2), 35, 220), 1);
    const workout = pastWorkouts.find((item) => t >= item.start && t < item.end);
    if (workout) {
      return roundTo(clamp(workoutHeartRate(workout.intensity, (t - workout.start) / MINUTE_MS) + rng.gaussian(0, 2), 35, 220), 1);
    }
    const excess = Math.max(0, curveExcess(loaded, t));
    return roundTo(clamp(HR_SEDENTARY + HR_STRESS_FACTOR * excess + rng.gaussian(0, 1.5), 35, 220), 1);
  });

  const steps = samplesBetween(range, STEP_MS, (t) => {
    const bucket = bucketStart(t);
    if (runBuckets.has(bucket)) return rng.int(2000, 2800);
    if (walking.has(bucket)) return rng.int(400, 900);
    return rng.int(5, 55);
  });

  const todayWake = localDateTime(anchor.today, WAKE_MINUTE, anchor.timeZone);
  const batteryState = { value: 70, pinnedWake: false };
  const bodyBattery = samplesBetween(range, STEP_MS, (t) => {
    const moving = (runBuckets.has(bucketStart(t)) || walking.has(bucketStart(t)));
    if (inSpan(sleeps, t)) batteryState.value = Math.min(100, batteryState.value + 1.1);
    else if (moving) batteryState.value = Math.max(5, batteryState.value - 2.4);
    else batteryState.value = Math.max(5, batteryState.value - 0.35 - baseStress(t) / 90);
    if (!batteryState.pinnedWake && t >= todayWake && t <= todayWake + 60 * MINUTE_MS) {
      batteryState.value = TODAY_STATE.bodyBatteryAtWake;
      batteryState.pinnedWake = true;
    }
    return Math.round(clamp(batteryState.value, 0, 100));
  });

  const hrv = nights.flatMap((night) => {
    const readings: Sample[] = [];
    for (let t = night.session.start + 5 * MINUTE_MS; t < night.session.end && t <= now; t += 10 * MINUTE_MS) {
      readings.push({ t, v: roundTo(night.hrvMean, 2) });
    }
    return readings;
  });

  return {
    stress,
    heartRate,
    steps,
    bodyBattery,
    hrv,
    sleeps,
    resilienceScore: TODAY_STATE.resilience,
  };
};
