import type {
  MeetingDetailDto,
  PastMeetingRefDto,
  PendingCheckInDto,
  TracePointDto,
} from '../../../contracts/api-contract';
import { isoInZone } from '../common/time';
import type { EngineMeeting } from '../engine/types';
import { attendeesOf, toMeasuredDto, toMeetingRef, toPredictedMeetingDto } from '../forecast/dto.mapper';
import type { ForecastResult, PredictedMeeting, TracePoint } from '../forecast/engine.port';
import type { ComputedForecast } from '../forecast/forecast.service';

/** Happy-path copy for the meeting screen. The formula lives in the engine. */
export const HOW_WE_MEASURE =
  'Only time you sat still counts; compared with your own baseline for the same hour; walking and workouts excluded.';

const findPredicted = (result: ForecastResult, meetingId: string): PredictedMeeting | null =>
  [result.upcoming, result.tomorrow.meetings, ...result.week.map((day) => day.meetings)]
    .flat()
    .find((item) => item.meeting.id === meetingId) ?? null;

const pastSameType = (computed: ComputedForecast, meeting: EngineMeeting): PastMeetingRefDto[] =>
  computed.events
    .filter(
      (event): event is EngineMeeting =>
        event.kind === 'meeting' && event.type === meeting.type && event.id !== meeting.id && event.end <= computed.computedAt,
    )
    .toSorted((left, right) => right.start - left.start)
    .map((event) => {
      const measured = computed.result.measured.get(event.id);
      return {
        id: event.id,
        title: event.title,
        start: isoInZone(event.start, computed.ctx.timeZone),
        measuredLoad: measured?.kind === 'ok' ? toMeasuredDto(measured.value, computed.ctx).load : null,
      };
    });

const toTrace = (points: readonly TracePoint[], timeZone: string): TracePointDto[] =>
  points.map((point) => ({
    t: isoInZone(point.t, timeZone),
    stress: point.stress,
    heartRate: point.heartRate,
    baselineStress: point.baselineStress,
  }));

export const toMeetingDetail = (computed: ComputedForecast, meeting: EngineMeeting, trace: readonly TracePoint[]): MeetingDetailDto => {
  const measured = computed.result.measured.get(meeting.id);
  const finished = meeting.end <= computed.computedAt;
  const predicted = finished ? null : findPredicted(computed.result, meeting.id);
  return {
    meeting: toMeetingRef(meeting, computed.ctx),
    measured: measured?.kind === 'ok' ? toMeasuredDto(measured.value, computed.ctx) : null,
    insufficientReason: measured?.kind === 'insufficient' ? measured.detail : null,
    predicted: predicted === null ? null : toPredictedMeetingDto(predicted, computed.ctx),
    trace: toTrace(trace, computed.ctx.timeZone),
    pastSameType: pastSameType(computed, meeting),
    howWeMeasure: HOW_WE_MEASURE,
  };
};

export const toPendingCheckIns = (computed: ComputedForecast, meetings: readonly EngineMeeting[]): PendingCheckInDto[] =>
  meetings.map((meeting) => ({
    meetingId: meeting.id,
    title: meeting.title,
    start: isoInZone(meeting.start, computed.ctx.timeZone),
    end: isoInZone(meeting.end, computed.ctx.timeZone),
    attendees: attendeesOf(meeting, computed.ctx),
  }));
