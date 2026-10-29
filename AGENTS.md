# ICE3 Engine 仓库规则

> Document ID: ICE3-ENG-POL-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## 架构

- 公开消费方只从 `ice3` 导入。
- 依赖方向为 `@ice3/core` ← `@ice3/assets` ← `@ice3/runtime` ← `ice3`，同时 `@ice3/core` ← `@ice3/renderer` 为 runtime 提供渲染能力。
- `@ice3/core` 必须独立于 DOM、Canvas、GPU 和同级 package。
- Renderer 实现不得通过公开 API 泄漏 GPU objects。
- Runtime 只接受 ICE3 Prepared GLB Profile Asset；source format parsing 和重型 Geometry conversion 留在 `ice3-toolchain`。
- 应用、脚本、测试、编辑器和外部 adapter 使用同一套公开 semantic API。
- Runtime 以 Geometry 为先；Material 和 lighting 保持基础能力。
- Selection、LOD、camera、Canvas layers 和 input routing 必须保持稳定 Scene identity。

## Asset 边界

- Runtime fixtures 和 examples 只包含虚构、已脱敏或明确可分发的 Asset。
- 不得加入客户模型、转换片段、粗模、preview 或提取 textures。
- Prepared Asset 的兼容性和 budget 定义遵循 `ice3-doc` 中的权威 contract。
- Prepared GLB profile 变更必须同步更新 `ice3-toolchain` 生成逻辑并执行一致性验证。

## 交付

- 在功能分支开发，完整验证门禁通过后才可合入 `main`。
- 每项行为变化先写失败测试，最终以完整 suite 全绿结束。
- 没有明确设计裁决时不得增加 runtime dependency。
- M1 不包含通用 format compatibility、animation、textures、LOD 和工业业务功能。
- 使用 `.nvmrc` 指定的 Node.js 24.22.1 LTS；验证门禁使用同一版本。

## 提交身份

- 本仓库所有 Git author 和 committer 名称必须为 `damoqiongqiu`。
- 提交、合并或推送前核对配置名称与提交记录。

## 命名与法律边界

- 文档、代码、注释、标识、链接或示例中不得出现竞品、厂商或第三方产品名称。
- 不得将其品牌词、大小写变体、缩写或拼接形式用作 package、目录、类或变量名。
- 技术比较只使用中性类别描述。
- 不得链接会暴露禁止名称的外部调研资料。
- 每次提交和发布前审计名称。

## 验证

```bash
npm run verify
npm pack --workspaces --dry-run
```

## 关联文档

- `ICE3-ENG-IDX-001` — [文档索引](docs/README.md)
- `ICE3-ENG-ARC-001` — [Engine 架构](docs/architecture.md)
