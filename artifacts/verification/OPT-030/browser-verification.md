# OPT-030 浏览器复验记录

日期：2026-08-16
分支：`feat/opt-030-admin-poka-yoke-9af1`
环境：本地 `pnpm dev`（port 3717，主 worktree），登录 `e2e-adm@example.com` / `Test1234!`（本地 seed 已跑，用户 id=1 存在）。
后台处于 **深色模式**（`html[data-theme="dark"]`），以下所有断言均在深色模式下通过。

## 结论摘要

六条验收点全部在浏览器实机通过；保存持久化满足「三步铁证」。控制台无新增错误（仅遗留媒体 404 与 built-in beforeunload 无手势拦截，均与本次改动无关）。

## 逐条证据

### P0-1 清空已选配套加二次确认 — 通过
- 楼盘编辑页（`/admin/collections/buildings/3`）「媒体与配套」Tab 出现「清空已选 (5)」按钮。
- 点击后弹出 Arco `Popconfirm`，文案「确定清空已选的 5 项配套？」，按钮为「清空」(danger) 与「取消」。
- `autoFocus`+`focusLock` 生效：焦点落在弹窗内「取消」按钮（`document.activeElement` 处于 `.arco-popconfirm` 内）。

### P0-2 未保存改动站内跳转拦截 — 通过（仅一次确认框）
- 在楼盘编辑页把「楼盘名称」改为「…（测试未保存）」使表单变脏，点击侧栏「房源列表」`<a>` 链接。
- 结果：**URL 停在 `/admin/collections/buildings/3`**（导航被拦截），弹出**唯一一个** Arco `Modal.confirm`：
  - 标题「有未保存的更改」，内容含「当前表单的改动尚未保存，离开页面将丢失这些更改。确认要离开吗？」
  - 按钮「留下继续编辑」/「直接离开」。
  - 无第二个原生 `window.confirm`（`stopImmediatePropagation` 压制了 Payload 内置 `LeaveWithoutSaving`）。
- 点「留下继续编辑」→ 弹窗关闭、仍在原页、脏值保留。
- 再次触发导航后点「直接离开」→ 跳转至 `/admin/collections/listings`。

### 第一层「前台可见性」卡片 — 通过（红绿两态 + 点击定位）
- 绿态（listing 29，published/approved/normal/gallery 3）：卡片显示「自身条件已齐」绿 Tag，五项全 ✓，无「主要原因」行。
- 红态（listing 17，supplyVisibilityHold=`pending_recheck`）：卡片显示「暂不可见」红 Tag，「可见性待复核」为 ✗ 且是主因，文案「该房源被标记为待复核（如商户停用触发），复核清除前前台不展示」。
- 点击「可见性待复核」条目 → 切到「审核与发布」Tab 并把「供给可见性冻结」字段滚入视口（`getBoundingClientRect().top` 落在视口内）。
- 深色模式样式：卡片背景透明、边框 `#2f2f2f`（`--theme-elevation-100`），✗ 条目 `#da4b48`、✓ 条目 `#24a4df`，无 `#FFFFFF` 白底残留。

### P1-2 媒体按钮可访问名 — 通过
- 媒体工作台（楼盘「媒体与配套」Tab）4 个媒体项，每个含：
  - `删除第 N 个媒体`（N=1..4）
  - `第 N 个媒体向前移动` / `第 N 个媒体向后移动`
- 全部通过 `aria-label` 提供可访问名。

### P1-3 媒体删除确认弹窗接管焦点 — 通过
- 点击 `删除第 1 个媒体` → 弹出 Popconfirm「确定移除该媒体？」，按钮「确定」/「取消」。
- `autoFocus`+`focusLock` 生效：焦点落在弹窗内「取消」按钮。

### P2 拖拽上传区键盘可达 — 通过
- 上传区 DOM：`role="button"` + `tabindex="0"` + `aria-label="上传媒体：点击或按 Enter 选择文件，也可将图片视频拖拽到此处"`。
- 源码已绑定 Enter/Space → `fileInputRef.click()`。

### 第二层 保存成功仍不可见 Toast — 通过（仅一次）
- listing 17 修改标题后保存，Toast 弹出：「已保存。前台仍不可见：可见性待复核——该房源被标记为待复核（如商户停用触发），复核清除前前台不展示」。
- 用 `.arco-message-wrapper` / `.arco-message` 精确计数，**恰 1 个**（早前 `.arco-message, [class*="message"]` 匹配到 3 个是嵌套结构 wrapper/item/content 的重复命中，非重复弹）。
- 保存持久化三步铁证：PATCH 后 `GET /api/listings/17` 返回标题已改、`updatedAt` 更新（2026-08-16T05:23:23Z）；强刷后标题保持（已将标题改回原值再保存一次，最终 `title="静安待租楼盘 · 850㎡ 整层办公"`，`updatedAt` 2026-08-16T05:24:17Z）。

## 已知遗留（非本次改动引入）

- 控制台 `GET /api/media/file/*.jpg?prefix=media → 404`：本地未跑 `seed:media`，媒体记录存在但文件未落本地存储。不影响本次防呆/卡片/Toast 验收。
- 控制台 `Blocked attempt to show a 'beforeunload' confirmation panel`：浏览器对无用户手势的 `beforeunload` 原生弹窗的正常拦截（Payload 内置行为），正是 P0-2 用点击拦截 + Modal 取代它的原因。
- `BuildingMediaManager.tsx` 两处 `react-hooks/exhaustive-deps`（`setItems`）警告为存量，非本次改动。

## 未覆盖项说明

- 图集「有效图片 2/3」的实机展示：本地 seed 29 套房源 gallery 全为 3，无现成 2 图房源；该口径已由 `tests/listing-self-visibility.test.ts` 的 fail-closed + short-by-1 用例锁定（`有效图片 2/3`、`还差 1 张`、`locateTab === '展示内容'`）。卡片对图集行数读 `useField('gallery')` + `galleryRowCount`，与已实机验证的「可见性待复核」红态走同一渲染分支。
- 状态字段（reviewStatus/publicationStatus/supplyVisibilityHold）在表单内 `readOnly`，故实机用「可见性待复核」数据驱动红态，未走端点改状态。
