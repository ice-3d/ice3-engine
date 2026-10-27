import { ICEEngineError } from '@ice3/core';
import type { ICEMatrix4 } from '@ice3/core';

const VERTEX_SOURCE = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 2) in float a_semantic;
uniform mat4 u_worldViewProjection;
flat out int v_semantic;

void main() {
  gl_Position = u_worldViewProjection * vec4(a_position, 1.0);
  v_semantic = int(a_semantic + 0.5);
}
`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform float u_pickMode;
uniform uint u_pickBase;
uniform float u_highlightSemantic;
uniform vec4 u_color;
flat in int v_semantic;
out vec4 outColor;

void main() {
  if (u_pickMode > 0.5) {
    uint id = u_pickBase + uint(v_semantic) + 1u;
    outColor = vec4(
      float(id & 255u),
      float((id >> 8u) & 255u),
      float((id >> 16u) & 255u),
      1.0
    ) / 255.0;
    return;
  }
  if (abs(float(v_semantic) - u_highlightSemantic) > 0.1) discard;
  outColor = u_color;
}
`;

export class WebGL2SemanticProgram {
  private readonly program: WebGLProgram;
  private readonly matrixLocation: WebGLUniformLocation;
  private readonly pickModeLocation: WebGLUniformLocation;
  private readonly pickBaseLocation: WebGLUniformLocation;
  private readonly highlightLocation: WebGLUniformLocation;
  private readonly colorLocation: WebGLUniformLocation;

  constructor(private readonly gl: WebGL2RenderingContext) {
    const program = this.createProgram(VERTEX_SOURCE, FRAGMENT_SOURCE);
    const matrixLocation = gl.getUniformLocation(program, 'u_worldViewProjection');
    const pickModeLocation = gl.getUniformLocation(program, 'u_pickMode');
    const pickBaseLocation = gl.getUniformLocation(program, 'u_pickBase');
    const highlightLocation = gl.getUniformLocation(program, 'u_highlightSemantic');
    const colorLocation = gl.getUniformLocation(program, 'u_color');
    if (
      !matrixLocation
      || !pickModeLocation
      || !pickBaseLocation
      || !highlightLocation
      || !colorLocation
    ) {
      gl.deleteProgram(program);
      throw new ICEEngineError(
        'ICE3_SHADER_LINK_FAILED',
        'ICE3_SHADER_LINK_FAILED: semantic uniforms are missing',
      );
    }
    this.program = program;
    this.matrixLocation = matrixLocation;
    this.pickModeLocation = pickModeLocation;
    this.pickBaseLocation = pickBaseLocation;
    this.highlightLocation = highlightLocation;
    this.colorLocation = colorLocation;
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  setMatrix(matrix: ICEMatrix4): void {
    this.gl.uniformMatrix4fv(this.matrixLocation, false, matrix.elements);
  }

  setPick(base: number): void {
    this.gl.uniform1f(this.pickModeLocation, 1);
    this.gl.uniform1ui(this.pickBaseLocation, base);
  }

  setHighlight(semanticIndex: number): void {
    this.gl.uniform1f(this.pickModeLocation, 0);
    this.gl.uniform1f(this.highlightLocation, semanticIndex);
    this.gl.uniform4f(this.colorLocation, 1, 208 / 255, 0, 0.72);
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
