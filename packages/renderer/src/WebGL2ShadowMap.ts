//! 方向光阴影贴图。
//!
//! 一次深度 pass 把场景从光源方向渲染进深度纹理，主 pass 再按世界坐标比较深度。
//! 只处理单方向光、单张贴图；视锥按场景包围盒拟合（见 ShadowFrustum）。

import { createShaderProgram } from './WebGL2Shader.js';
import { shadowFrustum, type ICEBounds } from './ShadowFrustum.js';

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
void main() {
  // 只写深度，颜色不需要。
}
`;

/** 光源方向（与主着色器的 diffuse 保持同一方向）。 */
export { SHADOW_LIGHT_DIRECTION as LIGHT_DIRECTION } from './ShadowFrustum.js';

const SHADOW_SIZE = 2048;

export class WebGL2ShadowMap {
  /** 最近一次着色器编译/链接失败的原因，供诊断读取。 */
  lastError: string | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private depthTexture: WebGLTexture | null = null;
  private program: WebGLProgram | null = null;
  private matrixLocation: WebGLUniformLocation | null = null;
  private instancingLocation: WebGLUniformLocation | null = null;
  private matrixScratch = new Float32Array(16);
  private texelWorldValue = 1;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.createResources();
  }

  /** 深度纹理，供主着色器采样。 */
  get texture(): WebGLTexture | null {
    return this.depthTexture;
  }

  get matrix(): Float32Array {
    return this.matrixScratch;
  }

  /** 一个深度纹素在世界空间的边长（米）。法线偏移按它换算，别用魔数。 */
  get texelWorld(): number {
    return this.texelWorldValue;
  }

  /**
   * 按场景包围盒拟合视锥。每帧调用没有意义——场景内容不变时矩阵也不会变，
   * 所以由调用方决定何时重算（包围盒变化或首帧）。
   */
  setBounds(bounds: ICEBounds | null): void {
    const frustum = shadowFrustum(bounds, SHADOW_SIZE);
    this.matrixScratch.set(frustum.matrix);
    this.texelWorldValue = frustum.texelWorld;
  }

  /** 绑定阴影帧缓冲，返回是否成功。 */
  begin(): boolean {
    const gl = this.gl;
    if (!this.framebuffer || !this.program) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    // 阴影 pass 必须关掉多边形偏移：主 pass 为了避免共面闪烁开了 offset(2, 4)，
    // 那是按屏幕空间深度斜率加权的，在深度 pass 里会把投影深度推后，阴影直接消失。
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    // 不做面剔除：深度图记下的是「离光最近」的那一层，配合法线偏移，
    // 受光面不会和自己打架。剔除依赖顶点绕序，导入模型绕序不统一时会静默失效。
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.matrixLocation, false, this.matrixScratch);
    gl.uniform1f(this.instancingLocation, 1);
    return true;
  }

  /**
   * 非实例化绘制：矩阵换成 `lightViewProjection × world`，顶点位置直接当世界坐标用。
   *
   * 阴影通道原先只会画实例化批次，瓦片（渲染批次）与落单网格因此完全不投影。
   * 补这两条路径靠的就是这个入口——和 `WebGL2SceneDepth` 同一套写法。
   */
  setMatrix(matrix: Float32Array): void {
    this.gl.uniformMatrix4fv(this.matrixLocation, false, matrix);
  }

  setInstancing(enabled: boolean): void {
    this.gl.uniform1f(this.instancingLocation, enabled ? 1 : 0);
  }

  /** 解绑，恢复默认帧缓冲。 */
  end(width: number, height: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.viewport(0, 0, width, height);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.depthTexture) gl.deleteTexture(this.depthTexture);
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    if (this.program) gl.deleteProgram(this.program);
    this.depthTexture = null;
    this.framebuffer = null;
    this.program = null;
  }

  private createResources(): void {
    const gl = this.gl;

    this.depthTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      SHADOW_SIZE,
      SHADOW_SIZE,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null,
    );
    // 深度纹理不可线性过滤：DEPTH_COMPONENT24 开 LINEAR 会让纹理不完整，
    // 采样一律返回 0，结果就是整片场景被误判成「全在阴影里」。
    // 这里用 NEAREST，柔化交给主着色器里的 3×3 手工取样。
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D,
      this.depthTexture,
      0,
    );
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.program = this.createProgram(VERTEX_SOURCE, FRAGMENT_SOURCE);
    this.matrixLocation = this.program
      ? gl.getUniformLocation(this.program, 'u_matrix')
      : null;
    this.instancingLocation = this.program
      ? gl.getUniformLocation(this.program, 'u_useInstancing')
      : null;
    this.setBounds(null);
  }

  private createProgram(vertex: string, fragment: string): WebGLProgram | null {
    try {
      return createShaderProgram(this.gl, vertex, fragment, 'shadow');
    } catch (error) {
      // 阴影是可选效果：编译失败不该让整帧崩掉，但必须留下可读的原因，
      // 否则"阴影悄悄不工作"会伪装成光照问题。
      this.lastError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }
}
