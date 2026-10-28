import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  queueBatchGeneration,
  type ICEBatchUploadBuffer,
} from '../src/ICEWebGL2BatchGenerationUploader.js';

const buffer = (
  id: string,
  byteLength = 30,
): ICEBatchUploadBuffer => ({
  id,
  materialKey: 'material:0',
  positions: new Float32Array(3),
  indices: new Uint32Array([0, 1, 2]),
  semanticIndices: new Uint32Array(3),
  semanticIds: ['semantic:0'],
  semanticNodeIds: ['node:0'],
  semanticSelectionIds: ['device:0'],
  bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  triangleCount: 1,
  byteLength,
});

const scheduler = () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 1;
  return {
    schedule(callback: FrameRequestCallback): number {
      const id = next;
      next += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id: number): void {
      callbacks.delete(id);
    },
    frame(): void {
      const entry = callbacks.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      if (!entry) throw new Error('no frame scheduled');
      callbacks.delete(entry[0]);
      entry[1](0);
    },
    pending: () => callbacks.size,
  };
};

test('uploads within the frame byte cap and activates only at the end', () => {
  const frames = scheduler();
  const uploaded: string[] = [];
  let activation = 0;
  queueBatchGeneration([buffer('one'), buffer('two')], {
    generation: 2,
    bytesPerFrame: 40,
    upload: (value) => {
      uploaded.push(value.id);
      return value.id;
    },
    release: () => undefined,
    schedule: frames.schedule,
    cancelSchedule: frames.cancel,
    onUploaded: () => {
      activation += 1;
    },
    onFailed: () => undefined,
  });

  frames.frame();
  expect(uploaded).toEqual(['one']);
  expect(activation).toBe(0);
  frames.frame();
  expect(uploaded).toEqual(['one', 'two']);
  expect(activation).toBe(1);
});

test('releases every uploaded candidate when a later chunk fails', () => {
  const frames = scheduler();
  const released: string[] = [];
  let failure: unknown;
  queueBatchGeneration([buffer('one'), buffer('two')], {
    generation: 3,
    bytesPerFrame: 40,
    upload: (value) => {
      if (value.id === 'two') throw new Error('upload failed');
      return value.id;
    },
    release: (resource) => {
      released.push(resource as string);
    },
    schedule: frames.schedule,
    cancelSchedule: frames.cancel,
    onUploaded: () => undefined,
    onFailed: (_generation, error) => {
      failure = error;
    },
  });

  frames.frame();
  frames.frame();

  expect(failure).toBeInstanceOf(Error);
  expect(released).toEqual(['one']);
});

test('does not activate a superseded generation', () => {
  const frames = scheduler();
  let activation = 0;
  let current = true;
  queueBatchGeneration([buffer('one')], {
    generation: 4,
    bytesPerFrame: 100,
    isCurrent: () => current,
    upload: (value) => value.id,
    release: () => undefined,
    schedule: frames.schedule,
    cancelSchedule: frames.cancel,
    onUploaded: () => {
      activation += 1;
    },
    onFailed: () => undefined,
  });
  current = false;

  frames.frame();

  expect(activation).toBe(0);
});

test('releases the candidate when activation throws', () => {
  const frames = scheduler();
  const released: string[] = [];
  let failure: unknown;
  queueBatchGeneration([buffer('one')], {
    generation: 5,
    bytesPerFrame: 100,
    upload: (value) => value.id,
    release: (resource) => {
      released.push(resource as string);
    },
    onActivate: () => {
      throw new Error('activation failed');
    },
    schedule: frames.schedule,
    cancelSchedule: frames.cancel,
    onUploaded: () => undefined,
    onFailed: (_generation, error) => {
      failure = error;
    },
  });

  expect(() => frames.frame()).not.toThrow();
  expect(failure).toBeInstanceOf(Error);
  expect(released).toEqual(['one']);
});
