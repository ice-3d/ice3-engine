import { ICEEngineError } from '@ice3/core';
import type { ICEMatrix4 } from '@ice3/core';

const LIGHT_DIRECTION = [-0.35, 0.85, 0.4] as const;
const LIGHTING = Object.freeze({
  ambient: 0.72,
  direct: 0.72,
  sky: 0.18,
  minimum: 0.92,
  maximum: 1.42,
});

export function directionalLightingShade(
  normal: readonly [number, number, number],
): number {
  const length = Math.hypot(...normal) || 1;
  const nx = normal[0] / length;
  const ny = normal[1] / length;
  const nz = normal[2] / length;
  const diffuse = nx * LIGHT_DIRECTION[0]
    + ny * LIGHT_DIRECTION[1]
    + nz * LIGHT_DIRECTION[2];
  const key = Math.max(diffuse, 0) + 0.35 * Math.max(-diffuse, 0);
  const hemisphere = 0.5 + 0.5 * ny;
  return Math.max(
    LIGHTING.minimum,
    Math.min(
      LIGHTING.maximum,
      LIGHTING.ambient + LIGHTING.direct * key + LIGHTING.sky * hemisphere,
    ),
  );
}

const VERTEX_SOURCE = `#version 300 es
in vec3 a_position;
in vec3 a_color;
in vec4 a_instanceColumn0;
in vec4 a_instanceColumn1;
in vec4 a_instanceColumn2;
in vec4 a_instanceColumn3;
uniform mat4 u_worldViewProjection;
uniform vec2 u_clipOffset;
uniform float u_useInstancing;
out vec3 v_color;
out vec3 v_worldPosition;

void main() {
  mat4 instanceMatrix = mat4(
    a_instanceColumn0,
    a_instanceColumn1,
    a_instanceColumn2,
    a_instanceColumn3
  );
  vec4 localPosition = vec4(a_position, 1.0);
  vec4 position = mix(
    localPosition,
    instanceMatrix * localPosition,
    u_useInstancing
  );
  gl_Position = u_worldViewProjection * position;
  gl_Position.xy += u_clipOffset * gl_Position.w;
  v_color = a_color;
  v_worldPosition = position.xyz;
}
`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform vec4 u_color;
uniform vec4 u_clipPlane;
uniform float u_pickMode;
uniform float u_useVertexColor;
uniform float u_useDirectionalShading;
uniform float u_waterShading;
uniform vec3 u_cameraPosition;
uniform sampler2D u_shadowMap;
uniform mat4 u_lightViewProjection;
uniform float u_shadowEnabled;
uniform sampler2D u_baseColorMap;
uniform float u_useBaseColorMap;
uniform vec2 u_uvScale;
uniform sampler2D u_normalMap;
uniform float u_useNormalMap;
uniform float u_normalScale;
uniform float u_metallic;
uniform float u_roughness;
uniform vec3 u_emissive;
uniform sampler2D u_sceneDepth;
uniform float u_useSceneDepth;
uniform mat4 u_projection;
uniform vec2 u_viewport;
uniform vec2 u_clipRange;
uniform float u_aoRadius;
in vec3 v_color;
in vec3 v_worldPosition;
out vec4 outputColor;

// 由屏幕 UV 与深度缓冲重建视空间坐标（与 WebGL2DepthMath 的换算一致）。
vec3 viewPositionAt(vec2 uv, float tanHalfFov, float aspect, float near, float far) {
  float depth = texture(u_sceneDepth, uv).r;
  float ndcZ = depth * 2.0 - 1.0;
  float linear = (2.0 * near * far) / (far + near - ndcZ * (far - near));
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc.x * tanHalfFov * aspect * linear, ndc.y * tanHalfFov * linear, -linear);
}

