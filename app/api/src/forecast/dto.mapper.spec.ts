import { describe, expect, test } from 'bun:test';
import type { UserSummaryDto } from '../../../contracts/api-contract';
import {
  at,
  BOARD,
  forecastFixture,
  INTERVALS,
  PAST_BOARD_MEASURED,
  PEOPLE,
  RESET_ACTION,
  SLEEP_ACTION,
  SWAP_ACTION,
} from '../../test/support/forecast-fixture';
import type { HealthData } from '../engine/types';
import { blockFromChange, buildSnapshot, liveDto, mappingContext, toMeasuredDto, toPredictedMeetingDto } from './dto.mapper';

const TZ = 'Europe/Warsaw';
const ctx = mappingContext(TZ, PEOPLE);
const MARTA: UserSummaryDto = { key: 'marta', displayName: 'Marta', isSynthetic: true, live: false, timeZone: TZ };

const emptyHealth: HealthData = {
  stress: [],
  heartRate: [],
  steps: [],
  bodyBattery: [],
  hrv: [],
  sleeps: [],
  resilienceScore: null,
};

describe('toPredictedMeetingDto', () => {
  test('maps times to zoned ISO, attendees to people and rounds the load', () => {
    expect(toPredictedMeetingDto({ ...forecastFixture().upcoming[0]!, load: 83.1234 }, ctx)).toEqual({
      id: 'm-board-tomorrow',
      title: 'Board meeting',
      type: 'board',
      start: '2026-10-05T10:00:00+02:00',
      end: '2026-10-05T12:00:00+02:00',
      attendees: [
        { id: 'p-anna', name: 'Anna Kowalska', role: 'Lead investor' },
        { id: 'p-kasia', name: 'Kasia Wójcik', role: 'Independent board member' },
        { id: 'p-piotr', name: 'Piotr Nowak', role: 'Co-founder, CTO' },
      ],
      isGroup: false,
      predictedLoad: 83.1,
      basis: {
        typeMeetings: 3,
        personMeetings: [{ personId: 'p-piotr', meetings: 15 }],
        label: 'Based on 3 of your meetings + population default',
      },
      modifiers: { backToBack: false, lateStart: false },
    });
  });
});

describe('blockFromChange', () => {
  test('turns a sleep target into a "Lights out" block for the next day', () => {
    expect(blockFromChange(SLEEP_ACTION.id, SLEEP_ACTION.change, ctx)).toEqual({
      id: 'block:sleep_target:2026-10-05',
      actionId: 'sleep_target:2026-10-05',
      title: 'Lights out 22:45',
      start: '2026-10-04T22:45:00+02:00',
      end: '2026-10-05T06:30:00+02:00',
      forDate: '2026-10-05',
    });
  });

  test('keeps the title of an added block', () => {
    expect(blockFromChange(RESET_ACTION.id, RESET_ACTION.change, ctx)).toMatchObject({
      title: '10-minute walk',
      start: '2026-10-05T09:45:00+02:00',
      forDate: '2026-10-05',
    });
  });

  test('has no block for a moved workout', () => {
    expect(blockFromChange(SWAP_ACTION.id, SWAP_ACTION.change, ctx)).toBeNull();
  });
});

describe('toMeasuredDto', () => {
  test('rounds numbers and formats the recovery time', () => {
    expect(PAST_BOARD_MEASURED.kind === 'ok' && toMeasuredDto(PAST_BOARD_MEASURED.value, ctx)).toEqual({
      load: 89.6,
      excessStress: 36.2,
      recoveryTailMin: 44,
      validSamples: 40,
      signal: 'stress',
      recoveredAt: '2026-09-28T12:44:00+02:00',
    });
  });
});

