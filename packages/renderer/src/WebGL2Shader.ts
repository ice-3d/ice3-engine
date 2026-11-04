import { ICEEngineError } from '@ice3/core';

/**
 * Compile and link a program, throwing with the driver's info log on failure.
 *
 * WebGL fails silently: `compileShader`/`linkProgram` only set a status flag, and
 * code that returns `null` on failure turns a shader typo into "this pass simply
 * does nothing". That is exactly how a depth pass can run for two rounds without
 * changing a single pixel (SPEC-007). Every program in the renderer goes through
 * here so a broken shader is loud and quotable.
 */
export function createShaderProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  label: string,
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${label}:vertex`);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label}:fragment`);
  const program = gl.createProgram();
  if (!program) {
    throw new ICEEngineError(
      'ICE3_SHADER_LINK_FAILED',
      `ICE3_SHADER_LINK_FAILED: ${label}: program allocation failed`,
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
      `ICE3_SHADER_LINK_FAILED: ${label}: ${log}`,
    );
  }
  return program;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new ICEEngineError(
      'ICE3_SHADER_COMPILE_FAILED',
      `ICE3_SHADER_COMPILE_FAILED: ${label}: allocation failed`,
    );
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown compile error';
    gl.deleteShader(shader);
    throw new ICEEngineError(
      'ICE3_SHADER_COMPILE_FAILED',
      `ICE3_SHADER_COMPILE_FAILED: ${label}: ${log}`,
    );
  }
  return shader;
}
