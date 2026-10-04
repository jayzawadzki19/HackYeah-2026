import { Inject, Injectable } from '@nestjs/common';
import type { AcceptActionResultDto, Rating, ReflectionResultDto, UserKey } from '../../../contracts/api-contract';
import { CLOCK, type Clock } from '../common/clock';
import { notFound } from '../common/problem';
import { AcceptedActionsRepository, ReflectionsRepository } from '../db/repositories';
import { blockFromChange, toEnergyEntryDto, toOutlookDto } from '../forecast/dto.mapper';
import { FORECAST_ENGINE, type ForecastEngine } from '../forecast/engine.port';
import { ForecastService } from '../forecast/forecast.service';
import { findMeeting } from '../meetings/find-meeting';

@Injectable()
export class FeedbackService {
  constructor(
    private readonly forecasts: ForecastService,
    private readonly reflections: ReflectionsRepository,
    private readonly accepted: AcceptedActionsRepository,
    @Inject(FORECAST_ENGINE) private readonly engine: ForecastEngine,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async reflect(userKey: UserKey, meetingId: string, rating: Rating): Promise<ReflectionResultDto> {
    const current = await this.forecasts.current(userKey);
    const meeting = findMeeting(current.events, meetingId);
    if (meeting === null) throw notFound('unknown-meeting', 'Unknown meeting', `There is no meeting "${meetingId}".`);
    this.reflections.upsert(userKey, meetingId, rating, this.clock.now());
    const computed = await this.forecasts.recompute(userKey);
    const attendeeIds = new Set(meeting.attendeeIds);
    return {
      meetingId,
      rating,
      message: this.engine.reflectionMessage(rating, computed.result.measured.get(meetingId)),
      updated: computed.result.energyMap.entries
        .filter((entry) => attendeeIds.has(entry.person.id))
        .map(toEnergyEntryDto),
    };
  }

  /**
   * Stores the action's plan change and recomputes. A second call keeps the original change.
   * An id that is neither in the latest forecast nor already stored is a 404.
   */
  async accept(userKey: UserKey, actionId: string): Promise<AcceptActionResultDto> {
    const current = await this.forecasts.current(userKey);
    const action = current.result.actions.find((candidate) => candidate.id === actionId);
    const already = this.accepted.list(userKey).some((stored) => stored.actionId === actionId);
    if (action === undefined && !already) {
      throw notFound('unknown-action', 'Unknown action', `There is no action "${actionId}" to accept.`);
    }
    if (action !== undefined && !already) this.accepted.accept(userKey, action.id, action.change, this.clock.now());
    const computed = await this.forecasts.recompute(userKey);
    const stored = this.accepted.list(userKey).find((candidate) => candidate.actionId === actionId);
    if (stored === undefined) throw new Error(`Accepted action ${actionId} vanished after insert`);
    return {
      actionId,
      block: blockFromChange(actionId, stored.change, computed.ctx),
      projected: toOutlookDto(computed.result.projected ?? computed.result.outlook),
    };
  }
}
