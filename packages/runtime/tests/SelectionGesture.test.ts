import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  isSelectionClick,
  selectionForOutcome,
} from '../src/input/ICESelectionGesture';

it('treats movement up to four pixels as a selection click', () => {
  expect(isSelectionClick({ x: 10, y: 10 }, { x: 13, y: 10 })).toBe(true);
  expect(isSelectionClick({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true);
});

it('rejects movement beyond four pixels as a drag', () => {
  expect(isSelectionClick({ x: 10, y: 10 }, { x: 14.1, y: 10 })).toBe(false);
});

it('maps empty picks to a cleared selection and hits to one equipment ID', () => {
  expect(selectionForOutcome({ kind: 'empty' })).toEqual([]);
  expect(selectionForOutcome({ kind: 'hit', id: 'motor-9' }))
    .toEqual(['motor-9']);
  expect(selectionForOutcome({ kind: 'error' })).toBeUndefined();
});
