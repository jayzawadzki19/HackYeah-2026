import type { UserKey } from '../../../contracts/api-contract';
import { unknownUser } from '../common/problem';

export const USER_KEYS = ['jakub', 'marta'] as const satisfies readonly UserKey[];

/** Known account keys only. Anything else is a 404 problem, not a calendar miss. */
export const requireUserKey = (key: string): UserKey => {
  if (key === 'jakub' || key === 'marta') return key;
  throw unknownUser(key);
};
