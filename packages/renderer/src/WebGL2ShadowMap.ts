//! 方向光阴影贴图。
//!
//! 一次深度 pass 把场景从光源方向渲染进深度纹理，主 pass 再按世界坐标比较深度。
//! 只处理单方向光、单张贴图，够覆盖当前查看器的需要；级联与软阴影留给后续。

const VERTEX_SOURCE = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 3) in mat4 a_instanceMatrix;
uniform mat4 u_lightViewProjection;
void main() {
  vec4 world = a_instanceMatrix * vec4(a_position, 1.0);
  gl_Position = u_lightViewProjection * world;
}
`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
void main() {
  // 只写深度，颜色不需要。
}
`;

/** 光源方向（与主着色器的 diffuse 保持同一方向）。 */
export const LIGHT_DIRECTION: readonly [number, number, number] = [-0.35, 0.85, 0.4];

const SHADOW_SIZE = 2048;
const DEPTH_BIAS = 0.0018;
const ORTHO_EXTENT = 430;
const ORTHO_NEAR = -260;
const ORTHO_FAR = 700;

export class WebGL2ShadowMap {
  private framebuffer: WebGLFramebuffer | null = null;
  private depthTexture: WebGLTexture | null = null;
  private program: WebGLProgram | null = null;
  private lightMatrixLocation: WebGLUniformLocation | null = null;
  private matrixScratch = new Float32Array(16);

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
    // 只渲染背面：深度图记下的是物体「背着光」的那一层，
    // 受光面自己就不会和自己打架，剩下的偏移量可以给得很小。
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.lightMatrixLocation, false, this.matrixScratch);
    return true;
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
    this.lightMatrixLocation = this.program
      ? gl.getUniformLocation(this.program, 'u_lightViewProjection')
      : null;
    this.updateLightMatrix();
  }

  /** 正交光源矩阵：覆盖整片场地，与主着色器的光方向一致。 */
  private updateLightMatrix(): void {
    const direction = normalize(LIGHT_DIRECTION);
    // 视锥对准场地中心：偏到一端的话，另一端会整片落在投影范围之外，
    // 表现就是「只有一半厂区有影子，还带一条斜的硬边」。
    const target: [number, number, number] = [300, 0, 0];
    const eye: [number, number, number] = [
      target[0]! + direction[0]! * 400,
      target[1]! + direction[1]! * 400,
      target[2]! + direction[2]! * 400,
    ];
    const view = lookAt(eye, target, [0, 1, 0]);
    const projection = orthographic(
      -ORTHO_EXTENT,
      ORTHO_EXTENT,
      -ORTHO_EXTENT,
      ORTHO_EXTENT,
      ORTHO_NEAR,
      ORTHO_FAR,
    );
    this.matrixScratch.set(multiply(projection, view));
  }

  private createProgram(vertex: string, fragment: string): WebGLProgram | null {
    const gl = this.gl;
    const vertexShader = this.compile(gl.VERTEX_SHADER, vertex);
    const fragmentShader = this.compile(gl.FRAGMENT_SHADER, fragment);
    if (!vertexShader || !fragmentShader) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  private compile(type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
}

export const SHADOW_BIAS = DEPTH_BIAS;

function normalize(value: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(value[0]!, value[1]!, value[2]!) || 1;
  return [value[0]! / length, value[1]! / length, value[2]! / length];
}

function subtract(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

function lookAt(
  eye: readonly number[],
  target: readonly number[],
  up: readonly number[],
): number[] {
  const forward = normalize(subtract(eye, target) as [number, number, number]);
  const right = normalize(cross(up, forward));
  const cameraUp = cross(forward, right);
  // 列主序：三个基向量各占一列，平移在最后一列。
  // 写成「行主序」的样子会让整个视图变换变成转置，投影出来的坐标全是乱的。
  return [
    right[0]!, right[1]!, right[2]!, 0,
    cameraUp[0]!, cameraUp[1]!, cameraUp[2]!, 0,
    forward[0]!, forward[1]!, forward[2]!, 0,
    -dot(right, eye), -dot(cameraUp, eye), -dot(forward, eye), 1,
  ];
}

function orthographic(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): number[] {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  return [
    -2 * lr, 0, 0, 0,
    0, -2 * bt, 0, 0,
    0, 0, 2 * nf, 0,
    (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1,
  ];
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}