describe('liveDto', () => {
  const now = at('2026-10-04T11:00:00+02:00');

  test('merges the last three hours of stress and heart rate per minute, ascending', () => {
    const health: HealthData = {
      ...emptyHealth,
      stress: [
        { t: now - 4 * 3_600_000, v: 99 },
        { t: now - 6 * 60_000, v: 30 },
        { t: now - 3 * 60_000, v: 35 },
      ],
      heartRate: [
        { t: now - 6 * 60_000 + 20_000, v: 70 },
        { t: now - 60_000, v: 72 },
      ],
    };

    expect(liveDto(health, now, at('2026-10-04T10:58:00+02:00'), ctx)).toEqual({
      lastSampleAt: '2026-10-04T10:59:00+02:00',
      lastSyncAt: '2026-10-04T10:58:00+02:00',
      points: [
        { t: '2026-10-04T10:54:00+02:00', stress: 30, heartRate: 70 },
        { t: '2026-10-04T10:57:00+02:00', stress: 35, heartRate: null },
        { t: '2026-10-04T10:59:00+02:00', stress: null, heartRate: 72 },
      ],
    });
  });

  test('reports nulls when there is no data', () => {
    expect(liveDto(emptyHealth, now, null, ctx)).toEqual({ lastSampleAt: null, lastSyncAt: null, points: [] });
  });
});

describe('buildSnapshot', () => {
  const accepted = [{ actionId: SLEEP_ACTION.id, change: SLEEP_ACTION.change }];

  test('builds the briefing with zoned times, rounded numbers and actions without plan internals', () => {
    const { briefing } = buildSnapshot(forecastFixture(), { user: MARTA, accepted, live: null, ctx });

    expect(briefing).toMatchObject({
      user: MARTA,
      computedAt: '2026-10-04T11:00:00+02:00',
      headline: 'Tomorrow is your heaviest day in 6 weeks.',
      capacity: { score: 54.2 },
      tomorrow: { date: '2026-10-05', dayLoad: 83.4, heaviestInDays: 42 },
      outlook: { capacity: 54.2, dayLoad: 83.4, gap: 29.2, gapLevel: 'red' },
      projected: null,
      live: null,
    });
    expect(briefing.actions[0]).toEqual({
      id: 'sleep_target:2026-10-05',
      rule: 'sleep_target',
      title: 'Lights out by 22:45',
      evidence: 'You usually wake at 06:30.',
      evidenceRefs: [],
      impact: 24.1,
      altersProjection: true,
      accepted: false,
    });
    expect(briefing.tomorrow.workouts).toEqual([
      {
        id: INTERVALS.id,
        title: INTERVALS.title,
        intensity: 'intervals',
        start: '2026-10-05T18:30:00+02:00',
        end: '2026-10-05T19:30:00+02:00',
        load: 8,
        movedByHeadroom: false,
      },
    ]);
    expect(briefing.upcoming.map((meeting) => meeting.id)).toEqual([BOARD.id]);
  });

  test('puts accepted blocks on the day they prepare for', () => {
    const { week } = buildSnapshot(forecastFixture(), { user: MARTA, accepted, live: null, ctx });

    expect(week.days.map((day) => day.blocks.map((block) => block.title))).toEqual([[], ['Lights out 22:45']]);
    expect(week.days[1]).toMatchObject({ date: '2026-10-05', dayLoad: 83.4, capacityForecast: 54.2 });
  });

  test('maps the energy map', () => {
    const { energyMap } = buildSnapshot(forecastFixture(), { user: MARTA, accepted: [], live: null, ctx });

    expect(energyMap).toEqual({
      computedAt: '2026-10-04T11:00:00+02:00',
      belowThresholdCount: 21,
      people: [
        {
          person: { id: 'p-piotr', name: 'Piotr Nowak', role: 'Co-founder, CTO' },
          meetings: 15,
          bodyEffect: 14.6,
          felt: 0.4,
          reflections: 10,
          group: 'hidden_drain',
          confidence: 'high',
          explanation: 'Meetings with Piotr cost you about +15 points more than they feel.',
        },
      ],
    });
  });
});
