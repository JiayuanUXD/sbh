import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-postgres'

/**
 * `migrate:create` 不会生成局部唯一索引（`WHERE ... IS NOT NULL`）。
 *
 * 目的：同一来源平台下的外部编号（source, externalId）必须唯一，防止导入重复
 * 写入；但绝大多数手工维护的房源/楼盘没有 dataSource，NULL 不参与唯一性约束，
 * 故用局部索引而非普通唯一索引。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS listings_data_source_external_uniq
      ON listings (data_source_source, data_source_external_id)
      WHERE data_source_source IS NOT NULL AND data_source_external_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS buildings_data_source_external_uniq
      ON buildings (data_source_source, data_source_external_id)
      WHERE data_source_source IS NOT NULL AND data_source_external_id IS NOT NULL;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(`
    DROP INDEX IF EXISTS listings_data_source_external_uniq;
    DROP INDEX IF EXISTS buildings_data_source_external_uniq;
  `)
}
