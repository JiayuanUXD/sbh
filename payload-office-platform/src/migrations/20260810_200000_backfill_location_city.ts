import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    WITH RECURSIVE tree AS (
      SELECT id, id AS city_id FROM "locations" WHERE "type" = 'city'
      UNION ALL
      SELECT l.id, t.city_id FROM "locations" l JOIN tree t ON l."parent_id" = t.id
    )
    UPDATE "locations" SET "city_id" = tree.city_id
    FROM tree
    WHERE "locations".id = tree.id AND "locations"."type" <> 'city';
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`UPDATE "locations" SET "city_id" = NULL;`)
}