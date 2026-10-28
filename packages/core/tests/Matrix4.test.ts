import { describe, it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { ICEMatrix4, ICEVector3 } from '../src/index';

describe('ICEMatrix4', () => {
  it('keeps an identity transform unchanged', () => {
    const point = new ICEVector3(1, 2, 3);
    expect(new ICEMatrix4().identity().transformPoint(point)).toEqual([1, 2, 3, 1]);
  });

  it('builds a finite perspective matrix', () => {
    const values = new ICEMatrix4().perspective(45, 1, 0.1, 100).elements;
    expect(Array.from(values).every(Number.isFinite)).toBe(true);
    expect(values[11]).toBe(-1);
  });
});
