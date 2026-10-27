import { ICEEventDispatcher } from '@ice3/core';

export class ICEInteractionState extends ICEEventDispatcher {
  private selection: readonly string[] = [];

  getSelection(): readonly string[] {
    return this.selection;
  }

  setSelection(ids: readonly string[]): this {
    const next = [...new Set(ids)];
    if (
      next.length === this.selection.length
      && next.every((id, index) => id === this.selection[index])
    ) {
      return this;
    }
    this.selection = Object.freeze(next);
    this.trigger('SELECTION_CHANGE', { selection: this.selection });
    return this;
  }
}
