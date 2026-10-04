import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { STATUS_CODES } from 'node:http';
import type { ProblemDetailsDto } from '../../../contracts/api-contract';
import { isProblemSource, ProblemException } from './problem';

const titleOf = (status: number): string => STATUS_CODES[status] ?? 'Error';

const generic = (status: number, detail: string): ProblemDetailsDto => ({
  type: 'about:blank',
  title: titleOf(status),
  status,
  detail,
});

const messageOf = (body: unknown): string | null => {
  if (typeof body === 'string') return body;
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;
  const { message } = body;
  if (Array.isArray(message)) return message.map(String).join('; ');
  return typeof message === 'string' ? message : null;
};

/** body-parser and similar middleware errors carry an HTTP status and an `expose` flag. */
const isClientError = (error: unknown): error is { readonly status: number; readonly type?: string } =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  typeof error.status === 'number' &&
  error.status >= 400 &&
  error.status < 500 &&
  'expose' in error &&
  error.expose === true;

export const toProblem = (exception: unknown): ProblemDetailsDto => {
  if (exception instanceof ProblemException) return exception.problem;
  if (isProblemSource(exception)) return exception.toProblem();
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return generic(status, messageOf(exception.getResponse()) ?? titleOf(status));
  }
  if (isClientError(exception)) {
    return generic(exception.status, exception.type === 'entity.parse.failed' ? 'Malformed JSON body.' : titleOf(exception.status));
  }
  return generic(500, 'Unexpected server error.');
};

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const problem = toProblem(exception);
    if (problem.status >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    if (response.headersSent) {
      response.end();
      return;
    }
    response.status(problem.status).type('application/problem+json').json(problem);
  }
}
