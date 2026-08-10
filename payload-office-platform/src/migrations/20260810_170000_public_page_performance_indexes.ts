import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "articles_public_list_idx"
    ON "articles" USING btree ("published_at" DESC NULLS LAST, "id" DESC)
    WHERE "status" = 'published' AND "deleted_at" IS NULL;

    CREATE INDEX IF NOT EXISTS "articles_public_category_list_idx"
    ON "articles" USING btree ("category", "published_at" DESC NULLS LAST, "id" DESC)
    WHERE "status" = 'published' AND "deleted_at" IS NULL;

    CREATE INDEX IF NOT EXISTS "listings_public_search_base_idx"
    ON "listings" USING btree ("id")
    WHERE
      "publication_status" = 'published'
      AND "review_status" = 'approved'
      AND "supply_visibility_hold" = 'normal'
      AND "deleted_at" IS NULL;

    CREATE INDEX IF NOT EXISTS "listings_public_type_idx"
    ON "listings" USING btree ("listing_type", "id")
    WHERE
      "publication_status" = 'published'
      AND "review_status" = 'approved'
      AND "supply_visibility_hold" = 'normal'
      AND "deleted_at" IS NULL;

    CREATE INDEX IF NOT EXISTS "listings_public_area_idx"
    ON "listings" USING btree ("area", "id")
    WHERE
      "publication_status" = 'published'
      AND "review_status" = 'approved'
      AND "supply_visibility_hold" = 'normal'
      AND "deleted_at" IS NULL;

    CREATE INDEX IF NOT EXISTS "listings_public_rent_idx"
    ON "listings" USING btree ("rent_unit", "rent", "id")
    WHERE
      "publication_status" = 'published'
      AND "review_status" = 'approved'
      AND "supply_visibility_hold" = 'normal'
      AND "deleted_at" IS NULL;

    CREATE INDEX IF NOT EXISTS "listings_public_available_idx"
    ON "listings" USING btree ("available_from", "id")
    WHERE
      "publication_status" = 'published'
      AND "review_status" = 'approved'
      AND "supply_visibility_hold" = 'normal'
      AND "deleted_at" IS NULL;

    CREATE INDEX IF NOT EXISTS "listings_public_building_idx"
    ON "listings" USING btree ("building_id", "id")
    WHERE
      "publication_status" = 'published'
      AND "review_status" = 'approved'
      AND "supply_visibility_hold" = 'normal'
      AND "deleted_at" IS NULL;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "listings_public_building_idx";
    DROP INDEX IF EXISTS "listings_public_available_idx";
    DROP INDEX IF EXISTS "listings_public_rent_idx";
    DROP INDEX IF EXISTS "listings_public_area_idx";
    DROP INDEX IF EXISTS "listings_public_type_idx";
    DROP INDEX IF EXISTS "listings_public_search_base_idx";
    DROP INDEX IF EXISTS "articles_public_category_list_idx";
    DROP INDEX IF EXISTS "articles_public_list_idx";
  `)
}
