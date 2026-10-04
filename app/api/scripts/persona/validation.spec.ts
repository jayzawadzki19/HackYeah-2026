import { describe, expect, test } from 'bun:test';
import { buildForecast, pendingCheckIns, reflectionMessage, type ForecastInput } from '../../src/engine/index';
import type { CalendarFile } from '../../src/calendar/calendar-file';
import type { EngineEvent } from '../../src/engine/types';
import { createRng, deriveSeed } from './prng';
import { buildSchedule, PERSONA_TIME_ZONE } from './schedule';
import { generateHealth } from './signals';
import { localDateTime, localParts } from './time';

const TODAY = '2026-10-04';
const TZ = PERSONA_TIME_ZONE;

const within = (actual: number, target: number, tolerance: number): void => {
  expect(Math.abs(actual - target)).toBeLessThanOrEqual(tolerance);
};

const eventsOf = (calendar: CalendarFile): EngineEvent[] =>
  calendar.events.map((event) =>
    event.kind === 'meeting'
      ? {
          kind: 'meeting' as const,
          id: event.id,
          title: event.title,
          type: event.type,
          start: Date.parse(event.start),
          end: Date.parse(event.end),
          attendeeIds: [...event.attendeeIds],
          isGroup: event.isGroup,
        }
      : {
          kind: 'workout' as const,
          id: event.id,
          title: event.title,
          intensity: event.intensity,
          start: Date.parse(event.start),
          end: Date.parse(event.end),
          movedByHeadroom: false,
        },
  );

describe('persona engine validation', () => {
  const now = localDateTime(TODAY, 11 * 60, TZ);
  const calendar = buildSchedule({ today: TODAY, timeZone: TZ }, createRng(2026));
  const health = generateHealth(calendar, { today: TODAY, timeZone: TZ }, now, createRng(deriveSeed(2026, 'health')));
  const input: ForecastInput = {
    now,
    timeZone: TZ,
    events: eventsOf(calendar),
    people: calendar.people.map((person) => ({ ...person })),
    health,
    reflections: calendar.reflections.map((item) => ({ ...item })),
    accepted: [],
  };
  const forecast = buildForecast(input);

  test('recovers the happy-path persona', () => {
    const group = (id: string) => forecast.energyMap.entries.find((entry) => entry.person.id === id)?.group;
    expect(group('anna-kowalska')).toBe('known_drain');
    expect(group('piotr-nowak')).toBe('hidden_drain');
    expect(group('ola-wisniewska')).toBe('energizer');
    expect(group('tomasz-lewandowski')).toBe('overestimated');
    expect(group('kasia-wojcik')).toBe('neutral');
    expect(forecast.energyMap.belowThresholdCount).toBe(21);

    expect(forecast.capacityNow.score).not.toBeNull();
    within(forecast.capacityNow.score ?? 0, 54, 5);
    within(forecast.outlook.dayLoad, 83, 5);
    expect(forecast.outlook.gap).not.toBeNull();
    within(forecast.outlook.gap ?? 0, 29, 5);
    expect(forecast.outlook.gapLevel).toBe('red');

    const loadOf = (title: string) => forecast.tomorrow.meetings.find((item) => item.meeting.title === title)?.load;
    within(loadOf('Board meeting') ?? -1, 83, 5);
    within(loadOf('1:1 with Piotr') ?? -1, 56, 5);
    within(loadOf('Investor call') ?? -1, 76, 5);
    within(loadOf('Customer call') ?? -1, 52, 5);

    const top = forecast.actions.slice(0, 3);
    expect(top.map((action) => action.rule)).toEqual(['sleep_target', 'training_swap', 'pre_meeting_reset']);
    expect(top[0]?.title).toBe('Lights out by 22:45');
    expect(top[1]?.title).toBe("Move tomorrow's intervals to Saturday");
    expect(top[1]?.evidenceRefs.filter((ref) => ref.date !== undefined)).toHaveLength(3);
    expect(top[2]?.title).toBe('10-minute walk at 09:45 before the Board meeting');
    const tail = Number(top[2]?.evidence.match(/about (\d+) minutes/)?.[1]);
    within(tail, 45, 10);
    expect(forecast.actions.some((action) => action.rule === 'buffer_walking' && action.title.includes('Piotr'))).toBe(true);

    const boards = input.events.filter((event) => event.kind === 'meeting' && event.type === 'board' && event.end <= now);
    const recentBoard = boards.reduce((latest, event) => (event.end > latest.end ? event : latest));
    const boardMeasured = forecast.measured.get(recentBoard.id);
    expect(boardMeasured?.kind).toBe('ok');
    if (boardMeasured?.kind === 'ok') {
      within(boardMeasured.value.load, 90, 5);
      within(boardMeasured.value.excessStress, 36, 5);
      within(boardMeasured.value.recoveryTailMin, 45, 10);
    }

    const pending = pendingCheckIns(input.events, input.reflections, now, TZ);
    expect(pending[0]?.title).toBe('1:1 with Piotr');
    expect(localParts(pending[0]?.start ?? 0, TZ)).toMatchObject({ date: '2026-10-02', hour: 16, minute: 30 });
    const pendingMeasured = forecast.measured.get(pending[0]?.id ?? '');
    expect(reflectionMessage(1, pendingMeasured)).toContain('about 20 points');

    const accepted = forecast.actions
      .filter((action) => action.rule === 'sleep_target' || action.rule === 'training_swap')
      .map((action) => ({ actionId: action.id, change: action.change }));
    const projected = buildForecast({ ...input, accepted }).projected;
    expect(projected).not.toBeNull();
    within(projected?.capacity ?? 0, 60, 5);
    within(projected?.dayLoad ?? 0, 75, 5);
    within(projected?.gap ?? 0, 15, 5);
    expect(projected?.gapLevel).toBe('amber');
  });
});
