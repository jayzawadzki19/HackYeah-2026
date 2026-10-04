import { HttpErrorResponse } from '@angular/common/http';
import { problemDetail } from './problem';

describe('problemDetail', () => {
  it('shows the problem-details detail sent by the api', () => {
    const error = new HttpErrorResponse({
      status: 404,
      statusText: 'Not Found',
      error: { type: 'about:blank', title: 'Not Found', status: 404, detail: 'Unknown meeting "m-1"' },
    });

    expect(problemDetail(error)).toBe('Unknown meeting "m-1"');
  });

  it('explains an unreachable api', () => {
    expect(problemDetail(new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' }))).toBe(
      'Cannot reach the Headroom api. Check that it is running on port 3001.',
    );
  });

  it('falls back to the HTTP status when the body is not problem details', () => {
    expect(problemDetail(new HttpErrorResponse({ status: 502, statusText: 'Bad Gateway', error: '<html>' }))).toBe(
      'Request failed (502 Bad Gateway).',
    );
  });

  it('uses the message of a plain error', () => {
    expect(problemDetail(new Error('Timed out'))).toBe('Timed out');
  });

  it('never returns an empty text', () => {
    expect(problemDetail(undefined)).toBe('Something went wrong.');
  });
});
