import { HttpErrorResponse, HttpResponse, type HttpInterceptorFn } from '@angular/common/http';
import { delay, of, throwError } from 'rxjs';
import type { Rating, UserKey } from '@contracts';
import { environment } from '../environments/environment';
import { mockHub } from './mock-hub';
import { mockStore } from './mock-store';

const piece = (value: string | undefined): string => {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const pathOf = (url: string): string => (url.startsWith('http') ? new URL(url).pathname : url).split('?')[0] ?? url;

const problem = (status: number, detail: string) =>
  throwError(
    () =>
      new HttpErrorResponse({
        status,
        statusText: status === 404 ? 'Not Found' : 'Bad Request',
        error: { type: 'about:blank', title: status === 404 ? 'Not Found' : 'Bad Request', status, detail },
      }),
  );

const ok = <T>(body: T, status = 200) => of(new HttpResponse({ status, body }));

const scheduleSync = (user: UserKey): void => {
  const at = new Date().toISOString();
  mockHub.emit(user, 'sync.status', { type: 'sync.status', state: 'running', at });
  setTimeout(() => {
    const pushed = mockStore.pushSamples(user);
    mockHub.emit(user, 'sync.status', {
      type: 'sync.status',
      state: 'ok',
      pushedRecords: pushed.count,
      latestSampleAt: pushed.at,
      at: new Date().toISOString(),
    });
    setTimeout(() => {
      mockHub.emit(user, 'forecast.updated', { type: 'forecast.updated', computedAt: new Date().toISOString() });
    }, 280);
  }, 700);
};

export const mockApiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!environment.mockApi) return next(req);
  const path = pathOf(req.url);
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'users') return next(req);

  if (parts.length === 2 && req.method === 'GET') return ok(mockStore.users()).pipe(delay(environment.mockLatencyMs));

  const key = parts[2] ?? '';
  if (!mockStore.isUser(key)) return problem(404, `Unknown user "${key}"`).pipe(delay(environment.mockLatencyMs));

  const tail = parts.slice(3).join('/');
  if (req.method === 'GET' && tail === 'briefing') return ok(mockStore.briefing(key)).pipe(delay(environment.mockLatencyMs));
  if (req.method === 'GET' && tail === 'week') return ok(mockStore.week(key)).pipe(delay(environment.mockLatencyMs));
  if (req.method === 'GET' && tail === 'energy-map') return ok(mockStore.energy(key)).pipe(delay(environment.mockLatencyMs));
  if (req.method === 'GET' && tail === 'check-ins/pending') return ok(mockStore.pending(key)).pipe(delay(environment.mockLatencyMs));
  if (req.method === 'GET' && parts[3] === 'meetings' && parts[4]) {
    const id = piece(parts[4]);
    const detail = mockStore.meeting(key, id);
    return detail ? ok(detail).pipe(delay(environment.mockLatencyMs)) : problem(404, `Unknown meeting "${id}"`).pipe(delay(environment.mockLatencyMs));
  }
  if (req.method === 'POST' && parts[3] === 'actions' && parts[5] === 'accept' && parts[4]) {
    const id = piece(parts[4]);
    const result = mockStore.accept(key, id);
    return result ? ok(result, 201).pipe(delay(environment.mockLatencyMs)) : problem(404, `Unknown action "${id}"`).pipe(delay(environment.mockLatencyMs));
  }
  if (req.method === 'POST' && parts[3] === 'meetings' && parts[5] === 'reflection' && parts[4]) {
    const id = piece(parts[4]);
    const rating = (req.body as { rating?: Rating } | null)?.rating;
    if (rating !== -1 && rating !== 0 && rating !== 1) return problem(400, 'Rating must be -1, 0 or 1.');
    const result = mockStore.reflect(key, id, rating);
    return result ? ok(result, 201).pipe(delay(environment.mockLatencyMs)) : problem(404, `Unknown meeting "${id}"`).pipe(delay(environment.mockLatencyMs));
  }
  if (req.method === 'POST' && tail === 'sync-now') {
    scheduleSync(key);
    return ok({ accepted: true }, 202).pipe(delay(environment.mockLatencyMs));
  }
  return problem(404, `No mock for ${req.method} ${path}`);
};
