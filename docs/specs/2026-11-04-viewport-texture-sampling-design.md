# ICE3 视口贴图采样设计

> Document ID: ICE3-ENG-SPEC-006
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## 1. 背景

WebGL2 Renderer 到 SPEC-004 为止只有纯色材质：`ICEBasicMaterial` 携带
`color`/`edgeColor`/`shading`，片元着色器在世界坐标上做解析光照与颗粒噪声。几何没有 UV
通道（法线由屏幕空间导数求出），因此"贴图"既没有采样坐标，也没有纹理管线。

Studio 已经能把 PBR 表面与贴图引用写进 glTF，导出到 Blender / three.js 可用；缺的是
视口里自己**看得见**。本设计补这一环。

## 2. 目标与非目标

目标：

- 材质可选携带 base-colour 贴图，视口按贴图着色；
- 不引入 UV 顶点通道（避免牵动顶点格式、GPU 内核与所有导入路径）；
- 采样坐标与 Studio 导出的 glTF UV 一致，视口与离线渲染同一套纹素；
- 纹理异步加载不阻塞帧循环，加载完成后自动补一帧。

非目标：法线贴图、ORM 通道打包、贴图数组/mipmap 手工控制、WebGPU 后端支援（WebGPU
是实验性选项，本轮只在 WebGL2 上实现）、从资产 profile 里读取贴图（见 §6）。

## 3. 采样坐标

`boxProjectedUv(position, normal, scale)`：按法线主导轴把世界坐标投影到平面。

| 主导轴 | UV |
|---|---|
| ±X | `(∓z, y)` |
| ±Y | `(x, ±z)` |
| ±Z | `(±x, y)` |
| 退化法线 | `(x, y)` |

与 `studio-core::geometry::uv::box_projected_uvs` 完全一致，所以同一个面在视口和导出的
glTF 里落在同一片纹素上。单位是米：一个 UV 单位 = 一米表面，纹素密度与零件尺寸
无关；平铺由材质的 `map.scale` 决定，不写进几何。

着色器里的法线来自 `dFdx/dFdy(worldPosition)`，是逐像素的真实朝向，因此旋转、布尔结果、
导入网格都能拿到正确的投影面——这正是选择"从表面推导"而不是"烘焙进顶点"的原因。

## 4. 纹理管线

| 层 | 职责 |
|---|---|
| `ICEBasicMaterial.map` | `{ url, scale? }`，材质的贴图引用 |
| `WebGL2TextureCache` | URL → `WebGLTexture`，异步 `fetch` + `createImageBitmap`，REPEAT + mipmap |
| `WebGL2Program.setBaseColorMap` | 绑定 unit 0，设置 `u_useBaseColorMap` 与 `u_uvScale` |
| `WebGL2RendererBackend.applyMaterial` | 每次绘制前统一绑定颜色 + 贴图，避免批量/单体两条路径漂移 |

三条行为约定：

1. **异步不阻塞**：首次请求返回 `null`，该帧按纯色绘制；上传完成后通过
   `initialize({ onUploadReady })` 通知运行时 `requestRender('upload-ready')` 补一帧。
   引擎按需渲染，没有这个回调贴图要等用户动一下才出现。
2. **失败不重试**：加载失败的 URL 记 `failed`，不会每帧重试打爆网络。
3. **边线不采样**：边线叠加层是线稿，`applyEdgeMaterial` 显式关闭贴图。

## 5. 验证

- `WebGL2Uv.test.ts`：三轴投影、正负面不镜像、主导轴平局、退化法线、双向缩放；
- `WebGL2TextureCache.test.ts`（注入假 GL 与假 loader）：同 URL 只加载一次、pending →
  ready 转换、上传回调触发、失败不重试、dispose 释放全部纹理、dispose 后才到达的上传
  被丢弃。

## 6. 资产 profile

Prepared GLB profile 已放开 `textures`/`images`/`samplers`，但只接受**相对路径**的
外部图片：profile 只保留一个 buffer，把图片塞进 `bufferView` 会让它藏进二进制，渲染器
既拿不到可寻址的字节，资产也不再可流式。绝对路径、`..`、`://` 与 `bufferView` 形态
一律报 `ICE3_ASSET_UNSUPPORTED_FEATURE`。

读取器把 `baseColorTexture.index → textures[].source → images[].uri` 解析成
`ICEPreparedMaterial.map`，`KHR_texture_transform.scale` 作为平铺倍率一并带出。

尚未完成（后续）：分区打包给每个 tile 复制 images/textures 数组并落盘图片文件，以及
Studio 侧把这些文件用静态路由供出去。

## 7. 代码落点

| 文件 | 变更 |
|---|---|
| `packages/renderer/src/WebGL2Uv.ts` | 盒投影纯函数 |
| `packages/renderer/src/WebGL2TextureCache.ts` | URL → 纹理缓存与异步加载 |
| `packages/renderer/src/WebGL2Program.ts` | 着色器贴图分支、`setBaseColorMap` |
| `packages/renderer/src/WebGL2RendererBackend.ts` | 纹理缓存生命周期、`applyMaterial` |
| `packages/renderer/src/types.ts` | `initialize({ onUploadReady })` |
| `packages/runtime/src/ICE3.ts` | 上传完成后请求一帧 |
| `packages/core/src/material/ICEBasicMaterial.ts` | `map` 字段 |
| `packages/runtime/src/asset/ICEAssetSceneBuilder.ts` | prepared 材质透传 `map` |
