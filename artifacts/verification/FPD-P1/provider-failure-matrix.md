# FPD-P1 第三方供应商故障矩阵与安全成本记录

> 范围：P1 详情页引入的高德地图（JS API + WebService）与媒体/纠错等第三方依赖。
> 依据：`docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md` Task 7 Step 3/4。
> 守护不变量：地图/POI/视频失败不影响楼盘事实、有效供给和咨询；纠错只追加、可审计、前台不可读处理状态。

## 1. 故障矩阵（Step 3）

每种故障均验证：**地址、有效供给、咨询入口保持可用**。结构性保证来自 `LocationPanel` 的静态区（地址 / 最近地铁 / 复制地址 / 打开高德地图外链）始终渲染（`src/components/frontend/LocationPanel.tsx:83-117`，不依赖地图/POI 状态），供给与咨询为独立区块，不在 `LocationPanel` 内，故任何地图/POI 故障均不波及。

| # | 故障模式 | 触发条件 | 处理路径（错误码） | 降级表现 | 地址/供给/咨询 | 证据 |
|---|---|---|---|---|---|---|
| 1 | 无 JS Key | `NEXT_PUBLIC_AMAP_JS_KEY` 缺失 | `amap_js_key_missing`（`amap-map-loader.ts:73-76`） | 地图区不渲染触发按钮后的画布，点击「查看地图」后显示「地图暂时不可用」 | 保留 | loader 单元测试 + 代码路径 |
| 2 | WebService 401 / 非 2xx | 高德 WebService 返回 401/4xx/5xx | `provider_http_error`（`amap-provider.ts:101-106`） | 该类别 POI 返回空数组，其余类别继续 | 保留 | `amap-location-provider.test.ts: HTTP 非 2xx 返回 provider_http_error` |
| 3 | 超时 | JS API 5s（`amap-map-loader.ts:59`）/ WebService 2.5s（`amap-provider.ts:8,78`） | `amap_js_timeout` / `provider_timeout` | 地图显示「地图暂时不可用」；POI 该类别空 | 保留 | `amap-location-provider.test.ts: 超时返回可分类错误` |
| 4 | 非法响应 | 命名空间缺失 / 非 JSON / 非对象 / pois 非数组 | `amap_js_invalid_response` / `provider_invalid_response`（`amap-provider.ts:108-115,144-161`） | 地图或该类别 POI 降级 | 保留 | `amap-location-provider.test.ts: 响应结构非法返回 provider_invalid_response` |
| 5 | SDK 阻断 | `webapi.amap.com` 被网络阻断/广告拦截 | `amap_js_script_error`（`amap-map-loader.ts:109-112`） | 点击「查看地图」后显示「地图暂时不可用」，静态区与外链可见 | 保留 | E2E `detail-location.spec.ts:18-30`（`page.route('**/webapi.amap.com/**', abort)` -> 「地图暂时不可用」+ 复制地址 + 打开高德地图可见） |
| 6 | 无坐标 | 楼盘未配置坐标 | `fetchNearbyPois` 直接返回空（`location-pois.ts:43`）；`AmapMapCanvas` 返回 null（`AmapMapCanvas.tsx:70-72`） | 不渲染地图区，不请求 WebService；静态区与外链仍可见（外链依赖坐标，无坐标时隐藏外链但地址/地铁/复制保留） | 保留 | 代码路径 + `LocationPanel` 静态区无条件渲染 |
| 7 | POI 空结果 | 高德返回空 pois 或全部 POI 被过滤 | `parseAmapBody` 返回 `[]`（`amap-provider.ts:163-170`）；`hasAnyPoi=false` 不渲染 POI 列表（`LocationPanel.tsx:128`） | 静态区保留，POI 列表不展示 | 保留 | `amap-location-provider.test.ts: 只映射合法 POI 并限制为 5 条` |

### 1.1 级联安全：逐类别 catch + 不抛错

`fetchNearbyPois`（`location-pois.ts:47-62`）用 `Promise.all` 并发四类 POI，每类独立 `try/catch`：单类失败返回 `[]`，**永不抛错**，调用方直接传入 `LocationPanel`。因此即使四类全部失败，页面仍正常渲染（静态区 + 供给 + 咨询）。

### 1.2 业务错误（status 非 1）

