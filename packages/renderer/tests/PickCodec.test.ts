import { expect, it } from 'node-test';
import {
  decodeSelectionIndex,
  encodeSelectionIndex,
} from '../src/WebGL2PickCodec';

it.each([
  [0, [0, 0, 0, 255]],
  [1, [1, 0, 0, 255]],
  [255, [255, 0, 0, 255]],
  [256, [0, 1, 0, 255]],
  [0xffffff, [255, 255, 255, 255]],
] as const)('encodes selection index %i', (index, expected) => {
  expect(encodeSelectionIndex(index)).toEqual(expected);
  expect(decodeSelectionIndex(expected)).toBe(
    index === 0 ? undefined : index,
  );
});

it('decodes zero as no selection and rejects out-of-range indices', () => {
  expect(decodeSelectionIndex([0, 0, 0, 255])).toBeUndefined();
  expect(() => encodeSelectionIndex(-1)).toThrow(/selection index/i);
  expect(() => encodeSelectionIndex(0x1000000)).toThrow(/selection index/i);
});
