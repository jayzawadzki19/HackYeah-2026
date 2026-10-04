import { Controller, HttpCode, Post, Param } from '@nestjs/common';
import type { SyncAcceptedDto } from '../../../contracts/api-contract';
import { UsersService } from '../users/users.service';
import { requireUserKey } from '../users/user-key';
import { IngestService } from './ingest.service';

@Controller('users')
export class SyncController {
  constructor(
    private readonly users: UsersService,
    private readonly ingest: IngestService,
  ) {}

  @Post(':key/sync-now')
  @HttpCode(202)
  async syncNow(@Param('key') key: string): Promise<SyncAcceptedDto> {
    const userKey = requireUserKey(key);
    await this.users.profile(userKey);
    return this.ingest.requestSync(userKey);
  }
}
