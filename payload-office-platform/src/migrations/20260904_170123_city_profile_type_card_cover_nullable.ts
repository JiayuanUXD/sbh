import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 单城「按类型浏览」封面覆盖的媒体引用列改为可空。
 *
 * ## 病因
 *
 * `city_site_profiles_type_card_overrides.cover_image_id` 是 NOT NULL，而它指向
 * media 的外键是 `ON DELETE SET NULL`——互斥。删 media 时 PG 试图置 NULL 直接撞
 * 非空约束：
 *
 *   23502  UPDATE ONLY "city_site_profiles_type_card_overrides"
 *          SET "cover_image_id" = NULL WHERE $1 = "cover_image_id"
 *
 * 后果不只是后台删图报「Something went wrong.」，`pnpm seed:media` 的
 * `deleteAllMedia` 也在这里中断（它只解了 listings / buildings / pages 的引用，
 * OPT-060 新增的这张表没跟上）。
 *
 * 与房源侧本迁移的前身 `20260819_113218`、楼盘侧 OPT-050 是同一个死结。根因在
 * Payload：`@payloadcms/drizzle` 的 `traverseFields.js` 对每个单值 relationship /
 * upload 列写死 `onDelete: 'set null'`，同时只要 `field.required` 就加 `notNull`。
 * 「required 的 upload 字段」必然生成这对自相矛盾的约束，没有开关可改 `onDelete`，
 * 所以修法只能是去掉字段的 `required`（已在 `collections/CitySiteProfiles.ts` 去掉，
 * 那里有完整说明）。
 *
 * ## 为什么是「脱钩」而不是级联删除或拦截
 *
 * `20260819_113218` 定的口径：审计表脱钩保留、纯关系表由钩子删除、有业务含义的
 * 引用拦住不删。封面覆盖三者都不是——它是纯装饰性运营配置，读侧
 * （`lib/frontend/type-card-covers.ts` 的 `mapTypeCardOverrides`）本来就把映射不出
 * 封面的行**逐行丢弃**，自动回落到「站点设置」全局默认 →  该类型首条房源封面。
 * 全局默认那份（`site_settings_type_cards.cover_image_id`）本来就可空，单城覆盖
 * 没有理由更严。
 *
 * ## 影响行数（2026-09-05 本地库实测）
 *
 *   city_site_profiles_type_card_overrides  1 行，全部非空。
 *   本迁移**只放宽约束，不改任何数据**；执行后既有行的封面保持原值。
 *
 * ## 回滚说明
 *
 * `down` 会重新加上 NOT NULL。**若届时已有 media 被删除**，对应覆盖行的
 * `cover_image_id` 会是 NULL，`SET NOT NULL` 将直接失败。回滚前需先决定这些空封面
 * 覆盖行的去留（删行或补图），不要指望 down 能无条件执行——与
 * `20260819_113218` 的回滚约束同理。
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "city_site_profiles_type_card_overrides" ALTER COLUMN "cover_image_id" DROP NOT NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "city_site_profiles_type_card_overrides" ALTER COLUMN "cover_image_id" SET NOT NULL;`)
}