void main() {
  // Section plane: discard the half-space on the negative side. A zero plane
  // (0,0,0,0) evaluates to 0 and keeps everything, so it doubles as "off".
  if (dot(v_worldPosition, u_clipPlane.xyz) + u_clipPlane.w < 0.0) {
    discard;
  }
  if (u_pickMode > 0.5) {
    outputColor = u_color;
    return;
  }
  vec3 color = u_color.rgb
    * mix(vec3(1.0), v_color, step(0.5, u_useVertexColor));
  vec3 normal = normalize(cross(
    dFdx(v_worldPosition),
    dFdy(v_worldPosition)
  ));
  // Box-projected UVs make the tangent frame analytic: the projection plane's
  // two world axes are the tangents, so no vertex tangent channel is needed.
  vec3 tangent = vec3(0.0);
  vec3 bitangent = vec3(0.0);
  vec3 axisWeight = abs(normal);
  if (axisWeight.x >= axisWeight.y && axisWeight.x >= axisWeight.z) {
    tangent = vec3(0.0, 0.0, -sign(normal.x));
    bitangent = vec3(0.0, 1.0, 0.0);
  } else if (axisWeight.y >= axisWeight.z) {
    tangent = vec3(1.0, 0.0, 0.0);
    bitangent = vec3(0.0, 0.0, sign(normal.y));
  } else {
    tangent = vec3(sign(normal.z), 0.0, 0.0);
    bitangent = vec3(0.0, 1.0, 0.0);
  }
  if (u_useNormalMap > 0.5) {
    vec2 uv = vec2(0.0);
    if (axisWeight.x >= axisWeight.y && axisWeight.x >= axisWeight.z) {
      uv = vec2(-sign(normal.x) * v_worldPosition.z, v_worldPosition.y);
    } else if (axisWeight.y >= axisWeight.z) {
      uv = vec2(v_worldPosition.x, sign(normal.y) * v_worldPosition.z);
    } else {
      uv = vec2(sign(normal.z) * v_worldPosition.x, v_worldPosition.y);
    }
    vec3 sampled = texture(u_normalMap, uv * u_uvScale).xyz * 2.0 - 1.0;
    sampled.xy *= u_normalScale;
    normal = normalize(
      normalize(tangent) * sampled.x
      + normalize(bitangent) * sampled.y
      + normal * sampled.z
    );
  }
  // 主光 + 半球天光。法线由屏幕空间导数求出，朝向与绕序一致：
  // 迎着光的一面吃满直射，背光面只留 35% 的反弹光，暗部不至于糊成一片。
  vec3 lightDirection = normalize(vec3(${LIGHT_DIRECTION.join(', ')}));
  float ndl = dot(normal, lightDirection);
  float key = max(ndl, 0.0) + 0.35 * max(-ndl, 0.0);
  float sky = 0.5 + 0.5 * normal.y;
  // 直射光强度按真实日照给：朝上的面会超过 1，过曝到接近白色是对的，
  // 之前上限压到 1 附近，整个厂区就永远晒不到太阳，看着发闷发暗。
  float shade = clamp(
    ${LIGHTING.ambient} + ${LIGHTING.direct} * key + ${LIGHTING.sky} * sky,
    ${LIGHTING.minimum},
    ${LIGHTING.maximum}
  );
  // Base-colour texture. There is no UV vertex channel: the projection is
  // derived from the surface normal's dominant axis, in metres, which matches
  // the coordinates Studio writes into exported glTF.
  if (u_useBaseColorMap > 0.5) {
    vec2 uv;
    if (axisWeight.x >= axisWeight.y && axisWeight.x >= axisWeight.z) {
      uv = vec2(-sign(normal.x) * v_worldPosition.z, v_worldPosition.y);
    } else if (axisWeight.y >= axisWeight.z) {
      uv = vec2(v_worldPosition.x, sign(normal.y) * v_worldPosition.z);
    } else {
      uv = vec2(sign(normal.z) * v_worldPosition.x, v_worldPosition.y);
    }
    color *= texture(u_baseColorMap, uv * u_uvScale).rgb;
  }
  vec3 lit = color * mix(1.0, shade, u_useDirectionalShading);

  // 表面颗粒：按世界坐标取两层哈希，打散整片纯色带来的塑料感。
  // 幅度控制在 ±6% 内，远了看不出、近了有质感，不会喧宾夺主。
  vec3 fine = floor(v_worldPosition * 4.5);
  vec3 coarse = floor(v_worldPosition * 0.42);
  float grain = fract(sin(dot(fine, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float stain = fract(sin(dot(coarse, vec3(39.346, 11.135, 83.155))) * 24634.6345);
  // 低频污渍负责大面积不匀，高频颗粒负责近看的手感。
  lit *= 0.94 + 0.06 * grain + 0.05 * (stain - 0.5);

  // Liquid surfaces use an analytic Fresnel reflection plus shallow ripple
  // normals. The effect is opt-in through material shading and remains
  // independent from any application-specific material naming.
  if (u_waterShading > 0.5) {
    float waveA = sin(v_worldPosition.x * 1.1
      + sin(v_worldPosition.z * 0.43) * 2.0);
    float waveB = sin(v_worldPosition.z * 1.7
      + v_worldPosition.x * 0.31);
    float waveC = sin((v_worldPosition.x + v_worldPosition.z) * 2.3);
    vec3 rippleNormal = normalize(vec3(
      waveA * 0.09 + waveC * 0.025,
      1.0,
      waveB * 0.09 - waveC * 0.02
    ));
    vec3 viewDirection = normalize(u_cameraPosition - v_worldPosition);
    float facing = clamp(dot(rippleNormal, viewDirection), 0.0, 1.0);
    float fresnel = pow(1.0 - facing, 2.4);
    vec3 reflectedSky = vec3(0.22, 0.34, 0.36);
    vec3 surfaceColor = mix(
      color,
      reflectedSky,
      0.30 + 0.30 * fresnel
    );
    surfaceColor *= 0.92 + 0.09 * waveA + 0.05 * waveB;
    vec3 halfDirection = normalize(lightDirection + viewDirection);
    float sparkle = pow(
      max(dot(rippleNormal, halfDirection), 0.0),
      36.0
    );
    lit = mix(lit, surfaceColor * shade, 0.92)
      + vec3(0.42, 0.52, 0.54) * sparkle * 0.55;
  }

  // 屏幕空间遮蔽：先把深度还原成视空间坐标，再按**世界半径**取样。
  // 直接比较 NDC 深度差表达不了"1 米"这种量（远端千分之几就跨了十米），
  // 这也是 SPEC-007 前三轮失败的原因。
  if (u_useSceneDepth > 0.5) {
    vec2 screenUv = gl_FragCoord.xy / u_viewport;
    float tanHalfFov = 1.0 / u_projection[1][1];
    float aspect = u_projection[1][1] / u_projection[0][0];
    float near = u_clipRange.x;
    float far = u_clipRange.y;

    vec3 centre = viewPositionAt(screenUv, tanHalfFov, aspect, near, far);
    // 法线由视空间位置的屏幕导数求出：几何没有法线属性，也不需要。
    vec3 viewNormal = normalize(cross(dFdx(centre), dFdy(centre)));
    float centreDepth = -centre.z;

    // 世界半径换算成像素半径：越远越小，近景远景才都有意义。
    float pixelRadius = (u_aoRadius / max(1e-4, centreDepth * tanHalfFov)) * (u_viewport.y * 0.5);
    float rotation = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;

    float occlusion = 0.0;
    for (int i = 0; i < 8; i++) {
      float angle = rotation + float(i) * 0.7853982;
      float scale = mix(0.35, 1.0, float(i % 3) / 2.0);
      vec2 offset = vec2(cos(angle), sin(angle)) * pixelRadius * scale;
      vec2 sampleUv = screenUv + offset / u_viewport;
      if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) continue;
      vec3 samplePoint = viewPositionAt(sampleUv, tanHalfFov, aspect, near, far);
      vec3 delta = samplePoint - centre;
      float distance = length(delta);
      // 只在半球内、且距离在半径内的样本算遮挡。
      if (distance > 0.0001 && distance < u_aoRadius
          && dot(delta, viewNormal) > 0.15 * distance) {
        occlusion += 1.0;
      }
    }
    occlusion /= 8.0;
    lit *= 1.0 - occlusion * 0.35;
  }

  // 金属没有漫反射：它的颜色全部来自反射。先把漫反射按 metallic 收掉，
  // 再用反射项补回来，否则金属和塑料在同一个太阳下只是"颜色不同"。
  {
    vec3 viewDirection = normalize(u_cameraPosition - v_worldPosition);
    vec3 halfVector = normalize(lightDirection + viewDirection);
    float metallic = clamp(u_metallic, 0.0, 1.0);
    float roughness = clamp(u_roughness, 0.04, 1.0);
    vec3 reflectance = mix(vec3(0.04), color, metallic);

    float diffuseGain = 1.0 - metallic * 0.85;
    float facing = max(dot(normal, lightDirection), 0.0);

    // 高光：粗糙度决定叶瓣宽度与强度（指数 96 → 4，增益 1.0 → 0.18）。
    float shininess = mix(96.0, 4.0, roughness * roughness);
    float highlight = pow(max(dot(normal, halfVector), 0.0), shininess);
    float specularGain = mix(1.0, 0.18, roughness);

    // 环境反射：按反射方向取天空/地面色，掠射角再叠一层 Fresnel。
    // 只看法线的话，平躺的金属会和立着的金属一个颜色——现实里前者反射天顶、
    // 后者反射地平线，恰恰是金属最容易辨认的特征。
    vec3 reflected = reflect(-viewDirection, normal);
    float skyMix = clamp(reflected.y * 0.9 + 0.35, 0.0, 1.0);
    vec3 skyColor = mix(vec3(0.15, 0.16, 0.17), vec3(0.62, 0.72, 0.84), skyMix);
    float fresnel = pow(1.0 - clamp(dot(normal, viewDirection), 0.0, 1.0), 4.0);
    float envGain = (0.22 + 0.55 * fresnel) * mix(0.4, 1.0, metallic);

    float litScale = diffuseGain;
    lit *= litScale;
    lit += reflectance * (highlight * specularGain * mix(0.35, 1.0, facing)
      + skyColor * envGain);
    lit += u_emissive;
  }

  // 阴影：把世界坐标投到光源空间，与深度图比较。取 3×3 采样的平均做轻微柔化。
  if (u_shadowEnabled > 0.5) {
    vec4 lightSpace = u_lightViewProjection * vec4(v_worldPosition, 1.0);
    vec3 projected = lightSpace.xyz / max(lightSpace.w, 1e-5) * 0.5 + 0.5;
    if (projected.x > 0.002 && projected.x < 0.998
        && projected.y > 0.002 && projected.y < 0.998
        && projected.z > 0.0 && projected.z < 1.0) {
      // 斜面对深度的误差最敏感，按 N·L 放大偏移：
      // 固定小偏移在这套 960 米深的光锥里等于几米，墙面会自己把自己遮住（阴影痤疮）。
      float ndlShadow = max(dot(normal, lightDirection), 0.0);
      // 偏移按光锥深度（近 -260 / 远 700，共 960 米）换算：
      // 0.006 对应约 5.8 米，正好压掉深度图与逐像素投影之间的系统误差，
      // 同时还能留住十几米高构筑物的投影。
      float bias = 0.0015 + 0.0025 * (1.0 - ndlShadow);
      float lit2 = 0.0;
      vec2 texel = vec2(1.0 / 2048.0);
      for (int dx = -1; dx <= 1; dx++) {
        for (int dy = -1; dy <= 1; dy++) {
          float depth = texture(u_shadowMap, projected.xy + vec2(float(dx), float(dy)) * texel).r;
          lit2 += projected.z - bias > depth ? 0.0 : 1.0;
        }
      }
      lit *= mix(0.68, 1.0, lit2 / 9.0);

    }
  }
  // 画布按 sRGB 解释写入值，而材质是线性空间的分量，必须做一次编码。
  // 不做的话线性 0.017 会当作 sRGB 0.017 显示，深色材质全部塌成黑色。
  outputColor = vec4(
    pow(max(lit, vec3(0.0)), vec3(1.0 / 2.2)),
    u_color.a
  );
}
`;

/**
 * Mirror of the shader's specular curve, exported so the response can be tested
 * without a GPU: smoother surfaces get a tighter, stronger highlight.
 */
export function specularShininess(roughness: number): number {
  const clamped = Math.min(1, Math.max(0.04, roughness));
  return 180 + (8 - 180) * clamped * clamped;
}

export function specularGain(roughness: number): number {
  const clamped = Math.min(1, Math.max(0.04, roughness));
  return 0.9 + (0.08 - 0.9) * clamped;
}

/** Metals tint their highlight with the base colour; dielectrics stay neutral. */
export function specularReflectance(
  metallic: number,
  color: readonly [number, number, number],
): [number, number, number] {
  const t = Math.min(1, Math.max(0, metallic));
  return [
    0.04 + (color[0] - 0.04) * t,
    0.04 + (color[1] - 0.04) * t,
    0.04 + (color[2] - 0.04) * t,
  ];
}

export class WebGL2Program {
  static readonly POSITION_ATTRIBUTE = 0;
  static readonly COLOR_ATTRIBUTE = 1;
  static readonly INSTANCE_MATRIX_ATTRIBUTE = 3;
  static readonly INSTANCE_SEMANTIC_ATTRIBUTE = 7;
  readonly program: WebGLProgram;
  private readonly matrixLocation: WebGLUniformLocation;
  private readonly colorLocation: WebGLUniformLocation;
  private readonly clipOffsetLocation: WebGLUniformLocation;
  private readonly vertexColorLocation: WebGLUniformLocation;
  private readonly directionalShadingLocation: WebGLUniformLocation;
  private readonly waterShadingLocation: WebGLUniformLocation;
  private readonly cameraPositionLocation: WebGLUniformLocation;
  private readonly shadowMapLocation: WebGLUniformLocation | null;
  private readonly lightMatrixLocation: WebGLUniformLocation | null;
  private readonly shadowEnabledLocation: WebGLUniformLocation | null;
  private readonly instancingLocation: WebGLUniformLocation;
  private readonly pickModeLocation: WebGLUniformLocation;
  private readonly clipPlaneLocation: WebGLUniformLocation | null;
  private readonly baseColorMapLocation: WebGLUniformLocation | null;
  private readonly useBaseColorMapLocation: WebGLUniformLocation | null;
  private readonly uvScaleLocation: WebGLUniformLocation | null;
  private readonly normalMapLocation: WebGLUniformLocation | null;
  private readonly useNormalMapLocation: WebGLUniformLocation | null;
  private readonly normalScaleLocation: WebGLUniformLocation | null;
  private readonly metallicLocation: WebGLUniformLocation | null;
  private readonly roughnessLocation: WebGLUniformLocation | null;
  private readonly emissiveLocation: WebGLUniformLocation | null;
  private readonly sceneDepthLocation: WebGLUniformLocation | null;
  private readonly useSceneDepthLocation: WebGLUniformLocation | null;
  private readonly projectionLocation: WebGLUniformLocation | null;
  private readonly viewportLocation: WebGLUniformLocation | null;
  private readonly clipRangeLocation: WebGLUniformLocation | null;
  private readonly aoRadiusLocation: WebGLUniformLocation | null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    const program = this.createProgram(VERTEX_SOURCE, FRAGMENT_SOURCE);
    const matrixLocation = gl.getUniformLocation(program, 'u_worldViewProjection');
    const colorLocation = gl.getUniformLocation(program, 'u_color');
    const clipOffsetLocation = gl.getUniformLocation(program, 'u_clipOffset');
    const vertexColorLocation = gl.getUniformLocation(program, 'u_useVertexColor');
    const directionalShadingLocation = gl.getUniformLocation(
      program,
      'u_useDirectionalShading',
    );
    const waterShadingLocation = gl.getUniformLocation(program, 'u_waterShading');
    const cameraPositionLocation = gl.getUniformLocation(program, 'u_cameraPosition');
    const instancingLocation = gl.getUniformLocation(program, 'u_useInstancing');
    const pickModeLocation = gl.getUniformLocation(program, 'u_pickMode');
    const clipPlaneLocation = gl.getUniformLocation(program, 'u_clipPlane');
    const baseColorMapLocation = gl.getUniformLocation(program, 'u_baseColorMap');
    const useBaseColorMapLocation = gl.getUniformLocation(program, 'u_useBaseColorMap');
    const uvScaleLocation = gl.getUniformLocation(program, 'u_uvScale');
    const normalMapLocation = gl.getUniformLocation(program, 'u_normalMap');
    const useNormalMapLocation = gl.getUniformLocation(program, 'u_useNormalMap');
    const normalScaleLocation = gl.getUniformLocation(program, 'u_normalScale');
    const metallicLocation = gl.getUniformLocation(program, 'u_metallic');
    const roughnessLocation = gl.getUniformLocation(program, 'u_roughness');
    const emissiveLocation = gl.getUniformLocation(program, 'u_emissive');
    const sceneDepthLocation = gl.getUniformLocation(program, 'u_sceneDepth');
    const useSceneDepthLocation = gl.getUniformLocation(program, 'u_useSceneDepth');
    const projectionLocation = gl.getUniformLocation(program, 'u_projection');
    const viewportLocation = gl.getUniformLocation(program, 'u_viewport');
    const clipRangeLocation = gl.getUniformLocation(program, 'u_clipRange');
    const aoRadiusLocation = gl.getUniformLocation(program, 'u_aoRadius');
    const shadowMapLocation = gl.getUniformLocation(program, 'u_shadowMap');
    const lightMatrixLocation = gl.getUniformLocation(program, 'u_lightViewProjection');
    const shadowEnabledLocation = gl.getUniformLocation(program, 'u_shadowEnabled');
    if (
      !matrixLocation
      || !colorLocation
      || !clipOffsetLocation
      || !vertexColorLocation
      || !directionalShadingLocation
      || !waterShadingLocation
      || !cameraPositionLocation
      || !instancingLocation
      || !pickModeLocation
    ) {
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
    this.vertexColorLocation = vertexColorLocation;
    this.directionalShadingLocation = directionalShadingLocation;
    this.waterShadingLocation = waterShadingLocation;
    this.cameraPositionLocation = cameraPositionLocation;
    this.shadowMapLocation = shadowMapLocation;
    this.lightMatrixLocation = lightMatrixLocation;
    this.shadowEnabledLocation = shadowEnabledLocation;
    this.shadowMapLocation = shadowMapLocation;
    this.lightMatrixLocation = lightMatrixLocation;
    this.shadowEnabledLocation = shadowEnabledLocation;
    this.instancingLocation = instancingLocation;
    this.pickModeLocation = pickModeLocation;
    this.clipPlaneLocation = clipPlaneLocation;
    this.baseColorMapLocation = baseColorMapLocation;
    this.useBaseColorMapLocation = useBaseColorMapLocation;
    this.uvScaleLocation = uvScaleLocation;
    this.normalMapLocation = normalMapLocation;
    this.useNormalMapLocation = useNormalMapLocation;
    this.normalScaleLocation = normalScaleLocation;
    this.metallicLocation = metallicLocation;
    this.roughnessLocation = roughnessLocation;
    this.emissiveLocation = emissiveLocation;
    this.sceneDepthLocation = sceneDepthLocation;
    this.useSceneDepthLocation = useSceneDepthLocation;
    this.projectionLocation = projectionLocation;
    this.viewportLocation = viewportLocation;
    this.clipRangeLocation = clipRangeLocation;
    this.aoRadiusLocation = aoRadiusLocation;
    if (sceneDepthLocation) {
      gl.useProgram(program);
      gl.uniform1i(sceneDepthLocation, 2);
    }
    if (useSceneDepthLocation) {
      gl.useProgram(program);
      gl.uniform1f(useSceneDepthLocation, 0);
    }
    if (aoRadiusLocation) {
      gl.useProgram(program);
      gl.uniform1f(aoRadiusLocation, 2.5);
    }
    if (emissiveLocation) {
      gl.useProgram(program);
      gl.uniform3f(emissiveLocation, 0, 0, 0);
    }
    if (normalMapLocation) {
      gl.useProgram(program);
      gl.uniform1i(normalMapLocation, 1);
    }
    if (useNormalMapLocation) {
      gl.useProgram(program);
      gl.uniform1f(useNormalMapLocation, 0);
    }
    if (baseColorMapLocation) {
      gl.useProgram(program);
      gl.uniform1i(baseColorMapLocation, 0);
    }
    if (useBaseColorMapLocation) {
      gl.useProgram(program);
      gl.uniform1f(useBaseColorMapLocation, 0);
    }
    if (clipPlaneLocation) {
      gl.useProgram(program);
      gl.uniform4f(clipPlaneLocation, 0, 0, 0, 0);
    }
    if (shadowMapLocation) {
      gl.useProgram(program);
      gl.uniform1i(shadowMapLocation, 3);
    }
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

  /**
   * Bind a base-colour texture to unit 0 and enable sampling. Passing `null`
   * restores flat shading without touching the bound texture.
   */
  setBaseColorMap(texture: WebGLTexture | null, scale: readonly [number, number]): void {
    const gl = this.gl;
    if (!this.useBaseColorMapLocation) return;
    if (!texture) {
      gl.uniform1f(this.useBaseColorMapLocation, 0);
      return;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1f(this.useBaseColorMapLocation, 1);
    if (this.uvScaleLocation) {
      gl.uniform2f(this.uvScaleLocation, scale[0], scale[1]);
    }
  }

  /** Bind a tangent-space normal map to unit 1; `null` disables perturbation. */
  setNormalMap(texture: WebGLTexture | null, strength: number): void {
    const gl = this.gl;
    if (!this.useNormalMapLocation) return;
    if (!texture) {
      gl.uniform1f(this.useNormalMapLocation, 0);
      return;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1f(this.useNormalMapLocation, 1);
    if (this.normalScaleLocation) {
      gl.uniform1f(this.normalScaleLocation, strength);
    }
  }

  /** Metallic-roughness factors plus emission for the current draw. */
  setSurface(
    metallic: number,
    roughness: number,
    emissive: readonly [number, number, number] | undefined,
  ): void {
    const gl = this.gl;
    if (this.metallicLocation) gl.uniform1f(this.metallicLocation, metallic);
    if (this.roughnessLocation) gl.uniform1f(this.roughnessLocation, roughness);
    if (this.emissiveLocation) {
      if (emissive) gl.uniform3f(this.emissiveLocation, emissive[0], emissive[1], emissive[2]);
      else gl.uniform3f(this.emissiveLocation, 0, 0, 0);
    }
  }

  /** 绑定相机深度纹理（unit 2）并传入重建视空间所需的相机参数。 */
  setSceneDepth(
    texture: WebGLTexture | null,
    projection: { readonly elements: Float32Array } | null,
    near: number,
    far: number,
    deviceWidth: number,
    deviceHeight: number,
  ): void {
    const gl = this.gl;
    if (!this.useSceneDepthLocation) return;
    if (!texture || !projection) {
      gl.uniform1f(this.useSceneDepthLocation, 0);
      return;
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1f(this.useSceneDepthLocation, 1);
    if (this.projectionLocation) {
      gl.uniformMatrix4fv(this.projectionLocation, false, projection.elements);
    }
    if (this.viewportLocation) {
      gl.uniform2f(this.viewportLocation, deviceWidth, deviceHeight);
    }
    if (this.clipRangeLocation) {
      gl.uniform2f(this.clipRangeLocation, near, far);
    }
  }

  setClipOffset(x: number, y: number): void {
    this.gl.uniform2f(this.clipOffsetLocation, x, y);
  }

  setClipPlane(plane: readonly [number, number, number, number]): void {
    if (!this.clipPlaneLocation) return;
    this.gl.uniform4f(this.clipPlaneLocation, plane[0], plane[1], plane[2], plane[3]);
  }

  setVertexColors(enabled: boolean): void {
    this.gl.uniform1f(this.vertexColorLocation, enabled ? 1 : 0);
  }


  /** 绑定阴影贴图与光源矩阵；关闭时着色器跳过采样。 */
  setShadow(
    enabled: boolean,
    texture: WebGLTexture | null,
    matrix: Float32Array | null,
    unit = 3,
  ): void {
    const gl = this.gl;
    gl.uniform1f(this.shadowEnabledLocation, enabled && texture && matrix ? 1 : 0);
    if (!enabled || !texture || !matrix) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (this.shadowMapLocation) gl.uniform1i(this.shadowMapLocation, unit);
    if (this.lightMatrixLocation) gl.uniformMatrix4fv(this.lightMatrixLocation, false, matrix);
    gl.activeTexture(gl.TEXTURE0);
  }

  setDirectionalShading(enabled: boolean): void {
    this.gl.uniform1f(
      this.directionalShadingLocation,
      enabled ? 1 : 0,
    );
  }

  setWaterShading(enabled: boolean): void {
    this.gl.uniform1f(this.waterShadingLocation, enabled ? 1 : 0);
  }

  setCameraPosition(position: readonly [number, number, number]): void {
    this.gl.uniform3f(this.cameraPositionLocation, ...position);
  }

  setInstancing(enabled: boolean): void {
    this.gl.uniform1f(this.instancingLocation, enabled ? 1 : 0);
  }

  setPickMode(enabled: boolean): void {
    this.gl.uniform1f(this.pickModeLocation, enabled ? 1 : 0);
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
    gl.bindAttribLocation(program, WebGL2Program.COLOR_ATTRIBUTE, 'a_color');
    for (let column = 0; column < 4; column += 1) {
      gl.bindAttribLocation(
        program,
        WebGL2Program.INSTANCE_MATRIX_ATTRIBUTE + column,
        `a_instanceColumn${column}`,
      );
    }
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
