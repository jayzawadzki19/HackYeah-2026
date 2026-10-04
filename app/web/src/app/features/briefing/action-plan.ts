import { ChangeDetectionStrategy, Component, input, output, signal, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ActionDto, EvidenceRefDto } from '@contracts';
import { PLAN_TOP, planView } from '../../domain/plan';
import { shortDate } from '../../domain/time';

@Component({
  selector: 'hr-action-plan',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [RouterLink],
  template: `
    <ol class="plan">
      @for (action of view().visible; track action.id) {
        <li data-testid="action" [attr.data-accepted]="action.accepted">
          <h3 data-testid="action-title">{{ action.title }}</h3>
          <button type="button" [attr.aria-expanded]="openId() === action.id ? 'true' : 'false'" (click)="toggle(action.id)">Why?</button>
          @if (openId() === action.id) {
            <p class="evidence">{{ action.evidence }}</p>
            <ul>
              @for (ref of action.evidenceRefs; track ref.label) {
                <li>
                  @if (ref.link === 'energy-map') {
                    <a data-testid="evidence-ref" [routerLink]="['/', userKey(), 'energy-map']">{{ refText(ref) }}</a>
                  } @else if (ref.link === 'meeting' && ref.meetingId) {
                    <a data-testid="evidence-ref" [routerLink]="['/', userKey(), 'meetings', ref.meetingId]">{{ refText(ref) }}</a>
                  } @else {
                    <span data-testid="evidence-ref">{{ refText(ref) }}</span>
                  }
                </li>
              }
            </ul>
          }
          @if (action.accepted) {
            <p class="added">Added to calendar</p>
          } @else {
            <button type="button" class="commit" (click)="accept.emit(action.id)">Add to plan</button>
          }
        </li>
      }
    </ol>
    @if (view().hiddenCount > 0) {
      <button type="button" class="more" (click)="expanded.set(true)">Show more</button>
    } @else if (expanded() && actions().length > top) {
      <button type="button" class="more" (click)="expanded.set(false)">Show less</button>
    }
  `,
})
export class ActionPlan {
  readonly actions = input.required<readonly ActionDto[]>();
  readonly userKey = input('marta');
  readonly accept = output<string>();

  readonly expanded = signal(false);
  readonly openId = signal<string | null>(null);
  readonly top = PLAN_TOP;
  readonly view = () => planView(this.actions(), this.expanded());

  toggle(id: string): void {
    this.openId.update(current => (current === id ? null : id));
  }

  refText(ref: EvidenceRefDto): string {
    return ref.date ? `${ref.label} · ${shortDate(ref.date)}` : ref.label;
  }
}
