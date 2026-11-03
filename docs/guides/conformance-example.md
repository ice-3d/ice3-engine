# glTF Prepared Conformance 示例

> Document ID: ICE3-ENG-GUIDE-004
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

`examples/m2` 当前加载 Manifest 登记的标准 Prepared GLB，并验证 Profile、Geometry、
Node identity 和 GPU 画面。仓库目前只保留 `gltf` case；Manifest 是 case 的权威来源，
文档和测试不得假设其它 source format 已有 checked-in fixture。

## 1. 启动

```bash
nvm use
npm install
npm run dev:example:m2
```

打开 `http://127.0.0.1:8115/`。使用 `?format=gltf` 可显式选择当前 case。

如需重新生成 checked-in conformance Asset，使用 Studio 的当前 Source Import 和
Prepare 入口：

```bash
cd ../ice3-studio
cargo run -p studio-cli -- build path/to/source.glb \
  --output ../ice3-engine/examples/m2/assets/conformance/gltf.glb \
  --asset-id prepared-cube \
  --force
```

具体 source、asset ID、expected Node 名称和 warnings 必须与
`examples/m2/assets/conformance/manifest.json` 及 E2E 断言一致。不得从已退役
Toolchain 文档复制旧命令或七格式假设。

## 2. 边界

- Browser 只读取 `examples/m2/assets/conformance/*.glb`。
- Source parsing、Prepare 和 conversion 由 Studio 离线完成。
- JT 的 host-owned converter 契约属于 Studio Source Import；Engine 只读取其结果。
- 页面检查 Prepared contract、预期 Node 名称、Geometry 统计和实际 WebGL 像素输出。

## 3. 自动验证

```bash
npx playwright test tests/e2e/m2-conformance.spec.ts --project=chromium
```
