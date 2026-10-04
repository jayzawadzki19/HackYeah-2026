import { Inject, Injectable } from '@nestjs/common';
import type { UserSummaryDto, UserKey } from '../../../contracts/api-contract';
import { CALENDAR_PROVIDER, CalendarUnavailableError, type CalendarProfile, type CalendarProvider } from '../calendar/calendar.provider';
import { toUserSummary } from '../forecast/dto.mapper';
import { USER_KEYS } from './user-key';

@Injectable()
export class UsersService {
  constructor(@Inject(CALENDAR_PROVIDER) private readonly calendar: CalendarProvider) {}

  /** Both accounts, omitting a user whose calendar file is not on disk yet. */
  async list(): Promise<readonly UserSummaryDto[]> {
    const profiles = await Promise.all(USER_KEYS.map((key) => this.tryProfile(key)));
    return profiles.filter((profile): profile is CalendarProfile => profile !== null).map(toUserSummary);
  }

  profile(userKey: UserKey): Promise<CalendarProfile> {
    return this.calendar.profile(userKey);
  }

  private async tryProfile(userKey: UserKey): Promise<CalendarProfile | null> {
    try {
      return await this.calendar.profile(userKey);
    } catch (error) {
      if (error instanceof CalendarUnavailableError) return null;
      throw error;
    }
  }
}
