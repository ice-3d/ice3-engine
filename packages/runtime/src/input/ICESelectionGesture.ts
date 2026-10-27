export const SELECTION_CLICK_THRESHOLD_PX = 4;

export function isSelectionClick(
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>,
): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y)
    <= SELECTION_CLICK_THRESHOLD_PX;
}

export type ICEPickOutcome =
  | { readonly kind: 'hit'; readonly id: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'error' };

export function selectionForOutcome(
  outcome: ICEPickOutcome,
): readonly string[] | undefined {
  if (outcome.kind === 'hit') return [outcome.id];
  if (outcome.kind === 'empty') return [];
  return undefined;
}
