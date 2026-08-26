# TODOS

来源：2026-08-10 双落地页（委托找房 `/entrust` + 投放房源 `/publish`）交付与代码审查。
排序按"阻塞程度 × 爆发后果"，不按发现顺序。

已上线：master `6414817`，两页在生产可访问，两次 CI 部署均成功。

---

## P0 — 有明确阻塞关系，必须按顺序做

### T1. ~~推送 `34f0eeb` 前先在生产迁移账本插一行~~ ✅ 已完成

**状态**：**已完成**。2026-08-26 只读核查生产 `payload_migrations`，
`20260810_003111_align_listings_data_source_with_production` 在账本里（batch 19）。

原任务是：`34f0eeb` 给 `listings` 补 `dataSource` 字段声明并生成了那条迁移，而生产上
那 4 列**已经存在**（来自失落分支），迁移一跑就 `ADD COLUMN` 失败、中断部署，
所以要先插账本行再推。现在账本行已在，本条不再需要动作。

> 本节此前长期停留在「代码已提交在本地 master、故意未推送」这个状态描述上，
> 而事实早已改变。**过期的待办比没有待办更坏**——它会让人以为 master 还压着
> 一个未推的提交，进而在判断部署风险时把它算进去。

---

### T2. 追回 **6** 条失落迁移（不是 4 条）

生产已应用、但仓库任何地方都没有的迁移。2026-08-26 只读比对生产
`payload_migrations`（70 条）与仓库 `src/migrations/`（65 条）得出：

```
20260805_063954                                       ← 本节此前从未记录
20260805_082216_add_listings_data_source              ← 本节此前从未记录
20260809_180000_import_huizuxuanzhi_shared_offices
20260809_183000_remove_shared_office_source_branding
20260809_184000_attach_shared_office_building_covers
20260809_190000_complete_shared_office_images
```

后 4 条是本节原本记录的共享办公迁移；**前 2 条是这次核查才发现的**，说明当时的
清点没有做全库差集，只清点了已知的那一批。

已排查且**确认不在**（针对后 4 条）：28 个远端分支、全部本地分支、
`git fsck --lost-found` 的 18 个悬空提交、现存 stash。按时间戳推断是 2026-08-09
在某台机器的未提交工作区里直接跑的。前 2 条尚未做同等排查。

**要做**：向当时执行的人索取 `.ts` + 配套 `.json`，**不要改文件名与内容**
（时间戳决定执行顺序）。拿到后在全新空库上验证能从零重放，再合并。

**若永久丢失**：由 DBA 导出生产 schema，人工编写一次性对齐迁移，并在
`DEPLOYMENT.md` 记录决定与差异清单。

### 这 6 条的实际危害边界（别高估，也别低估）

失落迁移的性质是**生产 schema 领先于仓库**。因此：

- ❌ **不影响**在生产上叠加新迁移。新迁移只要不与既有对象撞名就能正常执行——
  2026-08-26 的 OPT-053 正是在这个前提下核实后合入的（逐项确认要建的 3 张表、
  2 个列、1 个枚举在生产上都不存在，再放行）。
- ⚠️ **影响**「从 master 重建的环境等价于生产」这个假设。空库重放缺这 6 条，
  得到的 schema 与生产不同。

**硬约束**：不要新建从 master 重建的环境并假设它与生产等价；
不要对生产启用 dev pushSchema。

### 叠加新迁移前的自查（照做即可）

```sql
-- 1. 账本差集：确认自己这条不在生产里
SELECT name FROM payload_migrations ORDER BY name;

-- 2. 撞名检查：把自己迁移要建的对象名填进去，必须返回零行
SELECT 'table' AS kind, tablename AS name FROM pg_tables
  WHERE schemaname='public' AND tablename IN ('<你的表名>')
UNION ALL SELECT 'column', column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='<目标表>' AND column_name IN ('<你的列名>')
UNION ALL SELECT 'enum', typname FROM pg_type WHERE typname='<你的枚举名>';
```

第 2 步是 T1 当年出事的直接教训：那次正是生产**已有**目标列而迁移要 `ADD COLUMN`。

---

### T3. 生产只有 ADM 一个角色，投放审单对非管理员不可见

生产 `roles` 表当前只有 `ADM`（`menus: ["*"]`、`ops: ["*"]`）。没有 OPS / MGR / BRK。

后果：`20260810_090000_supply_submission_role_permissions` 迁移找不到目标角色，什么都没授（部署日志里有告警 `supply_submission role permissions not applied to missing built-in role(s): OPS, MGR`）。功能当前只有管理员能用。

**陷阱**：那是一次性迁移，已经跑过、不会再执行。以后 seed 出 OPS/MGR 时权限从角色 fixture 带入没问题，但**手工建的角色不会自动拿到** `supply_submission:*`，需要手工补。

**要做**：决定生产是否 seed 内置角色。若 seed，验证「房源投放申请」菜单对 OPS 可见、通知能正确投递给 OPS 而不是只给管理员。

---

## P1 — 安全与权限，不阻塞但应在有真实数据前处理

### T4. 投放申请的读取没有数据范围收窄

