import { isSedentary, sedentaryBuckets, type Baseline, type StepBuckets } from './baseline';
import { ENGINE_CONFIG, type EngineConfig } from './engine.config';
import { clamp, mean, round0, round1 } from './math';
import { ensureSorted, lowerBound, samplesIn } from './series';
import { localHour, MINUTE_MS } from './time';
import type { EngineMeeting, EpochMs, HealthData, InsufficientReason, Measured, Sample } from './types';

export interface MeetingLoad {
  readonly load: number;
  readonly excessStress: number;
  readonly recoveryTailMin: number;
  readonly validSamples: number;
  readonly signal: 'stress' | 'hr';
  /** first of the consecutive recovered samples; null when the tail hit the cap */
  readonly recoveredAt: EpochMs | null;
}

export interface MeetingModifiers {
  readonly backToBack: boolean;
  readonly lateStart: boolean;
}

export interface MeasureMeetingInput {
  readonly meeting: Pick<EngineMeeting, 'start' | 'end'>;
  readonly health: HealthData;
  readonly baseline: Baseline;
  readonly timeZone: string;
}

const EXCESS_WEIGHT = 2;
const TAIL_WEIGHT = 0.4;
const HR_EXCESS_SCALE = 2;
/** A capped tail needs valid samples up to at least this close to the end of the recovery window. */
const RECOVERY_COVERAGE_SLACK_MIN = 15;

const NO_DATA_DETAIL = 'No stress or heart-rate data during this meeting.';

interface SignalSpec {
  readonly signal: MeetingLoad['signal'];
  readonly samples: readonly Sample[];
  readonly baselineByHour: readonly (number | null)[];
  readonly scale: number;
}

interface SignalOutcome {
  readonly result: Measured<MeetingLoad>;
  readonly hadSamples: boolean;
}

interface ExcessPoint {
  readonly t: EpochMs;
  readonly excess: number;
}

const insufficient = (reason: InsufficientReason, detail: string): Measured<MeetingLoad> => ({
  kind: 'insufficient',
  reason,
  detail,
});

const measureSignal = (
  spec: SignalSpec,
  meeting: MeasureMeetingInput['meeting'],
  buckets: StepBuckets,
  timeZone: string,
  cfg: EngineConfig,
): SignalOutcome => {
  const sorted = ensureSorted(spec.samples);
  const toExcess = (s: Sample): readonly ExcessPoint[] => {
    const base = spec.baselineByHour[localHour(s.t, timeZone)];
    return base === null || base === undefined ? [] : [{ t: s.t, excess: spec.scale * (s.v - base) }];
  };
  const still = (s: Sample): boolean => isSedentary(s.t, buckets, cfg);

  const during = samplesIn(sorted, meeting.start, meeting.end);
  if (during.length === 0) return { result: insufficient('no_samples', NO_DATA_DETAIL), hadSamples: false };
  const sedentary = during.filter(still);
  if (sedentary.length < cfg.MIN_VALID_SAMPLES_PER_MEETING) {
    return {
      result: insufficient(
        'too_few_sedentary_samples',
        `You were moving for most of this meeting: ${sedentary.length} still samples, ${cfg.MIN_VALID_SAMPLES_PER_MEETING} needed.`,
      ),
      hadSamples: true,
    };
  }
  const excesses = sedentary.flatMap(toExcess);
  if (excesses.length < cfg.MIN_VALID_SAMPLES_PER_MEETING) {
    return { result: insufficient('no_baseline', 'No personal baseline for this time of day yet.'), hadSamples: true };
  }

  const capEnd = meeting.end + cfg.RECOVERY_CAP_MIN * MINUTE_MS;
  const after = sorted.slice(lowerBound(sorted, meeting.end), lowerBound(sorted, capEnd + 1)).filter(still).flatMap(toExcess);
  const recoveredIndex = after.findIndex(
    (_, i) =>
      i + cfg.RECOVERY_CONSECUTIVE <= after.length &&
      after.slice(i, i + cfg.RECOVERY_CONSECUTIVE).every((p) => p.excess <= cfg.RECOVERY_EPSILON),
  );
  const recoveredAt = recoveredIndex >= 0 ? after[recoveredIndex]!.t : null;
  const observedToCap = (after.at(-1)?.t ?? -Infinity) >= capEnd - RECOVERY_COVERAGE_SLACK_MIN * MINUTE_MS;
  if (recoveredAt === null && !observedToCap) {
    return {
      result: insufficient('no_samples', 'Not enough data after the meeting to measure recovery yet.'),
      hadSamples: true,
    };
  }

  const excessStress = mean(excesses.map((p) => p.excess))!;
  const recoveryTailMin = recoveredAt === null ? cfg.RECOVERY_CAP_MIN : round0((recoveredAt - meeting.end) / MINUTE_MS);
  return {
    result: {
      kind: 'ok',
      value: {
        load: round1(clamp(EXCESS_WEIGHT * excessStress + TAIL_WEIGHT * recoveryTailMin, 0, 100)),
        excessStress: round1(excessStress),
        recoveryTailMin,
        validSamples: excesses.length,
        signal: spec.signal,
        recoveredAt,
      },
    },
    hadSamples: true,
  };
};

/** Architecture 7.3: excess stress against the personal baseline plus the recovery tail; heart-rate fallback. */
export const measureMeetingLoad = (input: MeasureMeetingInput, cfg: EngineConfig = ENGINE_CONFIG): Measured<MeetingLoad> => {
  const { meeting, health, baseline, timeZone } = input;
  const buckets = sedentaryBuckets(health.steps);
  const stress = measureSignal(
    { signal: 'stress', samples: health.stress, baselineByHour: baseline.stressByHour, scale: 1 },
    meeting,
    buckets,
    timeZone,
    cfg,
  );
  if (stress.result.kind === 'ok') return stress.result;
  const hr = measureSignal(
    { signal: 'hr', samples: health.heartRate, baselineByHour: baseline.hrByHour, scale: HR_EXCESS_SCALE },
    meeting,
    buckets,
    timeZone,
    cfg,
  );
  if (hr.result.kind === 'ok') return hr.result;
  return stress.hadSamples ? stress.result : hr.result;
};

export const meetingModifiers = (
  meeting: Pick<EngineMeeting, 'id' | 'start' | 'end'>,
  sameDayMeetings: readonly Pick<EngineMeeting, 'id' | 'start' | 'end'>[],
  timeZone: string,
  cfg: EngineConfig = ENGINE_CONFIG,
): MeetingModifiers => ({
  backToBack: sameDayMeetings.some(
    (other) =>
      other.id !== meeting.id &&
      other.start < meeting.start &&
      meeting.start - other.end <= cfg.BACK_TO_BACK_GAP_MIN * MINUTE_MS,
  ),
  lateStart: localHour(meeting.start, timeZone) >= cfg.LATE_START_HOUR,
});

export const modifierOffset = (modifiers: MeetingModifiers, cfg: EngineConfig = ENGINE_CONFIG): number =>
  (modifiers.backToBack ? cfg.BACK_TO_BACK_PENALTY : 0) + (modifiers.lateStart ? cfg.LATE_START_PENALTY : 0);
