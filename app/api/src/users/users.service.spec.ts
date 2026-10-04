import { describe, expect, test } from 'bun:test';
import type { UserKey } from '../../../contracts/api-contract';
import { CalendarUnavailableError, type CalendarProvider } from '../calendar/calendar.provider';
import { ProblemException } from '../common/problem';
import { requireUserKey } from './user-key';
import { UsersService } from './users.service';

const profileFor = (userKey: UserKey, displayName: string, isSynthetic: boolean) => ({
  userKey,
  displayName,
  isSynthetic,
  timeZone: 'Europe/Warsaw',
});

const provider = (behavior: (userKey: UserKey) => Promise<ReturnType<typeof profileFor>>): CalendarProvider => ({
  profile: behavior,
  async events() {
    return [];
  },
  async people() {
    return [];
  },
  async seedReflections() {
    return [];
  },
});

describe('UsersService', () => {
  test('lists both accounts', async () => {
    const users = new UsersService(
      provider(async (userKey) => profileFor(userKey, userKey === 'jakub' ? 'Jakub' : 'Marta', userKey === 'marta')),
    );

    expect(await users.list()).toEqual([
      { key: 'jakub', displayName: 'Jakub', isSynthetic: false, live: true, timeZone: 'Europe/Warsaw' },
      { key: 'marta', displayName: 'Marta', isSynthetic: true, live: false, timeZone: 'Europe/Warsaw' },
    ]);
  });

  test('skips a user whose calendar file is missing', async () => {
    const users = new UsersService(
      provider(async (userKey) => {
        if (userKey === 'marta') throw new CalendarUnavailableError(userKey, 'cannot read marta.json (missing)');
        return profileFor(userKey, 'Jakub', false);
      }),
    );

    expect(await users.list()).toEqual([
      { key: 'jakub', displayName: 'Jakub', isSynthetic: false, live: true, timeZone: 'Europe/Warsaw' },
    ]);
  });

  test('does not hide an unexpected calendar failure', async () => {
    const users = new UsersService(
      provider(async (userKey) => {
        if (userKey === 'marta') throw new Error('disk on fire');
        return profileFor(userKey, 'Jakub', false);
      }),
    );

    await expect(users.list()).rejects.toThrow('disk on fire');
  });

  test('rejects an unknown account key', () => {
    expect(() => requireUserKey('ada')).toThrow(ProblemException);
    try {
      requireUserKey('ada');
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemException);
      expect((error as ProblemException).problem).toMatchObject({
        status: 404,
        detail: 'There is no user "ada".',
      });
    }
  });
});
