import { ICEEngineError } from '@ice3/core';
import type { ICEMatrix4 } from '@ice3/core';

const VERTEX_SOURCE = `
attribute vec3 a_position;
uniform mat4 u_worldViewProjection;
uniform vec2 u_clipOffset;

void main() {
  gl_Position = u_worldViewProjection * vec4(a_position, 1.0);
  gl_Position.xy += u_clipOffset * gl_Position.w;
}
`;

const FRAGMENT_SOURCE = `
precision mediump float;
uniform vec4 u_color;

void main() {
  gl_FragColor = u_color;
}
`;

export class WebGL2Program {
  static readonly POSITION_ATTRIBUTE = 0;
  readonly program: WebGLProgram;
  private readonly matrixLocation: WebGLUniformLocation;
  private readonly colorLocation: WebGLUniformLocation;
  private readonly clipOffsetLocation: WebGLUniformLocation;

  constructor(private readonly gl: WebGL2RenderingContext) {
    const program = this.createProgram(VERTEX_SOURCE, FRAGMENT_SOURCE);
    const matrixLocation = gl.getUniformLocation(program, 'u_worldViewProjection');
    const colorLocation = gl.getUniformLocation(program, 'u_color');
    const clipOffsetLocation = gl.getUniformLocation(program, 'u_clipOffset');
    if (!matrixLocation || !colorLocation || !clipOffsetLocation) {
      gl.deleteProgram(program);
      throw new ICEEngineError(
        'ICE3_SHADER_LINK_FAILED',
        'ICE3_SHADER_LINK_FAILED: shader uniforms are missing',
      );
    }
    this.program = program;
    this.matrixLocation = matrixLocation;
    this.colorLocation = colorLocation;
    this.clipOffsetLocation = clipOffsetLocation;
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  setMatrix(matrix: ICEMatrix4): void {
    this.gl.uniformMatrix4fv(this.matrixLocation, false, matrix.elements);
  }

  setColor(color: readonly [number, number, number, number]): void {
    this.gl.uniform4f(this.colorLocation, ...color);
  }

  setClipOffset(x: number, y: number): void {
    this.gl.uniform2f(this.clipOffsetLocation, x, y);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const vertex = this.compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = this.compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      throw new ICEEngineError(
        'ICE3_SHADER_LINK_FAILED',
        'ICE3_SHADER_LINK_FAILED: program allocation failed',
      );
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, WebGL2Program.POSITION_ATTRIBUTE, 'a_position');
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'unknown link error';
      gl.deleteProgram(program);
      throw new ICEEngineError(
        'ICE3_SHADER_LINK_FAILED',
        `ICE3_SHADER_LINK_FAILED: ${log}`,
      );
    }
    return program;
  }

  private compile(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) {
      throw new ICEEngineError(
        'ICE3_SHADER_COMPILE_FAILED',
        'ICE3_SHADER_COMPILE_FAILED: shader allocation failed',
      );
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'unknown compile error';
      gl.deleteShader(shader);
      throw new ICEEngineError(
        'ICE3_SHADER_COMPILE_FAILED',
        `ICE3_SHADER_COMPILE_FAILED: ${log}`,
      );
    }
    return shader;
  }
}
