import { Inject, Injectable, type DynamicModule, type OnApplicationShutdown, Module } from '@nestjs/common';
import type { ForecastEngine } from './forecast/engine.port';
import { FORECAST_ENGINE } from './forecast/engine.port';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { CLOCK, systemClock } from './common/clock';
import { defaultSleep } from './common/http';
import { APP_DATABASE, type AppDatabase, openDatabase } from './db/database';
import { AcceptedActionsRepository, ReflectionsRepository, SnapshotsRepository, WebhookDeliveriesRepository } from './db/repositories';
import { CALENDAR_PROVIDER } from './calendar/calendar.provider';
import { JsonCalendarProvider } from './calendar/json-calendar.provider';
import { HEALTH_SOURCE, HealthRepository } from './open-wearables/health.repository';
import { OPEN_WEARABLES_READER, OpenWearablesClient, type OpenWearablesReader } from './open-wearables/open-wearables.client';
import { ForecastService } from './forecast/forecast.service';
import { ForecastController } from './forecast/forecast.controller';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { MeetingsController } from './meetings/meetings.controller';
import { MeetingsService } from './meetings/meetings.service';
import { FeedbackController } from './feedback/feedback.controller';
import { FeedbackService } from './feedback/feedback.service';
import { CONNECTOR_CLIENT, HttpConnectorClient } from './ingest/connector.client';
import { IngestService, SLEEP } from './ingest/ingest.service';
import { OpenWearablesSampleProbe } from './ingest/sample-probe';
import { SAMPLE_PROBE } from './ingest/sample-probe';
import { SyncController } from './ingest/sync.controller';
import { WebhookController } from './ingest/webhook.controller';
import { SyncStatus } from './ingest/sync-status';
import { DELAYER, timeoutDelayer } from './ingest/timing';
import { StreamBus } from './stream/stream.bus';
import { StreamController } from './stream/stream.controller';
import { DEFAULT_HEARTBEAT_MS, HEARTBEAT_EVERY_MS, HEARTBEAT_SOURCE, intervalHeartbeat } from './stream/heartbeat';

@Injectable()
class CloseDatabase implements OnApplicationShutdown {
  constructor(@Inject(APP_DATABASE) private readonly database: AppDatabase) {}

  onApplicationShutdown(): void {
    this.database.close();
  }
}

@Module({})
export class AppModule {
  static register(config: AppConfig, engine: ForecastEngine): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        UsersController,
        ForecastController,
        MeetingsController,
        FeedbackController,
        SyncController,
        StreamController,
        WebhookController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: FORECAST_ENGINE, useValue: engine },
        { provide: CLOCK, useValue: systemClock },
        { provide: DELAYER, useValue: timeoutDelayer },
        { provide: SLEEP, useValue: defaultSleep },
        { provide: HEARTBEAT_EVERY_MS, useValue: DEFAULT_HEARTBEAT_MS },
        { provide: HEARTBEAT_SOURCE, useValue: intervalHeartbeat },
        { provide: APP_DATABASE, useFactory: () => openDatabase(config.dbPath) },
        { provide: CALENDAR_PROVIDER, useFactory: () => new JsonCalendarProvider(config.calendarDir) },
        {
          provide: OPEN_WEARABLES_READER,
          useFactory: () => new OpenWearablesClient({ baseUrl: config.openWearables.baseUrl, apiKey: config.openWearables.apiKey }),
        },
        {
          provide: HEALTH_SOURCE,
          useFactory: (reader: OpenWearablesReader) => new HealthRepository(reader, config.owUserIds),
          inject: [OPEN_WEARABLES_READER],
        },
        { provide: CONNECTOR_CLIENT, useFactory: () => new HttpConnectorClient(config.connectorUrl) },
        { provide: SAMPLE_PROBE, useClass: OpenWearablesSampleProbe },
        ReflectionsRepository,
        AcceptedActionsRepository,
        SnapshotsRepository,
        WebhookDeliveriesRepository,
        StreamBus,
        SyncStatus,
        ForecastService,
        UsersService,
        MeetingsService,
        FeedbackService,
        IngestService,
        CloseDatabase,
      ],
    };
  }
}
