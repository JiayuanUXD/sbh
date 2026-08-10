import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

const PUBLISH_FILENAME = 'landing-hero-publish-20260810.jpg'
const ENTRUST_FILENAME = 'landing-hero-entrust-20260810.jpg'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    INSERT INTO "media" (
      "alt",
      "url",
      "filename",
      "mime_type",
      "filesize",
      "width",
      "height",
      "focal_x",
      "focal_y",
      "prefix",
      "created_at",
      "updated_at"
    )
    VALUES
      (
        '高端写字楼空置空间与城市天际线背景',
        '/api/media/file/landing-hero-publish-20260810.jpg?prefix=media',
        ${PUBLISH_FILENAME},
        'image/jpeg',
        143907,
        1915,
        821,
        50,
        50,
        'media',
        now(),
        now()
      ),
      (
        '商务选址顾问会议桌与上海天际线背景',
        '/api/media/file/landing-hero-entrust-20260810.jpg?prefix=media',
        ${ENTRUST_FILENAME},
        'image/jpeg',
        125141,
        1915,
        821,
        50,
        50,
        'media',
        now(),
        now()
      )
    ON CONFLICT ("filename") DO UPDATE
    SET
      "alt" = EXCLUDED."alt",
      "url" = EXCLUDED."url",
      "mime_type" = EXCLUDED."mime_type",
      "filesize" = EXCLUDED."filesize",
      "width" = EXCLUDED."width",
      "height" = EXCLUDED."height",
      "focal_x" = EXCLUDED."focal_x",
      "focal_y" = EXCLUDED."focal_y",
      "prefix" = EXCLUDED."prefix",
      "updated_at" = now();
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DELETE FROM "media"
    WHERE "filename" IN (${PUBLISH_FILENAME}, ${ENTRUST_FILENAME});
  `)
}
