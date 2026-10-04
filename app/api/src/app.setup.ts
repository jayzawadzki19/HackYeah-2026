import { RequestMethod, StandardSchemaValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { invalidRequest } from './common/problem';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import type { AppConfig } from './config/env';

const formatIssue = (issue: { readonly message: string; readonly path?: readonly unknown[] }): string => {
  const path = (issue.path ?? [])
    .map((segment) => (typeof segment === 'object' && segment !== null && 'key' in segment ? segment.key : segment))
    .map(String)
    .join('.');
  return path === '' ? issue.message : `${path}: ${issue.message}`;
};

/** HTTP-level wiring shared by main.ts and the e2e tests, so tests exercise the real configuration. */
export const configureApp = (app: NestExpressApplication, config: AppConfig): NestExpressApplication => {
  app.setGlobalPrefix('api', { exclude: [{ path: 'webhooks/open-wearables', method: RequestMethod.POST }] });
  app.enableCors({ origin: [config.webOrigin] });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) => invalidRequest(issues.map(formatIssue).join('; ')),
    }),
  );
  return app;
};