高德 WebService 业务错误（`body.status !== '1'`，如配额超限 `status=0` 且 `infocode=10021`）映射为 `provider_business_error`（`amap-provider.ts:150-155`），按上述第 2/7 行降级。证据：`amap-location-provider.test.ts: 业务 status 非 1 返回 provider_business_error`。

## 2. 安全与成本记录（Step 4）

### 2.1 Key 域名白名单与隔离

- **浏览器侧 JS Key**（`NEXT_PUBLIC_AMAP_JS_KEY`）：域名白名单 Key，仅用于 `webapi.amap.com/maps` JS API 注入（`amap-map-loader.ts:87`）。该 Key 公开可见但受高德域名白名单约束，非白名单域加载即失败（降级为静态地址）。
- **服务端 WebService Key**（`AMAP_WEB_SERVICE_KEY`）：仅服务端 `amap-provider.ts` 使用，**从不进入浏览器**（`location-pois.ts:44` 服务端读取，不经过 DTO）。
- **严格分离**：两个 Key 独立配置、独立用途，不混用（`amap-map-loader.ts:10` 注释明示）。
- 证据：`.env.local` 同时含两个 Key；DTO（`mappers.ts`）不输出任何 Key；`contracts.ts` 的 ViewModel 不含 Key 字段。

### 2.2 WebService 配额与告警

- 配额控制：POI 查询按四类别 × 每类 5 条，单楼盘最多 4 次请求；结果经 24h TTL 缓存（见 2.3），同类查询不重复计费。
- 失败不缓存（`cache.ts: 失败不缓存`），避免错误结果占用配额语义。
- 配额超限（`infocode=10021` 等）映射为 `provider_business_error`，降级不阻断。
- **告警**：P1 阶段未接入主动告警；生产应通过高德控制台配额监控 + CLS 日志（`module:rdb`/访问日志）观测 `provider_business_error`/`provider_http_error` 频次。本仓库 CLS 查询语法见 `queryLogs` 工具说明。

### 2.3 缓存命中

- 缓存层：`src/domain/location-services/cache.ts`，进程内 `Map`。
- 缓存键：`poi:${buildingId}:${category}:${lat5}:${lng5}`（坐标截断到小数点后 5 位，微差合并，`cache.ts:7`）。
- TTL：24h（`cache.ts: TTL 24h 过期后重取`）。
- 命中不重复调 provider（`cache.ts: 命中缓存不重复调 provider`）。
- 失效：`invalidateBuildingPois(buildingId)` 清空该楼盘全部类别（`cache.ts:invalidateBuildingPois`）。
- 证据：`amap-location-provider.test.ts` 缓存四测全过。

### 2.4 请求超时

- JS API：5s（`amap-map-loader.ts:59`，`LOAD_TIMEOUT_MS`）。
- WebService：2.5s（`amap-provider.ts:8`，`DEFAULT_TIMEOUT_MS`，`AbortController`）。
- 超时映射稳定错误码（见矩阵第 3 行），不挂起请求。

### 2.5 未请求用户定位

- P1 只展示楼盘固定坐标，**不调用 `Geolocation` API**（`amap-map-loader.ts:9`、`AmapMapCanvas.tsx:8` 守护注释明示）。
- 地图中心固定为楼盘坐标（`AmapMapCanvas.tsx:86`），无 `getCurrentPosition` 调用。
- 证据：E2E `detail-location.spec.ts:32-38` 验证进入视口前不加载 SDK；代码无 `geolocation` 引用。

### 2.6 日志无 Key / PII

- WebService 错误信息**不含完整请求 URL**（URL 含 Key）：`amap-provider.ts:93` 注释「错误信息不包含 url（含 Key）」，`describeError(e)` 只输出错误类型/消息。
- 证据：`amap-location-provider.test.ts: 错误信息与堆栈不含完整请求 URL（不泄露 Key）`。
- 纠错日志：`hashIpForLog(ip, salt)` 仅留 32 位 IP 哈希，`buildCorrectionLogEntry` 剥离描述正文与原始 IP（`domain/corrections`）。纠错记录前台不可读处理状态（`read/update` 需 `correction:read/manage` 权限）。
- 坐标隐私：公开 DTO 坐标截断到小数点后 4 位（~11m，建筑级），内部高精度坐标不进入 DTO（`mappers.ts: PUBLIC_COORDINATE_PRECISION`，`frontend-mappers.test.ts` 三测验证）。
