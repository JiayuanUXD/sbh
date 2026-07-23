import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { s3Storage } from '@payloadcms/storage-s3'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Amenities } from './collections/Amenities'
import { Buildings } from './collections/Buildings'
import { Leads } from './collections/Leads'
import { Listings } from './collections/Listings'
import { Locations } from './collections/Locations'
import { Pages } from './collections/Pages'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// 生产 / CloudBase：设了 postgres:// 连接串 → 用 PostgreSQL（TencentDB）
// 本地开发：不设 DATABASE_URL → 用 SQLite 本地文件，零外部依赖
const databaseUrl = process.env.DATABASE_URL || ''
const usePostgres = databaseUrl.startsWith('postgres')

// SQLite 本地文件路径（放在项目根目录，已在 .gitignore 忽略）
const sqliteFilePath = path.resolve(dirname, '..', 'payload.db.sqlite').replace(/\\/g, '/')

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media, Locations, Amenities, Buildings, Listings, Leads, Pages],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'local-dev-secret-change-me',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: usePostgres
    ? postgresAdapter({
        pool: {
          connectionString: databaseUrl,
        },
        // CloudBase PG 是共享库，public schema 里除 Payload 表外还有腾讯云拨测表
        // (tencentdb_tbl_dial_test_*)。dev 模式下 Payload 默认会 pushDevSchema 扫全库，
        // 发现“多余”表会提示 DROP 并在非 TTY 下卡死。共享库一律只走显式迁移，禁止 dev push。
        push: false,
      })
    : sqliteAdapter({
        client: {
          url: `file:${sqliteFilePath}`,
        },
      }),
  sharp,
  plugins: [
    s3Storage({
      enabled: Boolean(process.env.S3_BUCKET),
      collections: {
        media: true,
      },
      bucket: process.env.S3_BUCKET || '',
      config: {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
        },
        region: process.env.S3_REGION || '',
        endpoint: process.env.S3_ENDPOINT || '',
        forcePathStyle: true,
      },
    }),
  ],
})
