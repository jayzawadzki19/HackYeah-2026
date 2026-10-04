import type { CapacityComponentKind, CapacityDto } from '@contracts';

export const NO_DATA = 'no data';

const COMPONENTS: readonly { readonly kind: CapacityComponentKind; readonly label: string; readonly missing: string }[] = [
  { kind: 'sleep', label: 'Sleep', missing: 'No sleep data' },
  { kind: 'hrv', label: 'HRV', missing: 'No HRV data' },
  { kind: 'bodyBattery', label: 'Body Battery', missing: 'No Body Battery data' },
  { kind: 'resilience', label: 'Resilience', missing: 'No resilience score' },
];

export interface CapacityRow {
  readonly kind: CapacityComponentKind;
  readonly label: string;
  readonly score: number | null;
  readonly value: string;
  readonly hasData: boolean;
  readonly detail: string;
  readonly weightPct: number | null;
}

const isScore = (score: number | null): score is number => score !== null && Number.isFinite(score);

/** A score as text; anything that is not a finite number reads "no data", never 0 or NaN. */
export const scoreText = (score: number | null): string => (isScore(score) ? String(Math.round(score)) : NO_DATA);

export const capacityRows = (capacity: CapacityDto): readonly CapacityRow[] =>
  COMPONENTS.map(({ kind, label, missing }) => {
    const component = capacity.components.find(c => c.kind === kind);
    const score = component && isScore(component.score) ? component.score : null;
    return {
      kind,
      label,
      score,
      value: scoreText(score),
      hasData: score !== null,
      detail: component?.detail ?? missing,
      weightPct: score !== null && component ? Math.round(component.weight * 100) : null,
    };
  });
