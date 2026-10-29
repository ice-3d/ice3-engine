import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { WebGPUDrawStorage } from '../src/WebGPUDrawStorage';

it('reuses typed storage when draw count stays within capacity', () => {
  const storage = new WebGPUDrawStorage(2);
  storage.begin(2);
  storage.append({
    matrix: new Float32Array(16),
    color: [1, 1, 1, 1],
    useVertexColor: false,
    useInstancing: false,
    selectionBase: 0,
    useSelectionMask: 1,
  });
  const first = storage.uniformData;
  storage.begin(2);
  storage.append({
    matrix: new Float32Array(16),
    color: [0, 0, 0, 1],
    useVertexColor: false,
    useInstancing: false,
    selectionBase: 0,
    useSelectionMask: 1,
  });

  expect(storage.uniformData).toBe(first);
  expect(storage.drawCount).toBe(1);
});

it('grows when a Tile scene exceeds the initial draw estimate', () => {
  const storage = new WebGPUDrawStorage(1);
  storage.begin(1);
  const draw = {
    matrix: new Float32Array(16),
    color: [0, 0, 0, 1] as const,
    useVertexColor: false,
    useInstancing: false,
    selectionBase: 0,
    useSelectionMask: false,
  };
  storage.append(draw);
  storage.append(draw);
  expect(storage.drawCount).toBe(2);
  expect(storage.generation).toBe(1);
});
