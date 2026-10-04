import { HttpErrorResponse } from '@angular/common/http';

const isProblem = (body: unknown): body is { detail: string } => {
  if (typeof body !== 'object' || body === null || !('detail' in body)) return false;
  return typeof body.detail === 'string' && body.detail.trim().length > 0;
};

export const problemDetail = (error: unknown): string => {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Cannot reach the Headroom api. Check that it is running on port 3001.';
    if (isProblem(error.error)) return error.error.detail;
    const statusText = error.statusText.trim();
    return statusText ? `Request failed (${error.status} ${statusText}).` : `Request failed (${error.status}).`;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Something went wrong.';
};
