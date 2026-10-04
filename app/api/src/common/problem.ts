import { HttpException } from '@nestjs/common';
import type { ProblemDetailsDto } from '../../../contracts/api-contract';

/** Domain errors that know how they should be reported over HTTP. */
export interface ProblemSource {
  toProblem(): ProblemDetailsDto;
}

export const isProblemSource = (value: unknown): value is ProblemSource =>
  typeof value === 'object' && value !== null && 'toProblem' in value && typeof value.toProblem === 'function';

/** An HttpException whose body is already a problem-details document. */
export class ProblemException extends HttpException {
  constructor(readonly problem: ProblemDetailsDto) {
    super(problem, problem.status);
  }
}

const problem = (slug: string, title: string, status: number, detail: string) =>
  new ProblemException({ type: `/problems/${slug}`, title, status, detail });

export const unknownUser = (key: string) => problem('unknown-user', 'Unknown user', 404, `There is no user "${key}".`);

export const notFound = (slug: string, title: string, detail: string) => problem(slug, title, 404, detail);

export const conflict = (slug: string, title: string, detail: string) => problem(slug, title, 409, detail);

export const invalidRequest = (detail: string) => problem('invalid-request', 'Invalid request', 400, detail);

export const unavailable = (slug: string, title: string, detail: string) => problem(slug, title, 503, detail);
