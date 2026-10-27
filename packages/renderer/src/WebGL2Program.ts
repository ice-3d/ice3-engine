import { ICEEngineError } from '@ice3/core';
import type { ICEMatrix4 } from '@ice3/core';

const VERTEX_SOURCE = `
attribute vec3 a_position;
attribute vec3 a_normal;
uniform mat4 u_worldViewProjection;
varying vec3 v_normal;

void main() {
  gl_Position = u_worldViewProjection * vec4(a_position, 1.0);
  v_normal = a_normal;
}
`;

const FRAGMENT_SOURCE = `
precision mediump float;
uniform vec4 u_color;
varying vec3 v_normal;

void main() {
  vec3 normal = normalize(v_normal);
  float light = 0.35 + max(dot(normal, normalize(vec3(0.4, 0.8, 0.6))), 0.0) * 0.65;
  gl_FragColor = vec4(u_color.rgb * light, u_color.a);
}
`;

export class WebGL2Program {
  readonly program: WebGLProgram;
  private readonly matrixLocation: WebGLUniformLocation;
  private readonly colorLocation: WebGLUniformLocation;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly positionLocation: number,
    readonly normalLocation: number,
  ) {
    const program = this.createProgram(VERTEX_SOURCE, FRAGMENT_SOURCE);
    const matrixLocation = gl.getUniformLocation(program, 'u_worldViewProjection');
    const colorLocation = gl.getUniformLocation(program, 'u_color');
    if (!matrixLocation || !colorLocation) {
      gl.deleteProgram(program);
      throw new ICEEngineError(
        'ICE3_SHADER_LINK_FAILED',
        'ICE3_SHADER_LINK_FAILED: shader uniforms are missing',
      );
    }
    this.program = program;
    this.matrixLocation = matrixLocation;
    this.colorLocation = colorLocation;
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
    gl.bindAttribLocation(program, this.positionLocation, 'a_position');
    gl.bindAttribLocation(program, this.normalLocation, 'a_normal');
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