`SupplySubmissions` 的 access 只查操作码，不做逐条 city/team 过滤。当前 MGR（dataScope 声明为 `team`）持 `supply_submission:read`，实际能读**全平台**房东联系方式与地址。

对比：`Leads` 有 `leadReadAccess` 按团队/城市收窄 + `afterRead` 手机号脱敏两层。本次已补上脱敏（`ddcb9ff`），并收回了 BRK 的读权限，但**范围收窄没做**。

**为什么没在本次做**：投放申请本身没有团队维度（无 owner/team 字段），怎么收窄是设计决定而非机械修复。

**要做**：定清口径——按 `city` 收窄？按 `assignee` 收窄到本人 + 未分配？还是维持全量但只给 OPS？

---

### T5. sessionStorage 指纹的措辞

`supply-submission-request.ts` 在 sessionStorage 存 `SHA-256(手机号|楼盘名|地址)`。注释写的是「只存 SHA-256 指纹」，暗示不可逆。手机号熵很低，散列可离线爆破。

实际可利用性低（同源 sessionStorage，能读它的脚本本来就能直接读表单字段），**不需要改实现**。但注释应改成「仅作幂等辅助，非隐私控制」，避免以后有人把"哈希过"当成"脱敏了"。

---

## P2 — 可观测性与一致性

### T6. 通知重试耗尽后没有可见性

`supplySubmissionNotificationTask` 重试 5 次后按 Payload 默认标记失败，没有死信队列或告警。`domain-events` 行会留 `processedAt=null` + `lastError`，但没有任何界面或告警把它暴露出来，永久卡住的通知无人知晓。

**要做**：加一个后台视图或告警，筛 `processedAt IS NULL AND attempt_count >= 5` 的 domain-events。

### T7. `supply-submissions` 未加入 `auditFieldsPlugin.excludedCollections`

形态完全相同的 `information-corrections` 是被排除的（都是匿名前台提交，`createdBy`/`lastModifiedBy` 恒空）。字段惰性无功能影响，但与项目自身惯例不一致。

### T8. `handledAt` 不在 protect hook 的 `IMMUTABLE_FIELDS` 里

持 `supply_submission:manage` 者可经 API 直接改写它（`admin.readOnly` 只挡后台 UI），而字段描述写的是「状态流转到终态时自动写入」。影响很小（只有授权管理者能 update）。

### T9. `isSameOrigin` 缺 Origin 头时放行

`/api/supply-submissions`、`/api/inquiries`、`/api/corrections` 三处同一写法：`if (!origin || !host) return true`。能挡浏览器 CSRF，挡不住不带 Origin 的脚本批量提交，实际防线只有每 IP 每分钟 3 次限流。

### T10. body 无上界缓冲

省略 `Content-Length`（chunked）即可跳过预检，`req.text()` 会先把整个 body 读进内存再检查字节数。三个公开端点同一写法，**不是本次引入**，建议一处集中修（改成流式读取并在超限时中断）。

---

## P3 — 清理

### T11. `feat/import-huizuxuanzhi` 分支怎么处理

该分支不只含导入功能，还自带一整套 COS 集成（`cos-config.ts`、`media-cos-migration.ts`、`20260805_033418_cos_media_prefix.ts`、`payload.config.ts` 的 `s3Storage` 块），而 master 早已独立实现了同样的东西。整分支合并会撞车。

T1 已把该分支里真正缺失的东西（`data_source` 字段与迁移）以前向迁移形式取回。**要做**：确认该分支还有没有别的未合入价值，没有则删掉，避免以后又有人从它部署。

### T12. `notifications` 唯一索引的锁风险（当前无害，长期留意）

`20260809_183327_supply_submission_notification_unique` 用普通 `CREATE UNIQUE INDEX`（没有 `CONCURRENTLY`，且 Payload 把 `up()` 包在事务里使 CONCURRENTLY 不可用）。本次部署时生产 `notifications` 为 0 行，构建瞬时完成、零锁风险。

表长大之后若要在共享表上做同类 DDL，按 `DEPLOYMENT.md` 的前置检查走受控路径。

### T13. 本地 Node 版本

`.nvmrc` / CI / Dockerfile / `engines` 四处一致为 22，只有开发机是 v24（`pnpm` 每次打印 unsupported engine 警告）。**不要改仓库配置**；本地跑 `nvm use` 即可。真要升 Node 大版本应单独开分支，连同 Dockerfile 与 CI 一起升并跑完整回归。

---

## 待运营确认（非技术债）

### T14. 数字背书的口径与更新节奏

`landing-config.ts` 的 `ENTRUST_STATS` 现在是 2026-08-10 从生产库实测的真实数字（2200+ 套在租房源 / 70 座写字楼 / 覆盖 9 个行政区），注释里留了取数 SQL。刻意写成静态常量（两页是全静态页，为三个数字把整页动态化不值得）。

**要做**：定一个复核节奏（例如每季度按注释里的 SQL 重新核对），避免数字随房源增长而失真。

注意 `BRAND_BADGE`（`上海中高端办公租赁平台`）**不是占位**，与 `(frontend)/layout.tsx` 的站点标题同源，要改必须两处一起改。
