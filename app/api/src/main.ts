import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { configureApp } from './app.setup';
import { AppModule } from './app.module';
import { loadEnvironment } from './config/env-file';
import { parseEnv } from './config/env';
import { loadForecastEngine } from './forecast/engine.factory';

const apiRoot = join(import.meta.dir, '..');

const boot = async (): Promise<void> => {
  const config = parseEnv(loadEnvironment(join(apiRoot, '.env.local'), Bun.env), apiRoot);
  const loaded = await loadForecastEngine();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config, loaded.engine), { rawBody: true });
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.port);
  const gaps = loaded.gaps.length > 0 ? ` (missing ${loaded.gaps.join(', ')})` : '';
  Logger.log(`Listening on port ${config.port}. Forecast engine: ${loaded.source}${gaps}.`, 'Bootstrap');
};

boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
