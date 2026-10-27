import { ICEEngineError, ICEMatrix4 } from '@ice3/core';
import type { ICEGeometryRenderable } from './WebGL2GeometryBatch.js';
import type { WebGL2GeometryCache } from './WebGL2GeometryCache.js';
import {
  decodeSelectionIndex,
  encodeSelectionIndex,
} from './WebGL2PickCodec.js';
import { WebGL2Program } from './WebGL2Program.js';
import type { ICERenderBatchDraw } from './WebGL2RenderBatch.js';
import { WebGL2SemanticProgram } from './WebGL2SemanticProgram.js';
import type { ICEFrame, ICEScreenPoint } from './types.js';

export type ICEPickFrame = ICEFrame & {
  readonly point: ICEScreenPoint;
};

export class WebGL2Picker {
  private readonly program: WebGL2Program;
  private readonly semanticProgram: WebGL2SemanticProgram;
  private framebuffer: WebGLFramebuffer | null = null;
  private colorTexture: WebGLTexture | null = null;
  private depthBuffer: WebGLRenderbuffer | null = null;
  private width = 0;
  private height = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = new WebGL2Program(gl);
    this.semanticProgram = new WebGL2SemanticProgram(gl);
  }

  pick(
    frame: ICEPickFrame,
    cache: WebGL2GeometryCache,
    renderables: readonly ICEGeometryRenderable[],
    batches: readonly ICERenderBatchDraw[] = [],
  ): string | undefined {
    const pickIds = new Map<number, string>();
    const selectionIds = new Map<string, number>();
    for (const renderable of renderables) {
      const id = renderable.mesh.selectionId;
      if (!selectionIds.has(id)) {
        if (selectionIds.size >= 0xffffff) {
          throw new ICEEngineError(
            'ICE3_PICK_CAPACITY',
            'ICE3_PICK_CAPACITY: too many selectable devices',
          );
        }
        const index = selectionIds.size + 1;
        selectionIds.set(id, index);
        pickIds.set(index, id);
      }
    }
    this.ensureTarget(
      Math.max(1, Math.round(frame.viewport.width * frame.dpr)),
      Math.max(1, Math.round(frame.viewport.height * frame.dpr)),
    );
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    this.program.use();
    this.program.setClipOffset(0, 0);
    const aspect = frame.viewport.width / Math.max(frame.viewport.height, 1);
    const viewProjection = frame.camera.getViewProjectionMatrix(aspect);
    const mvp = new ICEMatrix4();
    const world = new ICEMatrix4();
    for (const renderable of renderables) {
      const selectionIndex = selectionIds.get(renderable.mesh.selectionId)!;
      const color = encodeSelectionIndex(selectionIndex);
      this.program.setColor([
        color[0] / 255,
        color[1] / 255,
        color[2] / 255,
        1,
      ]);
      mvp.elements.set(viewProjection.elements);
      world.elements.set(renderable.worldMatrix);
      mvp.multiply(world);
      this.program.setMatrix(mvp);
      this.program.setVertexColors(false);
      const geometry = cache.retain(gl, renderable.mesh.geometry);
      gl.bindVertexArray(geometry.vertexArray);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.triangleIndexBuffer);
      gl.drawElements(
        gl.TRIANGLES,
        geometry.triangleCount,
        renderable.mesh.geometry.indices instanceof Uint16Array
          ? gl.UNSIGNED_SHORT
          : gl.UNSIGNED_INT,
        0,
      );
    }
    this.semanticProgram.use();
    let nextPickId = selectionIds.size + 1;
    for (const draw of batches) {
      const base = nextPickId - 1;
      for (const id of draw.batch.semanticSelectionIds) {
        if (nextPickId > 0xffffff) {
          throw new ICEEngineError(
            'ICE3_PICK_CAPACITY',
            'ICE3_PICK_CAPACITY: too many selectable batch devices',
          );
        }
        pickIds.set(nextPickId, id);
        nextPickId += 1;
      }
      mvp.elements.set(viewProjection.elements);
      world.elements.set(draw.worldMatrix);
      mvp.multiply(world);
      this.semanticProgram.setMatrix(mvp);
      this.semanticProgram.setPick(base);
      const geometry = cache.retain(gl, draw.batch.geometry);
      gl.bindVertexArray(geometry.vertexArray);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.triangleIndexBuffer);
      gl.drawElements(
        gl.TRIANGLES,
        geometry.triangleCount,
        draw.batch.geometry.indices instanceof Uint16Array
          ? gl.UNSIGNED_SHORT
          : gl.UNSIGNED_INT,
        0,
      );
    }
    const pixelX = Math.max(
      0,
      Math.min(
        this.width - 1,
        Math.floor(frame.point.x * frame.dpr),
      ),
    );
    const pixelY = Math.max(
      0,
      Math.min(
        this.height - 1,
        Math.floor((frame.viewport.height - frame.point.y) * frame.dpr),
      ),
    );
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    const pixel = new Uint8Array(4);
    gl.readPixels(pixelX, pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(
      frame.viewport.x * frame.dpr,
      frame.viewport.y * frame.dpr,
      frame.viewport.width * frame.dpr,
      frame.viewport.height * frame.dpr,
    );
    const index = decodeSelectionIndex(pixel);
    return index === undefined ? undefined : pickIds.get(index);
  }

  dispose(): void {
    this.releaseTarget();
    this.program.dispose();
    this.semanticProgram.dispose();
  }

  private ensureTarget(width: number, height: number): void {
    if (
      this.framebuffer
      && this.colorTexture
      && this.depthBuffer
      && this.width === width
      && this.height === height
    ) {
      return;
    }
    this.releaseTarget();
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    const colorTexture = gl.createTexture();
    const depthBuffer = gl.createRenderbuffer();
    if (!framebuffer || !colorTexture || !depthBuffer) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(colorTexture);
      gl.deleteRenderbuffer(depthBuffer);
      throw new ICEEngineError(
        'ICE3_PICK_UNAVAILABLE',
        'ICE3_PICK_UNAVAILABLE: pick target allocation failed',
      );
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      colorTexture,
      0,
    );
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorage(
      gl.RENDERBUFFER,
      gl.DEPTH_COMPONENT16,
      width,
      height,
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      depthBuffer,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(colorTexture);
      gl.deleteRenderbuffer(depthBuffer);
      throw new ICEEngineError(
        'ICE3_PICK_UNAVAILABLE',
        'ICE3_PICK_UNAVAILABLE: pick framebuffer is incomplete',
      );
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.framebuffer = framebuffer;
    this.colorTexture = colorTexture;
    this.depthBuffer = depthBuffer;
    this.width = width;
    this.height = height;
  }

  private releaseTarget(): void {
    const gl = this.gl;
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteTexture(this.colorTexture);
    gl.deleteRenderbuffer(this.depthBuffer);
    this.framebuffer = null;
    this.colorTexture = null;
    this.depthBuffer = null;
  }
}
