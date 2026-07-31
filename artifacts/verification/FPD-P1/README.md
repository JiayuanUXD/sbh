# FPD-P1 房源与楼盘详情增强 — 验证证据

> 范围：P1 详情页增强（分类视频/平面图、高德地图与周边 POI、canonical 分享/本地收藏、可审计信息纠错）。
> 计划：`docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md` Task 7。
> 任务包：`specs/work-items/FPD-P1-detail-enhancements.md`。
> 验证分支：`codex/detail-pages-p1-enhancements`，基线 commit `3655006`（Task 7 Step 1）→ Task 7 证据 commit 见 §5。

## 1. 静态门禁（Step 1）

全部 exit 0。

| 门禁 | 命令 | 结果 |
|---|---|---|
| 迁移预演 | `pnpm migrate:dry-run` | 0 fail |
| 迁移校验 | `pnpm migrate:verify` | 0 fail，26 条迁移就绪 |
| Payload 类型 | `pnpm exec payload generate:types` | 成功（`payload-types.ts` 含 `InformationCorrection`、`correction` 事件/聚合类型） |
| Payload importmap | `pnpm exec payload generate:importmap` | 成功 |
| 类型检查 | `pnpm typecheck` | PASS |
| Lint | `pnpm lint` | 0 error |
| 单元测试 | `pnpm test` | **2280 passed**（133 test files） |
| 生产构建 | `NEXT_PUBLIC_SITE_URL=http://localhost:3717 pnpm build` | 成功，含 `/api/corrections` 路由 |

### 1.1 Step 1 顺带修复的 pre-existing 失败

- `frontend-mappers` 坐标 x2：`mapCoordinates` 暴露高精度内部坐标，违反 PRD「高精度内部坐标不得进入 DTO」。修复：`PUBLIC_COORDINATE_PRECISION=4`（~11m，建筑级）截断；内部距离计算仍用原始坐标，不受影响。
- `detail-components-contract <video>`：Task 4 分类 Tab 默认仅渲染图片 Tab，视频未进首屏 SSR，旧用例同时断言 image/video 失效。修复：拆分为 image-only / video-only 两次渲染。

## 2. P1 E2E（Step 2）

`PORT=3718 pnpm exec playwright test`（独立端口，规避 p0-core 工作树陈旧 server 复用）。**30 passed（45.0s）**。

详见 [`browser-matrix.md`](./browser-matrix.md)。

| Spec | 结果 |
|---|---|
| `detail-location.spec.ts` | 2 passed |
| `detail-media.spec.ts` | 3 passed |
| `detail-share-save.spec.ts` | 3 passed |
| `detail-pages.spec.ts` | 22 passed |

## 3. 第三方故障矩阵与安全成本（Step 3/4）

详见 [`provider-failure-matrix.md`](./provider-failure-matrix.md)。

- 7 类故障模式（无 JS Key / WebService 401 / 超时 / 非法响应 / SDK 阻断 / 无坐标 / POI 空结果）均降级，地址/供给/咨询保留。
- 安全与成本：Key 域名白名单与服务端隔离、WebService 配额/缓存、请求超时、不请求用户定位、日志无 Key/PII、坐标截断、纠错隐私日志。

## 4. P1 全局约束复核

| 约束 | 证据 |
|---|---|
| 高德地图服务为唯一地图/POI 真源 | `domain/location-services` 唯一 provider；未接入腾讯/百度 |
| POI 不进入 JSON-LD | `mappers.ts` JSON-LD 构造不含 POI 字段 |
| 地图/视频不进入首屏关键链路 | 地图懒加载（点击/视口后加载 SDK）；视频 `preload="none"`、分类 Tab 默认图片、延迟挂载 |
| 分享只使用 canonical | `canonicalShareUrl` 移除 query/hash；E2E `detail-share-save` 验证 |
| 收藏只保存不可识别 ID | `saved-details.ts` 仅存 type/id/slug/savedAt，无业务字段 |
| `/api/corrections` 同源/schema/限流/幂等/隐私日志 | 8 步路由 + `correction-api-route.test.ts` 15 测 |
| 纠错只追加、可审计、前台不可读处理状态 | `delete()=false` + beforeChange 保护 + read/update 需权限；`correction-domain.test.ts` 14 测 |

## 5. DoD 对照

- [x] 高德地图服务为唯一地图/POI 真源，Key 权限和域名白名单有证据。
- [x] 地图/POI/视频失败不影响楼盘事实、有效供给和咨询。
- [x] 平面图、视频和实景媒体分组明确且可访问。
- [x] 分享只使用 canonical；收藏只保存不可识别 ID。
- [x] 纠错只追加、可审计、前台不可读取处理状态。
- [x] 类型、lint、全量测试、构建、迁移和 P1 浏览器矩阵全绿。

## 6. 验证提交

```
git add specs/work-items/FPD-P1-detail-enhancements.md \
  artifacts/verification/FPD-P1 \
  payload-office-platform/tests/e2e/detail-pages.spec.ts
git commit -m "test: 详情页 P1 全量验证与证据（Task 7）"
```
