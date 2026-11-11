-- 补历史数据：已发布却没有发布时间的资讯
--
-- 【已于 2026-11-11 在生产执行（口径 A，8 行），结果与复核见 README.md「执行记录」；本文件留作存档与回滚依据，不要再跑第 2 段】
-- 先决条件（当时）：用户确认口径（见 README.md「补数方案」）。
-- 【已选定口径 A】（用户 2026-11-11 确认；B、C 保留在下面只作备忘）
-- 口径 A：published_at = created_at（写稿日；线上 8 篇一天一篇，日期各不相同）。
-- 口径 B：published_at = updated_at（最后一次修改，大概率是后台点「发布」的时刻；但线上 5 篇的
--         updated_at 都落在 10-31 05:10:40–05:11:11（UTC，31 秒内的批量操作），会全部显示 10-31，且 updated_at 不保证就是上架动作）。
-- 口径 C：运营逐篇在后台手填日期（走 hook 与缓存失效，最准，8 篇各点一次）。
--
-- 特性：单事务；WHERE 带 published_at IS NULL 守卫所以幂等；不改 updated_at（sitemap lastmod 用它）；
--       裸 SQL 不触发 Payload 的缓存失效，前台最长 5 分钟后才反映（口径 C 无此问题）。
-- 本地演练：2026-11-11 在隔离克隆库 sbh_dev_newsdate 上跑过一遍，3 行 → UPDATE 3，再跑 UPDATE 0，
--           前台首页 / 资讯列表 / 详情页三处出现日期，列表顺序恢复正常。

-- 1) 预检（只读）：确认命中的就是预期的那 8 篇（线上 2026-11-11 为 id 111–116、119、120）
SELECT id, slug, status, created_at, updated_at
  FROM articles
 WHERE status = 'published' AND published_at IS NULL AND deleted_at IS NULL
 ORDER BY id;

-- 2) 执行（口径 A，用户 2026-11-11 已选定）。只动用户确认过的这 8 个 id：
--    若预检里冒出这 8 个以外的「已发布无日期」文章（例如 hook 上线前又有人把草稿改成已发布），
--    它们的创建日不代表发布日，不要顺手一起补——停下来单独定口径。
--    返回行数不是 8 就 ROLLBACK，不要 COMMIT。
BEGIN;
UPDATE articles
   SET published_at = created_at
 WHERE id IN (111, 112, 113, 114, 115, 116, 119, 120)
   AND status = 'published' AND published_at IS NULL AND deleted_at IS NULL
RETURNING id, slug, published_at;
-- 核对返回恰好 8 行、日期依次为 2026-10-23/24/26/27/28/29/30/31（上海时区）后：
COMMIT;

-- 3) 回滚（执行后发现口径不对时；把 id 换成第 2 步 RETURNING 出来的清单，别用条件批量回滚，
--    以免误伤之后正常发布的文章）
-- UPDATE articles SET published_at = NULL WHERE id IN (/* 第 2 步返回的 id */);
