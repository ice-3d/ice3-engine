# ICE3

> Document ID: ICE3-ENG-RM-002
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

ICE3 是面向工业场景的浏览器 3D Runtime。公开代码通过单向 facade 暴露 Scene、
Geometry、Camera、Asset 和 Tileset API。

## 安装

```bash
npm install ice3
```

## 最小使用

```ts
import {
  ICE3,
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEPerspectiveCamera,
  ICEScene,
} from 'ice3';

const host = document.querySelector<HTMLElement>('#stage');
if (!host) throw new Error('stage element is required');

const engine = await new ICE3({ renderer: 'auto' }).initAsync(host);
const scene = new ICEScene({ id: 'main' });
const camera = new ICEPerspectiveCamera({
  id: 'camera',
  position: [3, 2, 4],
  target: [0, 0, 0],
});

scene.addChild(new ICEMesh({
  id: 'sample',
  geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
  material: new ICEBasicMaterial({ color: '#2f81f7' }),
}));

engine.setScene(scene).setCamera(camera).start();
```

`initAsync()` 优先选择通过探测的 WebGPU，无法稳定初始化时回退 WebGL2。可用
`renderer: 'webgpu'` 或 `renderer: 'webgl2'` 固定后端。拾取使用
`await engine.pick(point)`。

完整文档和相关工具见
[Engine 文档](https://github.com/ice-3d/ice3-engine/blob/main/README.md)。

工业模型接入 Runtime 前，使用配套的
[ICE3 Toolchain](https://github.com/ice-3d/ice3-toolchain/blob/main/README.md)
进行离线格式转换、验证、切分、LOD 和 Tileset 发布。功能与格式支持见
[Toolchain 功能指南](https://github.com/ice-3d/ice3-toolchain/blob/main/docs/guides/capabilities.md)。

本项目采用 MIT License。
