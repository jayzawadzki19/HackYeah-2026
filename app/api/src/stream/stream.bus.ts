import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { filter, map, type Observable, Subject } from 'rxjs';
import type { StreamEventDto, UserKey } from '../../../contracts/api-contract';

interface Addressed {
  readonly userKey: UserKey;
  readonly event: StreamEventDto;
}

/** In-process fan-out of per-user stream events (sync status, forecast updates). */
@Injectable()
export class StreamBus implements OnModuleDestroy {
  private readonly subject = new Subject<Addressed>();

  publish(userKey: UserKey, event: StreamEventDto): void {
    this.subject.next({ userKey, event });
  }

  events(userKey: UserKey): Observable<StreamEventDto> {
    return this.subject.pipe(
      filter((addressed) => addressed.userKey === userKey),
      map(({ event }) => event),
    );
  }

  onModuleDestroy(): void {
    this.subject.complete();
  }
}
