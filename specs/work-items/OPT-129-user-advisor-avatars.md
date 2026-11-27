# OPT-129：管理员、用户与商办顾问头像上传与展示

## 1. 目标与范围

为三类主体补齐头像上传与展示闭环，并在未配置自定义头像时保持现有默认兜底：

1. **后台管理员 / 员工（`Users` 集合）**
   - `Users` 增加可选 `avatar` 字段（`upload -> media`）；
   - 新增服务端端点 `POST /api/admin/avatar`，校验同源与后台员工会话（`isStaffRequest`），允许所有后台登录员工在 `/admin/account` 及用户管理页上传头像（不放开 `Media` 素材库写权限，`usage: 'other'` 不打水印）；
   - 右上角 [AccountMenu](file:///Users/liujiayuan/App/sbh/.claude/worktrees/opt-129-avatars/payload-office-platform/src/components/admin/AccountMenu.tsx) 优先展示用户自定义头像，未上传或加载失败时回退既有 Gravatar / 首字母。

2. **C 端会员用户（`Members` 集合）**
   - `Members` 增加可选 `avatar` 字段（`upload -> media`）；
   - 新增服务端端点 `POST /api/member/avatar` 与 `DELETE /api/member/avatar`，仅允许已登录会员操作本人头像，校验同源、大小（≤ 2MB）与真实图片格式（JPG / PNG / WebP / GIF，禁用 SVG 防 XSS）；
   - `MemberDto` 新增 `avatarUrl` 字段；[AccountSettings](file:///Users/liujiayuan/App/sbh/.claude/worktrees/opt-129-avatars/payload-office-platform/src/components/frontend/member/AccountSettings.tsx) 支持上传预览与恢复默认，[MemberMenu](file:///Users/liujiayuan/App/sbh/.claude/worktrees/opt-129-avatars/payload-office-platform/src/components/frontend/member/MemberMenu.tsx) 桌面触发按钮与移动抽屉展示头像，未配置时回退昵称首字 / 手机尾号。

3. **商办顾问（`SiteSettings` Global → `AdvisorCard`）**
   - `SiteSettings`「品牌」tab 新增可选 `advisorAvatar` 字段（`upload -> media`）；
   - [media-cache-hook.ts](file:///Users/liujiayuan/App/sbh/.claude/worktrees/opt-129-avatars/payload-office-platform/src/domain/media/media-cache-hook.ts) 纳入 `advisorAvatar` 删除缓存失效；
   - [AdvisorCard](file:///Users/liujiayuan/App/sbh/.claude/worktrees/opt-129-avatars/payload-office-platform/src/components/frontend/AdvisorCard.tsx) 配置了 `advisorAvatar` 时渲染圆形头像图片，留空时保持既有「顾问」文字圆形标识。

## 2. 明确非目标

- 不改变「商办顾问」全站平台虚拟身份设计（不按个人经纪人展示照片或联系方式）。
- 不允许 C 端会员访问 `/api/media` 或后台集合接口；会员会话不进入 `req.user`。
- 不修改现有 `Media.access` 与实景图水印逻辑。

## 3. 验收清单

- [x] `Users.avatar` / `Members.avatar` / `SiteSettings.advisorAvatar` 显式迁移已生成并在 PG 验证
- [x] `pnpm generate:types`、`pnpm generate:importmap`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm migrate:dry-run`、`pnpm build` 通过
- [x] 真实浏览器核验：后台 `/admin/account` 上传并持久化、右上角 `AccountMenu` 回显、深色模式无白底；后台 `SiteSettings` 配置顾问头像并刷新前台验证 `AdvisorCard` 回显；C 端 `/account` 上传与清除头像并刷新核验 `MemberMenu` 回显
