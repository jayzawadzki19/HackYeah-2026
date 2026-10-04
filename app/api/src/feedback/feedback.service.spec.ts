import { afterEach, describe, expect, test } from 'bun:test';
import { ProblemException } from '../common/problem';
import type { EnginePerson } from '../engine/types';
import { forecastFixture, SLEEP_ACTION } from '../../test/support/forecast-fixture';
import { forecastStack, type ForecastStack } from '../../test/support/forecast-stack';
import { FeedbackService } from './feedback.service';

const MENTOR: EnginePerson = { id: 'p-mentor', name: 'Ewa Mazur', role: 'Mentor' };

describe('FeedbackService', () => {
  let stack!: ForecastStack;
  let feedback!: FeedbackService;

  afterEach(async () => {
    await stack?.close();
  });

  const start = () => {
    stack = forecastStack();
    feedback = new FeedbackService(stack.forecasts, stack.reflections, stack.accepted, stack.engine, stack.clock);
  };

  test('stores a reflection, recomputes, and returns the message for scored attendees', async () => {
    start();
    stack.engine.result = (input) =>
      forecastFixture({
        computedAt: input.now,
        energyMap: {
          entries: [
            {
              person: MENTOR,
              meetings: 4,
              bodyEffect: 6,
              felt: -1,
              reflections: 1,
              group: 'known_drain',
              confidence: 'medium',
              explanation: 'Meetings with Ewa cost you about +6 points, and you feel it too.',
            },
            {
              person: { id: 'p-other', name: 'Other', role: null },
              meetings: 3,
              bodyEffect: 0,
              felt: null,
              reflections: 0,
              group: 'neutral',
              confidence: 'medium',
              explanation: 'Not in the room.',
            },
          ],
          belowThresholdCount: 0,
        },
      });

    const result = await feedback.reflect('jakub', 'm-rehearsal', 1);

    expect(result).toMatchObject({ meetingId: 'm-rehearsal', rating: 1, message: 'rating 1, measured none' });
    expect(result.updated.map((entry) => entry.person.id)).toEqual(['p-mentor']);
    expect(stack.reflections.list('jakub')).toEqual([{ meetingId: 'm-rehearsal', rating: 1 }]);
    expect(stack.engine.inputs.at(-1)?.reflections).toContainEqual({ meetingId: 'm-rehearsal', rating: 1 });
  });

  test('answers 404 when the meeting does not exist and stores nothing', async () => {
    start();
    const error = await feedback.reflect('jakub', 'missing', -1).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProblemException);
    expect((error as ProblemException).problem.status).toBe(404);
    expect(stack.reflections.list('jakub')).toEqual([]);
  });

  test('accepts an action and returns the block plus the projected outlook', async () => {
    start();
    stack.engine.result = (input) =>
      forecastFixture({
        computedAt: input.now,
        actions: [SLEEP_ACTION],
        projected:
          input.accepted.length > 0 ? { capacity: 60, dayLoad: 75.04, gap: 15, gapLevel: 'amber' } : null,
      });

    const result = await feedback.accept('jakub', SLEEP_ACTION.id);

    expect(result.actionId).toBe(SLEEP_ACTION.id);
    expect(result.block).toMatchObject({ title: 'Lights out 22:45', forDate: '2026-10-05' });
    expect(result.projected).toEqual({ capacity: 60, dayLoad: 75, gap: 15, gapLevel: 'amber' });
    expect(stack.engine.inputs.at(-1)?.accepted).toEqual([{ actionId: SLEEP_ACTION.id, change: SLEEP_ACTION.change }]);
  });

  test('keeps the original change when the same action is accepted again', async () => {
    start();
    stack.engine.result = (input) =>
      forecastFixture({
        computedAt: input.now,
        projected: input.accepted.length > 0 ? { capacity: 60, dayLoad: 75, gap: 15, gapLevel: 'amber' } : null,
        actions: [{ ...SLEEP_ACTION, change: { ...SLEEP_ACTION.change, sleepHours: input.accepted.length > 0 ? 9 : 7.5 } }],
      });

    await feedback.accept('jakub', SLEEP_ACTION.id);
    const again = await feedback.accept('jakub', SLEEP_ACTION.id);

    expect(again.block).toMatchObject({ title: 'Lights out 22:45' });
    expect(stack.accepted.list('jakub')).toEqual([{ actionId: SLEEP_ACTION.id, change: SLEEP_ACTION.change }]);
  });

  test('answers 404 for an action the forecast does not contain', async () => {
    start();
    const error = await feedback.accept('jakub', 'nope').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProblemException);
    expect((error as ProblemException).problem).toMatchObject({ status: 404, type: '/problems/unknown-action' });
  });
});
