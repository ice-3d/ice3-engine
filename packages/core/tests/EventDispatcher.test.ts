import { describe, it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { ICEEventDispatcher } from '../src/index';

describe('ICEEventDispatcher', () => {
  it('preserves ordering and removes by function reference', () => {
    const events = new ICEEventDispatcher();
    const calls: string[] = [];
    const first = () => calls.push('first');
    const second = () => calls.push('second');

    events.on('change', first).on('change', second);
    events.trigger('change');
    events.off('change', first);
    events.trigger('change');

    expect(calls).toEqual(['first', 'second', 'second']);
  });

  it('fires a once listener only on the first trigger', () => {
    const events = new ICEEventDispatcher();
    const calls: number[] = [];

    events.once('tick', () => calls.push(1));
    events.trigger('tick').trigger('tick');

    expect(calls).toEqual([1]);
  });

  it('removes all listeners for all event types', () => {
    const events = new ICEEventDispatcher();
    const calls: string[] = [];
    events.on('first', () => calls.push('first'));
    events.on('second', () => calls.push('second'));

    events.removeAllListeners();
    events.trigger('first').trigger('second');

    expect(calls).toEqual([]);
  });
});
