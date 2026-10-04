import { describe, expect, test } from 'bun:test';
import { solveLinearSystem } from './linear';

describe('solveLinearSystem', () => {
  test('solves a small system', () => {
    const x = solveLinearSystem(
      [
        [2, 1],
        [1, 3],
      ],
      [3, 5],
    );
    expect(x[0]).toBeCloseTo(0.8, 12);
    expect(x[1]).toBeCloseTo(1.4, 12);
  });

  test('pivots when the diagonal holds a zero', () => {
    expect(
      solveLinearSystem(
        [
          [0, 1],
          [1, 0],
        ],
        [2, 3],
      ),
    ).toEqual([3, 2]);
  });

  test('solves a larger symmetric positive definite system (A x = b)', () => {
    const n = 12;
    const a = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? n + 3 : 1 / (1 + Math.abs(i - j)))),
    );
    const expected = Array.from({ length: n }, (_, i) => i - 5.5);
    const b = a.map((row) => row.reduce((acc, v, j) => acc + v * expected[j]!, 0));
    solveLinearSystem(a, b).forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 9));
  });

  test('does not mutate its inputs', () => {
    const a = [
      [4, 1],
      [1, 2],
    ];
    const b = [1, 2];
    solveLinearSystem(a, b);
    expect(a).toEqual([
      [4, 1],
      [1, 2],
    ]);
    expect(b).toEqual([1, 2]);
  });

  test('throws on a singular matrix (a programmer error: ridge systems are never singular)', () => {
    expect(() =>
      solveLinearSystem(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toThrow(/singular/i);
  });
});
