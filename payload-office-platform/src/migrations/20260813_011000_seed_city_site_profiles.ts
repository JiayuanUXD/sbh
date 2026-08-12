import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

type CitySiteProfileSeed = {
  cityCodes: readonly string[]
  serviceStatus: 'live' | 'coming-soon'
  sortOrder: number
  seoTitle: string
  seoDescription: string
  heroEyebrow: null | string
  heroHeading: null | string
  heroBody: null | string
}

type ResolvedCity = {
  id: number
}

const shanghaiCopy = {
  seoTitle: '上海中高端商务办公租赁与写字楼选址平台',
  seoDescription:
    '商办租赁汇聚上海核心商务区、中高端写字楼、服务式办公室、共享办公与整层办公资源，帮助企业按区域、面积和预算筛选，并可提交需求获得选址协助，由运营团队核验后跟进。',
  heroEyebrow: 'Shanghai Premium Office Leasing',
  heroHeading: '汇聚高端商务空间，赋能企业卓越成长',
  heroBody: '覆盖核心商务区、总部型整层、精装办公与高规格写字楼资源，帮企业更快完成选址决策',
} as const

const comingSoonCopy = (cityName: string) => ({
  seoTitle: `${cityName}办公室租赁与写字楼选址`,
  seoDescription: `商办租赁为您提供${cityName}办公室租赁、写字楼与共享办公选址服务，覆盖重点商务区域与楼宇信息；可提交企业选址需求、发布本地房源或申请成为城市合伙人，由运营团队核验后跟进。`,
})

const citySiteProfileSeeds: readonly CitySiteProfileSeed[] = [
  {
    cityCodes: ['LEGACY_LOC_1', 'CITY-SH', 'SH'],
    serviceStatus: 'live',
    sortOrder: 10,
    ...shanghaiCopy,
  },
  {
    cityCodes: ['CITY-HZ'],
    serviceStatus: 'coming-soon',
    sortOrder: 20,
    ...comingSoonCopy('杭州'),
    heroEyebrow: null,
    heroHeading: null,
    heroBody: null,
  },
  {
    cityCodes: ['CITY-NB'],
    serviceStatus: 'coming-soon',
    sortOrder: 30,
    ...comingSoonCopy('宁波'),
    heroEyebrow: null,
    heroHeading: null,
    heroBody: null,
  },
  {
    cityCodes: ['CITY-SZ'],
    serviceStatus: 'coming-soon',
    sortOrder: 40,
    ...comingSoonCopy('苏州'),
    heroEyebrow: null,
    heroHeading: null,
    heroBody: null,
  },
  {
    cityCodes: ['CITY-NJ'],
    serviceStatus: 'coming-soon',
    sortOrder: 50,
    ...comingSoonCopy('南京'),
    heroEyebrow: null,
    heroHeading: null,
    heroBody: null,
  },
  {
    cityCodes: ['CITY-JX'],
    serviceStatus: 'coming-soon',
    sortOrder: 60,
    ...comingSoonCopy('嘉兴'),
    heroEyebrow: null,
    heroHeading: null,
    heroBody: null,
  },
  {
    cityCodes: ['CITY-WX'],
    serviceStatus: 'coming-soon',
    sortOrder: 70,
    ...comingSoonCopy('无锡'),
    heroEyebrow: null,
    heroHeading: null,
    heroBody: null,
  },
]

function profileMatchesSeed(
  profile: Record<string, unknown>,
  city: ResolvedCity,
  seed: CitySiteProfileSeed,
): boolean {
  return (
    profile.city_id === city.id &&
    profile.service_status === seed.serviceStatus &&
    profile.switcher_visible === true &&
    Number(profile.sort_order) === seed.sortOrder &&
    profile.seo_title === seed.seoTitle &&
    profile.seo_description === seed.seoDescription &&
    profile.hero_eyebrow === seed.heroEyebrow &&
    profile.hero_heading === seed.heroHeading &&
    profile.hero_body === seed.heroBody
  )
}

/**
 * Payload invokes each migration inside a PostgreSQL transaction. Each city is resolved
 * by immutable code, then either inserted once or checked byte-for-byte before being skipped.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const seed of citySiteProfileSeeds) {
    const cityCodePredicates = seed.cityCodes.map(
      (cityCode) => sql`"immutable_code" = ${cityCode}`,
    )
    const cityCodeLabel = seed.cityCodes.join(', ')
    const cityResult = await db.execute(sql<ResolvedCity>`
        SELECT "id"
        FROM "locations"
        WHERE (${sql.join(cityCodePredicates, sql` OR `)})
          AND "type" = 'city';
    `)

    if (cityResult.rows.length !== 1) {
      throw new Error(
        `city_site_profile_seed_conflict: immutable city codes ${cityCodeLabel} matched ${cityResult.rows.length} city rows`,
      )
    }

    const cityRow = cityResult.rows[0]
    if (!cityRow || typeof cityRow.id !== 'number') {
      throw new Error(`city_site_profile_seed_conflict: immutable city codes ${cityCodeLabel} did not resolve`)
    }
    const city: ResolvedCity = { id: cityRow.id }

    const profileResult = await db.execute(sql`
        SELECT
          "city_id",
          "service_status",
          "switcher_visible",
          "sort_order",
          "seo_title",
          "seo_description",
          "hero_eyebrow",
          "hero_heading",
          "hero_body"
        FROM "city_site_profiles"
        WHERE "city_id" = ${city.id};
    `)

    if (profileResult.rows.length > 1) {
        throw new Error(
          `city_site_profile_seed_conflict: city ${cityCodeLabel} has ${profileResult.rows.length} profiles`,
      )
    }

    const existingProfile = profileResult.rows[0]
    if (existingProfile) {
      if (!profileMatchesSeed(existingProfile, city, seed)) {
        throw new Error(`city_site_profile_seed_conflict: content mismatch for ${cityCodeLabel}`)
      }
      continue
    }

    await db.execute(sql`
        INSERT INTO "city_site_profiles" (
          "city_id",
          "service_status",
          "switcher_visible",
          "sort_order",
          "seo_title",
          "seo_description",
          "hero_eyebrow",
          "hero_heading",
          "hero_body",
          "created_at",
          "updated_at"
        ) VALUES (
          ${city.id},
          ${seed.serviceStatus},
          true,
          ${seed.sortOrder},
          ${seed.seoTitle},
          ${seed.seoDescription},
          ${seed.heroEyebrow},
          ${seed.heroHeading},
          ${seed.heroBody},
          now(),
          now()
        );
    `)
  }
}

/**
 * Deleting profiles after operations may have edited them is unsafe. A full rollback
 * immediately continues to the preceding generated schema migration, which drops the new table.
 */
export async function down(_args: MigrateDownArgs): Promise<void> {}
