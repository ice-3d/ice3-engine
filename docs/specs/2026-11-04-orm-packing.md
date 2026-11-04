# ORM 打包：遮蔽、粗糙度、金属度一张图

> Document ID: ICE3-ENG-SPEC-009
>
> Status: Implemented
>
> Owner: ICE3 Engine maintainers

## 1. 为什么打包

金属的粗糙度不能是常量：真实的钢构有拉丝、有锈斑，整根梁一个高光指数看起来就像塑料。
但把遮蔽、粗糙度、金属度拆成三张贴图，代价是三倍的采样与三倍的内存，而它们的分辨率
需求本来就一样。

glTF 的约定正好允许一份数据三个通道：R = 环境遮蔽，G = 粗糙度，B = 金属度
（`occlusionTexture` 与 `pbrMetallicRoughness.metallicRoughnessTexture` 共用一张图）。

## 2. 写入侧（Studio）

`MaterialSurface.ormTexture` 是相对路径，和底色、法线贴图同一套规则（拒绝绝对路径、
`..`、`://`）。导出时同一张图写进两个槽位：

```json
{
  "pbrMetallicRoughness": {
    "metallicFactor": 0.8,
    "roughnessFactor": 0.4,
    "metallicRoughnessTexture": { "index": 3, "extensions": { "KHR_texture_transform": { "scale": [0.4, 0.4] } } }
  },
  "occlusionTexture": { "index": 3, "extensions": { "KHR_texture_transform": { "scale": [0.4, 0.4] } } }
}
```

两个槽位指向同一个 image index，只多两个 JSON 对象，不复制图片。`metallicFactor` /
`roughnessFactor` 仍然写进材质——最终值是**贴图样本 × 因子**，和 glTF 语义一致。

prepared profile 的索引范围校验同步放开这两个指针（原来只查 `baseColorTexture` 与
`normalTexture`，ORm 会被判成越界）。

## 3. 读取侧（Engine）

`ICEGLBReader` 把两个槽位解析成一份 `ormMap`：

| 文件里的情况 | 解析结果 |
|---|---|
| 两个槽位指向同一张图 | `{ url, occlusion: true, metallicRoughness: true }` |
| 只有 `metallicRoughnessTexture` | `{ url, occlusion: false, metallicRoughness: true }` |
| 只有 `occlusionTexture` | `{ url, occlusion: true, metallicRoughness: false }` |

两个布尔值不是装饰：把只含金属度/粗糙度的图当成遮蔽来读，会把整片材质无故压暗，
而且看起来像"光照参数调错了"。分辨率不同、指向不同图片时，以金属度那张的 URL 为准。

## 4. 着色器

三张贴图共用同一套米制盒投影 UV——法线主导轴决定投影平面。写一次 `surfaceUv`，
底色、法线、ORM 各自复用；此前同一段投影公式抄了三份，任何一份漂了都会静默错位。

```glsl
vec3 orm = texture(u_ormMap, surfaceUv).rgb;
surfaceOcclusion     = clamp(orm.r, 0.0, 1.0);          // 只压间接光
surfaceRoughness     = clamp(surfaceRoughness * orm.g, 0.04, 1.0);
surfaceMetallic      = clamp(surfaceMetallic  * orm.b, 0.0, 1.0);
```

遮蔽只作用于环境项与天光项：

```glsl
shade = clamp((ambient + sky * skyFactor) * occlusion + direct * key, min, max);
```

直射照度不乘遮蔽——否则贴图遮蔽会和 SSAO、阴影互相打架，同一个墙脚被压三次。

纹理单元：0 底色、1 法线、2 场景深度、3 阴影、**4 ORM**。`u_ormMap` 的采样器必须显式
设成 4，漏了这行它会默认读 0 号单元（底色贴图），症状是"金属度有一点变化但完全对不上"。

## 5. 平铺倍率

三张图共用 `u_uvScale`。取值顺序：底色贴图的 `KHR_texture_transform.scale` → ORM 自带
的 scale → 默认 `[1,1]`。导入的资产常常只带 ORM，没有这一层回退就会用米制默认值把
棋盘铺成每米八格，远看等于纯色。

## 6. 验收

受控场景（地面 + 四块不同高度的体块，平放板挂 ORM），同机位切换 ORM 开/关，
用纯色贴图确认三个通道各自生效：

| ORM 贴图 | 平均亮度 | 说明 |
|---|---|---|
| 关闭 | 159.41 | 板子 metallic=1、roughness=1 的基准 |
| 全白 (255,255,255) | 154.64 | 遮蔽 1、粗糙度 1、金属度 1（漫反射被收掉） |
| 渐变/棋盘 | 156.73 | R 从 0.35 渐变到 1、G 棋盘、B 半幅金属 |
| 全黑 (0,0,0) | 157.80 | 遮蔽 0、粗糙度 0.04、金属度 0 |

三档互不相同，说明遮挡、粗糙度、金属度三个通道都真的进了着色器；不是"读了一张图但只用了 R"。

## 7. 已知限制

- 三张贴图共用一个 scale：底色图想平铺 4 米、ORM 想平铺 2 米时做不到。要分开就得给
  每张贴图各自的 `KHR_texture_transform`，目前按"一套 UV 服务所有贴图"取舍。
- 遮蔽只压间接光，没有按法线朝向做半球遮蔽；弯曲表面的明暗过渡会比烘焙 AO 平。
- 没有 occlusion 强度滑杆：写进贴图的 R 是多少就是多少，运行时不能整体衰减。
