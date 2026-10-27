import { ICEIndexedGeometry } from '@ice3/core';
import { expect, it, vi } from 'node-test';
import { WebGL2GeometryCache } from '../src/WebGL2GeometryCache';
import { WebGL2Program } from '../src/WebGL2Program';

it('reuses buffers for the same geometry and releases unseen geometry', () => {
  const vertexArray = {} as WebGLVertexArrayObject;
  const positionBuffer = {} as WebGLBuffer;
  const triangleIndexBuffer = {} as WebGLBuffer;
  const edgeIndexBuffer = {} as WebGLBuffer;
  const gl = {
    ARRAY_BUFFER: 1,
    ELEMENT_ARRAY_BUFFER: 2,
    FLOAT: 3,
    STATIC_DRAW: 4,
    createVertexArray: vi.fn(() => vertexArray),
    createBuffer: vi
      .fn()
      .mockReturnValueOnce(positionBuffer)
      .mockReturnValueOnce(triangleIndexBuffer)
      .mockReturnValueOnce(edgeIndexBuffer),
    bindVertexArray: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    deleteVertexArray: vi.fn(),
    deleteBuffer: vi.fn(),
  } as unknown as WebGL2RenderingContext;
  const geometry = new ICEIndexedGeometry({
    id: 'triangle',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
    edgeIndices: new Uint16Array([0, 1, 1, 2, 2, 0]),
  });
  const cache = new WebGL2GeometryCache();

  const first = cache.retain(gl, geometry);
  cache.beginFrame();
  const second = cache.retain(gl, geometry);
  cache.endFrame();

  expect(WebGL2Program.POSITION_ATTRIBUTE).toBe(0);
  expect(second.vertexArray).toBe(first.vertexArray);
  expect(gl.createBuffer).toHaveBeenCalledTimes(3);

  cache.beginFrame();
  cache.endFrame();
  expect(gl.deleteVertexArray).toHaveBeenCalledWith(first.vertexArray);
  expect(gl.deleteBuffer).toHaveBeenCalledWith(first.triangleIndexBuffer);
});
