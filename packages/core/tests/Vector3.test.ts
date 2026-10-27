import { describe, expect, it } from 'node-test';
import { ICEVector3 } from '../src/index';

describe('ICEVector3', () => {
  it('is immutable and returns a plain coordinate tuple', () => {
    const value = new ICEVector3(1, 2, 3);
    const clone = value.clone();

    expect(clone).not.toBe(value);
    expect(clone.toArray()).toEqual([1, 2, 3]);
    expect(Object.isFrozen(value)).toBe(true);
  });
});
