import { Controller, Inject, Param, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { map, merge, type Observable } from 'rxjs';
import type { StreamEventDto } from '../../../contracts/api-contract';
import { UsersService } from '../users/users.service';
import { requireUserKey } from '../users/user-key';
import { HEARTBEAT_EVERY_MS, HEARTBEAT_SOURCE, type HeartbeatSource } from './heartbeat';
import { StreamBus } from './stream.bus';

const toMessage = (event: StreamEventDto): MessageEvent => ({ type: event.type, data: event });

@Controller('users')
export class StreamController {
  constructor(
    private readonly users: UsersService,
    private readonly bus: StreamBus,
    @Inject(HEARTBEAT_EVERY_MS) private readonly heartbeatMs: number,
    @Inject(HEARTBEAT_SOURCE) private readonly heartbeat: HeartbeatSource,
  ) {}

  @Sse(':key/stream')
  async stream(@Param('key') key: string): Promise<Observable<MessageEvent>> {
    const userKey = requireUserKey(key);
    await this.users.profile(userKey);
    return merge(this.bus.events(userKey).pipe(map(toMessage)), this.heartbeat(this.heartbeatMs));
  }
}
