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

const engine = new ICE3().init(host);
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

完整文档和相关工具见
[Engine 文档](https://github.com/ice-3d/ice3-engine/blob/main/README.md)。

本项目采用 MIT License。
