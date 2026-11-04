//! 相机深度通道：屏幕空间遮蔽的来源。
//!
//! 从**相机**方向渲染一遍深度。必须覆盖全部几何路径——瓦片走渲染批次，其余走实例化
//! 批次；只画一条会让深度图大半是空的（SPEC-007）。

import { createShaderProgram } from './WebGL2Shader.js';

const VERTEX_SOURCE = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 3) in mat4 a_instanceMatrix;
uniform mat4 u_matrix;
uniform float u_useInstancing;
void main() {
  vec4 local = vec4(a_position, 1.0);
  vec4 world = mix(local, a_instanceMatrix * local, u_useInstancing);
  gl_Position = u_matrix * world;
}
`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
void main() {}
`;

export class WebGL2SceneDepth {
  private readonly framebuffer: WebGLFramebuffer;
  private depthTexture: WebGLTexture | null = null;
  private readonly program: WebGLProgram;
  private readonly matrixLocation: WebGLUniformLocation | null;
  private readonly instancingLocation: WebGLUniformLocation | null;
  private width = 0;
  private height = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = createShaderProgram(gl, VERTEX_SOURCE, FRAGMENT_SOURCE, 'scene-depth');
    this.matrixLocation = gl.getUniformLocation(this.program, 'u_matrix');
    this.instancingLocation = gl.getUniformLocation(this.program, 'u_useInstancing');
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error('ICE3_FRAMEBUFFER_FAILED: scene depth');
    this.framebuffer = framebuffer;
  }

  get texture(): WebGLTexture | null {
    return this.depthTexture;
  }

  begin(viewProjection: Float32Array, width: number, height: number): void {
    const gl = this.gl;
    this.ensureTexture(Math.max(1, width), Math.max(1, height));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    // 主 pass 的多边形偏移按屏幕深度斜率加权，会把深度推后，深度 pass 必须关掉。
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.matrixLocation, false, viewProjection);
    gl.uniform1f(this.instancingLocation, 0);
  }

  setMatrix(matrix: Float32Array): void {
    this.gl.uniformMatrix4fv(this.matrixLocation, false, matrix);
  }

  setInstancing(enabled: boolean): void {
    this.gl.uniform1f(this.instancingLocation, enabled ? 1 : 0);
  }

  end(width: number, height: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.viewport(0, 0, width, height);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.depthTexture) gl.deleteTexture(this.depthTexture);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteProgram(this.program);
    this.depthTexture = null;
  }

  private ensureTexture(width: number, height: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    if (this.depthTexture && this.width === width && this.height === height) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);
      return;
    }
    if (this.depthTexture) gl.deleteTexture(this.depthTexture);
    this.width = width;
    this.height = height;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, height, 0,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null,
    );
    // 深度纹理只能 NEAREST：LINEAR 会变成不完整纹理，采样恒为 0。
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
    // 只有深度附件的 FBO 必须声明「不画颜色」，否则帧缓冲不完整、写入被丢弃。
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    this.depthTexture = texture;
  }
}
