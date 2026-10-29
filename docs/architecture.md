# ICE3 Engine 架构

> Document ID: ICE3-ENG-ARC-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## 系统上下文

`ice3-engine` 消费 Prepared Asset 和应用 Scene intent。它不解析 source format、不负责
业务规则，也不依赖 Agent Console。

```text
Prepared GLB / Tileset
          ↓
   @ice3/assets reader
          ↓
    @ice3/runtime scene
          ↓
 @ice3/renderer WebGL2 / WebGPU
          ↓
       browser GPU

consumer → ice3 public facade → internal packages
```

## Package 职责

| Package | 职责 |
|---|---|
| `@ice3/core` | Math、Scene graph、Geometry、Material、Camera、Event、Serialization 和 Diagnostic；不依赖 DOM 或 GPU |
| `@ice3/assets` | Prepared GLB 和 Tileset parsing、profile validation 及不可变 snapshot |
| `@ice3/renderer` | WebGPU/WebGL2 backend、能力探测、frame execution、Geometry residency、instancing、render batch 和 picking |
| `@ice3/runtime` | Engine lifecycle、2D layer、input routing、Asset handle、Tileset scheduling 和 LOD |
| `ice3` | 供应用使用的公开 package facade |

The dependency direction is:

```text
@ice3/core ← @ice3/assets ← @ice3/runtime → ice3
     ↑                          ↓
@ice3/renderer ────────────────┘
```

外部消费方不得导入另一个 package 的私有 source path。

## 帧生命周期

1. `ICE3` 创建 Scene、2D layer canvas，并初始化 Renderer。
2. Input 从最上层 interactive layer 解析，再路由到 2D、control 或 3D picking。
3. Camera 和 Scene 变化请求 render frame。
4. Renderer 收集 visible Mesh 或 prepared batch，并执行受 byte budget 约束的 GPU
   upload 或 eviction。
5. 需要 exact picking 时，Pick request 渲染临时 semantic identity frame。
6. 呈现 visible frame、更新 Diagnostic，并可开始 idle work。

`start()` 幂等且按需运行。`destroy()` 释放 listener、layer、frame request、Scene
ownership 和 GPU resource。

## Asset 流程

1. `ICETilesetLoader` 读取 Tileset，并校验受支持的 local Cartesian 子集。
2. Scheduler 根据 camera Bounds 和 screen-space error 选择 visible、prefetch 和
   retained Tile。
3. `@ice3/assets` 解析每个 Prepared GLB 并校验 profile。
4. Scene builder 实例化 semantic Node、indexed Geometry、Material 和 Selection identity。
5. Runtime 原子提交完整 Tile chunk；replacement content 就绪前保持旧 coverage 可见。
6. Renderer 在 frame 和 byte budget 下上传 resident Geometry。

## 2D 与 3D composition

Runtime 使用一套有序 layer model。Screen-space 和 world-anchored 2D layer 与 3D
content 共享 pointer、wheel、focus、resize 和 disposal 行为。命中的 layer 按声明
policy 阻止或透传 event。

## 失败行为

- 不支持的 Asset 在 Scene publication 前产生稳定 Diagnostic code。
- Tile 失败时已完成 partition 继续保持交互。
- LOD transition 失败时保留最后一次完整 representation。
- GPU upload 失败时上一个 generation 保持 active。
- WebGL context 丢失时暂停渲染，直到 restoration 完成。
- Disposal 幂等，并移除 pending work 和 resource。

## 关联文档

- `ICE3-ENG-RM-001` — [README](../README.md)
- `ICE3-ENG-API-001` — [M0 公开 API](api/m0.md)
- `ICE3-ENG-API-002` — [M1 Asset API](api/m1.md)
- `ICE3-ENG-REF-001` — [Diagnostic](diagnostics.md)
- `ICE3-ENG-ADR-001` — [公开 facade 与 package 边界](decisions/0001-public-facade-and-package-boundaries.md)
- `ICE3-DOC-ARC-001` — [ICE3 家族架构](https://github.com/ice-3d/ice3-doc/blob/main/docs/architecture.md)
