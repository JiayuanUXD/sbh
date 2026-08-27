# OPT-059 srcset 生效确认

## 测试设置

1. 用 `sharp` 生成的测试图（4.07MB JPEG）经 `POST /api/media`（等价后台上传）新建 media id=71，`alt: "OPT-059 srcset verification cover for lujiazui"`，返回体确认三档派生齐全：
   - `thumb`: `/api/media/file/opt059-srcset-cover-320x240.webp`
   - `card`: `/api/media/file/opt059-srcset-cover-768x576.webp`
   - `hero`: `/api/media/file/opt059-srcset-cover-1600x1200.webp`
2. 通过 `PATCH /api/locations/5`（陆家嘴商圈，slug=`lujiazui`）把 `coverImage` 设为 id=71，覆盖该商圈原本"留空回退楼盘封面"的路径。
3. 刷新首页（`/shanghai`，多城市路由已开启，首页重定向到该城市域）验证渲染。

## 遇到的环境细节（均已处理，非 OPT-059 缺陷）

- **首页数据带 5 分钟缓存**：`getCachedHomepage` 走 `unstable_cache({ revalidate: 300 })`（`src/lib/frontend/cached-queries.ts:143`）。`Locations` 的 `afterChange` 缓存失效钩子 `invalidateLocationCityCache` 只在 `PUBLIC_LOCATION_FIELDS`（`name/slug/type/status/frontendVisible/city/parent`）发生变化时才失效缓存（`src/collections/Locations.ts:32-93`）——**`coverImage` 不在这张字段表里**，所以单独改封面图不会主动失效缓存，需等 5 分钟 TTL 自然过期才能在前台看到。这是 `Locations.ts` 既有的缓存失效范围问题，与 OPT-059 改的存储层/DTO/前台组件无关（Task 1-5 均未碰这个文件），但会让"改封面图后 5 分钟内前台看不到"，**记录为线上可观察到的真实体验缺口，供另行评估是否需要把 `coverImage` 加入 `PUBLIC_LOCATION_FIELDS`**。验证时等待缓存自然过期后复测，证实数据本身正确写入、渲染正确。
- **本会话 Browser pane 处于「未显示」状态，不合成帧**：`computer.screenshot`/`zoom` 全程报错 `the Browser pane is not displayed, so the page is not compositing frames`（详见 `focal-point-selector.png` 缺失说明及 `upload-timing.md` 末尾环境限制章节）。副作用是浏览器原生 `loading="lazy"` 的可视区检测同样依赖合成/渲染管线，在本环境下**不会触发**，导致 bento 卡片图片默认停在 `complete:false / naturalWidth:0` 不发请求。为拿到真实网络请求证据，对目标 `<img>` 元素执行了 `img.loading = 'eager'` 后重新赋值 `src`/`srcset` 强制触发原生 fetch（不绕过 `srcset` 选择逻辑本身，只是移除懒加载门槛），随后用 `read_network_requests` 抓取到的是浏览器自己按 `srcset` 描述符选出的真实请求，不是手工拼的 URL。

## 网络请求证据

### 新图（陆家嘴商圈新封面，media id=71，有三档派生）

```
GET http://localhost:3717/api/media/file/opt059-srcset-cover-768x576.webp → 200 OK
```

- `<img>` 渲染出的 `srcset` 属性：
  `/api/media/file/opt059-srcset-cover-320x240.webp 320w, /api/media/file/opt059-srcset-cover-768x576.webp 768w, /api/media/file/opt059-srcset-cover-1600x1200.webp 1600w`
- 浏览器按当前视口（该卡片渲染宽度）自动选中 `768w` 档并发起请求，请求的是 **`.webp` 派生图**，不是原图 `opt059-srcset-cover.jpg`。
- `img.complete === true`，无解码错误。

### 存量图（同一商圈下未重新上传的楼盘封面，如 `cover-lujiazui-grade-a-river-view-3.jpg`，无派生）

```
GET http://localhost:3717/api/media/file/cover-lujiazui-grade-a-river-view-3.jpg → 200 OK
```

- 5 处渲染该图的 `<img>` 元素 `srcset` 属性均为空字符串（符合"无派生尺寸时不发 srcset"的契约）。
- 请求的是**原图** `.jpg`，HTTP 200，无报错；`img.complete === true`，`naturalWidth === 1600`（与原图宽度一致）。
- 这正是 spec §7「存量不回填」的预期回落行为，**不是 bug**。

## 控制台检查

`read_console_messages({ onlyErrors: true })` 在上述两组图片强制加载后返回 **"No console logs."** —— 无任何报错（含图片 404 / 解码失败等）。

## 结论

- **srcset 真的生效**：新上传（有派生）的图片在浏览器端选出了 `.webp` 派生 URL 并成功请求 200；未回填的存量图正确回落到原图 URL 且不报错。两条均有真实网络请求（非拼测）为证。
