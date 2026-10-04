const SINGULAR_EPSILON = 1e-12;

/**
 * Solves A x = b by Gaussian elimination with partial pivoting.
 * Works on a private copy (local mutation is confined to this solver); inputs stay untouched.
 */
export const solveLinearSystem = (a: readonly (readonly number[])[], b: readonly number[]): number[] => {
  const n = b.length;
  if (a.length !== n || a.some((row) => row.length !== n)) throw new Error('solveLinearSystem: A must be n x n with n = b.length');
  const m = a.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    const pivot = m.reduce((best, row, r) => (r >= col && Math.abs(row[col]!) > Math.abs(m[best]![col]!) ? r : best), col);
    if (Math.abs(m[pivot]![col]!) < SINGULAR_EPSILON) throw new Error('solveLinearSystem: matrix is singular');
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const pivotRow = m[col]!;
    for (let r = col + 1; r < n; r++) {
      const row = m[r]!;
      const factor = row[col]! / pivotRow[col]!;
      if (factor !== 0) for (let c = col; c <= n; c++) row[c]! -= factor * pivotRow[c]!;
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = m[r]!;
    const tail = x.reduce((acc, xc, c) => (c > r ? acc + row[c]! * xc : acc), 0);
    x[r] = (row[n]! - tail) / row[r]!;
  }
  return x;
};
