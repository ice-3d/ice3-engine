const MAX_SELECTION_INDEX = 0xffffff;

export function encodeSelectionIndex(
  index: number,
): readonly [number, number, number, 255] {
  if (!Number.isInteger(index) || index < 0 || index > MAX_SELECTION_INDEX) {
    throw new RangeError('ICE selection index is out of range');
  }
  return [
    index & 0xff,
    (index >>> 8) & 0xff,
    (index >>> 16) & 0xff,
    255,
  ];
}

export function decodeSelectionIndex(
  pixel: ArrayLike<number>,
): number | undefined {
  if (pixel.length < 4) {
    throw new RangeError('ICE pick pixel must contain RGBA values');
  }
  const index = pixel[0]!
    + pixel[1]! * 256
    + pixel[2]! * 65_536;
  return index === 0 ? undefined : index;
}
