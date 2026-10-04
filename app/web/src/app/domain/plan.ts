import type { ActionDto } from '@contracts';

/** The briefing shows this many actions before "Show more" */
export const PLAN_TOP = 3;

export interface PlanView {
  readonly visible: readonly ActionDto[];
  readonly hiddenCount: number;
  readonly anyAccepted: boolean;
}

/** Keeps the api ranking (rule priority, then impact): the server owns the order, the UI only folds it. */
export const planView = (actions: readonly ActionDto[], expanded: boolean): PlanView => {
  const visible = expanded ? actions : actions.slice(0, PLAN_TOP);
  return {
    visible,
    hiddenCount: actions.length - visible.length,
    anyAccepted: actions.some(a => a.accepted),
  };
};
