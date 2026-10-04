import { Controller, Get, Param } from '@nestjs/common';
import type { MeetingDetailDto, PendingCheckInDto } from '../../../contracts/api-contract';
import { UsersService } from '../users/users.service';
import { requireUserKey } from '../users/user-key';
import { MeetingsService } from './meetings.service';

@Controller('users')
export class MeetingsController {
  constructor(
    private readonly users: UsersService,
    private readonly meetings: MeetingsService,
  ) {}

  @Get(':key/check-ins/pending')
  async pending(@Param('key') key: string): Promise<readonly PendingCheckInDto[]> {
    return this.meetings.pending(await this.user(key));
  }

  @Get(':key/meetings/:id')
  async detail(@Param('key') key: string, @Param('id') id: string): Promise<MeetingDetailDto> {
    return this.meetings.detail(await this.user(key), id);
  }

  private async user(key: string) {
    const userKey = requireUserKey(key);
    await this.users.profile(userKey);
    return userKey;
  }
}
