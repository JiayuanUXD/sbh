import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * Read-only gate that must run before the notification compound unique index.
 * It never deletes or rewrites history. A blocked deployment must be remediated
 * from an approved manual checklist and then replayed.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS duplicate_group_count
    FROM (
      SELECT "event_id", "recipient_id", "type"
      FROM "notifications"
      WHERE "event_id" IS NOT NULL
        AND "recipient_id" IS NOT NULL
        AND "type" IS NOT NULL
      GROUP BY "event_id", "recipient_id", "type"
      HAVING count(*) > 1
    ) AS duplicate_groups;
  `)
  const row = result.rows[0] as { duplicate_group_count?: unknown } | undefined
  const duplicateGroupCount = Number(row?.duplicate_group_count ?? 0)

  if (!Number.isFinite(duplicateGroupCount) || duplicateGroupCount > 0) {
    throw new Error(
      `[migration-preflight] ${duplicateGroupCount} duplicate notification key group(s); ` +
        'blocked without deleting history. Run the approved read-only checklist for ' +
        '(event_id, recipient_id, type), remediate manually, then retry.',
    )
  }
}

/** This read-only gate has no schema or data to revert. */
export async function down(_args: MigrateDownArgs): Promise<void> {}
