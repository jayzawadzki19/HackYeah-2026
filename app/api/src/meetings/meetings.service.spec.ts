import { afterEach, describe, expect, test } from 'bun:test';
import { ProblemException } from '../common/problem';
import type { EngineMeeting } from '../engine/types';
import { forecastFixture, predicted } from '../../test/support/forecast-fixture';
import { forecastStack, type ForecastStack } from '../../test/support/forecast-stack';
import { MeetingsService } from './meetings.service';

const JURY: EngineMeeting = {
  kind: 'meeting',
  id: 'm-jury',
  title: 'Jury pitch',
  type: 'pitch',
  start: Date.parse('2026-10-04T13:00:00+02:00'),
  end: Date.parse('2026-10-04T13:10:00+02:00'),
  attendeeIds: [],
  isGroup: false,
};

describe('MeetingsService', () => {
  let stack!: ForecastStack;
  let meetings!: MeetingsService;

  afterEach(async () => {
    await stack?.close();
  });

  const start = () => {
    stack = forecastStack();
    meetings = new MeetingsService(stack.forecasts, stack.engine);
  };

  test('returns a measured past meeting and its trace', async () => {
    start();
    stack.engine.trace = [{ t: Date.parse('2026-10-03T18:40:00+02:00'), stress: 40, heartRate: 72, baselineStress: 25 }];
    stack.engine.result = (input) =>
      forecastFixture({
        computedAt: input.now,
        measured: new Map([
          [
            'm-rehearsal',
            {
              kind: 'ok',
              value: {
                load: 42,
                excessStress: 11,
                recoveryTailMin: 15,
                validSamples: 8,
                signal: 'stress',
                recoveredAt: null,
              },
            },
          ],
        ]),
      });

    const detail = await meetings.detail('jakub', 'm-rehearsal');

    expect(detail.meeting).toMatchObject({ id: 'm-rehearsal', title: 'Pitch rehearsal' });
    expect(detail.measured).toMatchObject({ load: 42, signal: 'stress', recoveredAt: null });
    expect(detail.insufficientReason).toBeNull();
    expect(detail.predicted).toBeNull();
    expect(detail.trace).toEqual([{ t: '2026-10-03T18:40:00+02:00', stress: 40, heartRate: 72, baselineStress: 25 }]);
    expect(detail.howWeMeasure).toBe(
      'Only time you sat still counts; compared with your own baseline for the same hour; walking and workouts excluded.',
    );
    expect(stack.engine.traceCalls).toHaveLength(1);
  });

  test('returns a prediction for a future meeting and does not build a trace', async () => {
    start();
    stack.engine.result = (input) =>
      forecastFixture({
        computedAt: input.now,
        upcoming: [predicted(JURY, 70)],
        tomorrow: { ...forecastFixture().tomorrow, meetings: [] },
        week: [],
      });

    const detail = await meetings.detail('jakub', 'm-jury');

    expect(detail.predicted?.id).toBe('m-jury');
    expect(detail.predicted?.predictedLoad).toBe(70);
    expect(detail.trace).toEqual([]);
    expect(stack.engine.traceCalls).toHaveLength(0);
  });

  test('explains why a past meeting could not be measured', async () => {
    start();
    stack.engine.result = (input) =>
      forecastFixture({
        computedAt: input.now,
        measured: new Map([['m-rehearsal', { kind: 'insufficient', reason: 'no_samples', detail: 'No still samples during the meeting.' }]]),
      });

    const detail = await meetings.detail('jakub', 'm-rehearsal');

    expect(detail.measured).toBeNull();
    expect(detail.insufficientReason).toBe('No still samples during the meeting.');
  });

  test('lists pending check-ins with attendees', async () => {
    start();
    stack.engine.pending = [
      {
        kind: 'meeting',
        id: 'm-rehearsal',
        title: 'Pitch rehearsal',
        type: 'pitch',
        start: Date.parse('2026-10-03T18:00:00+02:00'),
        end: Date.parse('2026-10-03T18:30:00+02:00'),
        attendeeIds: ['p-mentor'],
        isGroup: false,
      },
    ];

    expect(await meetings.pending('jakub')).toEqual([
      {
        meetingId: 'm-rehearsal',
        title: 'Pitch rehearsal',
        start: '2026-10-03T18:00:00+02:00',
        end: '2026-10-03T18:30:00+02:00',
        attendees: [{ id: 'p-mentor', name: 'Ewa Mazur', role: 'Mentor' }],
      },
    ]);
  });

  test('answers 404 for an unknown meeting', async () => {
    start();
    const error = await meetings.detail('jakub', 'missing').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProblemException);
    expect((error as ProblemException).problem).toMatchObject({ status: 404, type: '/problems/unknown-meeting' });
  });
});
