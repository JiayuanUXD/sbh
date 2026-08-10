# TODOS

来源：2026-08-10 双落地页（委托找房 `/entrust` + 投放房源 `/publish`）交付与代码审查。
排序按"阻塞程度 × 爆发后果"，不按发现顺序。

已上线：master `6414817`，两页在生产可访问，两次 CI 部署均成功。

---

## P0 — 有明确阻塞关系，必须按顺序做

### T1. 推送 `34f0eeb` 前先在生产迁移账本插一行

**状态**：代码已提交在本地 master（领先远端 1 个提交），**故意未推送**。

`34f0eeb` 给 `listings` 补了 `dataSource` 字段声明并生成迁移 `20260810_003111_align_listings_data_source_with_production`。生产上那 4 列**已经存在**（来自失落分支），这条迁移一跑就 `ADD COLUMN` 失败、中断部署。

**顺序不能颠倒**：先插账本行，再 `git push origin master`。

```sql
INSERT INTO payload_migrations (name, batch, created_at, updated_at)
VALUES ('20260810_003111_align_listings_data_source_with_production',
        (SELECT COALESCE(MAX(batch), 0) + 1 FROM payload_migrations), NOW(), NOW());
```

回滚：

```sql
DELETE FROM payload_migrations WHERE name = '20260810_003111_align_listings_data_source_with_production';
```

该断言在事实上为真：生产确实有这 4 列，类型、可空性、枚举值（唯一值 `huizuxuanzhi`）都与迁移逐项一致，生成的 SQL 与失落分支原始迁移逐字相同。

**若决定不做**：`34f0eeb` 必须整体保留在本地或 revert，**不能只推 `Listings.ts` 的字段声明**——那会造成 config 声明了字段却没有对应迁移，制造新的不一致。

---

### T2. 追回 4 条共享办公迁移

生产已应用但仓库任何地方都没有的迁移，做完 T1 后仍剩这 4 条：

```
20260809_180000_import_huizuxuanzhi_shared_offices
20260809_183000_remove_shared_office_source_branding
20260809_184000_attach_shared_office_building_covers
20260809_190000_complete_shared_office_images
```

已排查且**确认不在**：28 个远端分支、全部本地分支、`git fsck --lost-found` 的 18 个悬空提交、现存 stash。按时间戳推断是 2026-08-09 在某台机器的未提交工作区里直接跑的。

**要做**：向当时执行导入的人索取 `.ts` + 配套 `.json`，**不要改文件名与内容**（时间戳决定执行顺序）。拿到后在全新空库上验证 43 条能从零重放，再合并。

**若永久丢失**：由 DBA 导出生产 schema，人工编写一次性对齐迁移，并在 `DEPLOYMENT.md` 记录决定与差异清单。

**在 T1+T2 完成前的硬约束**：不要新建从 master 重建的环境并假设它与生产等价；不要对生产启用 dev pushSchema。

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
