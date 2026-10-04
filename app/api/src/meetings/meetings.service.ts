import { Inject, Injectable } from '@nestjs/common';
import type { MeetingDetailDto, PendingCheckInDto, UserKey } from '../../../contracts/api-contract';
import { notFound } from '../common/problem';
import { FORECAST_ENGINE, type ForecastEngine } from '../forecast/engine.port';
import { ForecastService } from '../forecast/forecast.service';
import { findMeeting } from './find-meeting';
import { toMeetingDetail, toPendingCheckIns } from './meeting.dto';

@Injectable()
export class MeetingsService {
  constructor(
    private readonly forecasts: ForecastService,
    @Inject(FORECAST_ENGINE) private readonly engine: ForecastEngine,
  ) {}

  async detail(userKey: UserKey, meetingId: string): Promise<MeetingDetailDto> {
    const computed = await this.forecasts.current(userKey);
    const meeting = findMeeting(computed.events, meetingId);
    if (meeting === null) throw notFound('unknown-meeting', 'Unknown meeting', `There is no meeting "${meetingId}".`);
    const finished = meeting.end <= computed.computedAt;
    const trace = finished
      ? this.engine.meetingTrace(meeting, computed.health, computed.result.baseline, computed.profile.timeZone)
      : [];
    return toMeetingDetail(computed, meeting, trace);
  }

  async pending(userKey: UserKey): Promise<readonly PendingCheckInDto[]> {
    const computed = await this.forecasts.current(userKey);
    const meetings = this.engine.pendingCheckIns(computed.events, computed.reflections, computed.computedAt, computed.profile.timeZone);
    return toPendingCheckIns(computed, meetings);
  }
}
