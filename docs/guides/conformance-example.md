# 跨格式 Conformance 示例

> Document ID: ICE3-ENG-GUIDE-004
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

`examples/m2` 加载 Toolchain 生成的七种 synthetic Prepared GLB，并在同一 Runtime 中
验证 Profile、Geometry、Node identity 和 GPU 画面。

## 启动

```bash
nvm use
npm install
npm run dev:example:m2
```

打开 `http://127.0.0.1:8115/`。可使用 `?format=gltf|step|ifc|fbx|usd|obj|jt` 直接
打开指定格式，也可点击左侧格式按钮切换。

资产由相邻 `ice3-toolchain` 仓库重新生成：

```bash
cd ../ice3-toolchain
nvm use
npm install
npm run build:conformance
```

## 边界

- Browser 只读取 `examples/m2/assets/conformance/*.glb`。
- Source parsing 和 conversion 位于 Toolchain。
- JT case 验证外部 converter contract；真实 JT parsing 需要部署环境提供 converter。
- 页面检查 Prepared contract、预期 Node 名称、Geometry 统计和实际 WebGL 像素输出。

## 自动验证

```bash
npx playwright test tests/e2e/m2-conformance.spec.ts --project=chromium
```
