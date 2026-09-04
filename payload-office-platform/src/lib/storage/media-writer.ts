/**
 * OPT-069 媒体字节的直写/直读通道。
 *
 * ## 为什么需要它（Payload 给不了的两件事）
 *
 * 1. **覆盖写**：水印要盖在 Payload **刚写下**的那些文件上。走 Payload 的
 *    `update({ file })` 会重跑整条管线、再生成一遍干净文件，绕不开。
 * 2. **备份读写**：干净原件存在 `media-source/`，那不是任何 collection 的
 *    存储路径，Payload 的文件路由到不了。
 *
 * ## 为什么不复用 s3Storage 的 adapter
 *
 * `s3Storage(...)` 没有把 adapter 实例暴露出来。与其反射插件内部，不如用同一份
 * `parseCosStorageConfig` 自建一个——**判据同源**，就不会出现「Payload 认为该走
 * COS、shim 认为该走本地」这种分叉。
 *
 * ## 本地 vs COS
 *
 * 本地存储时 Payload 把文件放在 `<配置目录>/media/`（`staticDir` 默认取 collection
 * slug），prefix 不参与路径；COS 上 prefix 是对象键前缀。本 shim 统一按
 * `<root>/<prefix>/<filename>` 组织本地路径，因此本地的 `media/` 恰好对上，
 * `media-source/` 落在同级目录。
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'

import { parseCosStorageConfig } from './cos-config'

/** 干净原件的存放前缀。**必须不可匿名访问**——见 spec §11 待确认项 1。 */
export const MEDIA_SOURCE_PREFIX = 'media-source'

export type MediaWriter = {
  put(args: { prefix: string; filename: string; body: Buffer; mimeType: string }): Promise<void>
  get(args: { prefix: string; filename: string }): Promise<Buffer | null>
}

/**
 * `prefix`（目录名/对象键前缀）与 `filename`（文件名）的合法字符集本可以不同，
 * 但 `..`、绝对路径、`\` 这三类必须两者都拦——本地后端会把它们拼进真实文件系统
 * 路径，放过 `prefix` 会导致目录穿越写到 `rootDir` 外面；COS 后端虽然只是拼字符串
 * 键、没有文件系统语义，但两个后端从调用方看必须同行为，不能一个拦一个不拦。
 */
function assertSafePathSegment(value: string, kind: '文件名' | '前缀'): void {
  if (!value || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(`[media-writer] 非法${kind}：${value}`)
  }
}

export function createLocalMediaWriter(rootDir: string): MediaWriter {
  return {
    async put({ prefix, filename, body }) {
      assertSafePathSegment(prefix, '前缀')
      assertSafePathSegment(filename, '文件名')
      const dir = path.join(rootDir, prefix)
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, filename), body)
    },
    async get({ prefix, filename }) {
      assertSafePathSegment(prefix, '前缀')
      assertSafePathSegment(filename, '文件名')
      try {
        return await readFile(path.join(rootDir, prefix, filename))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
  }
}

function createCosMediaWriter(config: Extract<ReturnType<typeof parseCosStorageConfig>, { enabled: true }>): MediaWriter {
  // 动态 import：本地存储模式下不该为了一个用不上的 shim 把 aws-sdk 拉进内存。
  const clientPromise = import('@aws-sdk/client-s3').then(
    ({ S3Client }) =>
      new S3Client({
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        endpoint: config.endpoint,
        forcePathStyle: false,
        region: config.region,
      }),
  )

  return {
    async put({ prefix, filename, body, mimeType }) {
      assertSafePathSegment(prefix, '前缀')
      assertSafePathSegment(filename, '文件名')
      const { PutObjectCommand } = await import('@aws-sdk/client-s3')
      const client = await clientPromise
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: `${prefix}/${filename}`,
          Body: body,
          ContentType: mimeType,
        }),
      )
    },
    async get({ prefix, filename }) {
      assertSafePathSegment(prefix, '前缀')
      assertSafePathSegment(filename, '文件名')
      const { GetObjectCommand, NoSuchKey } = await import('@aws-sdk/client-s3')
      const client = await clientPromise
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: `${prefix}/${filename}` }),
        )
        const bytes = await result.Body?.transformToByteArray()
        return bytes ? Buffer.from(bytes) : null
      } catch (error) {
        if (error instanceof NoSuchKey) return null
        // COS 对不存在的键也可能直接回 404 而非 NoSuchKey 类型
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
          return null
        }
        throw error
      }
    },
  }
}

/**
 * 按环境选实现。**判据与 `payload.config.ts` 的 `s3Storage({ enabled })` 同源**。
 *
 * @param rootDir 本地存储的根目录，默认取 `payload-office-platform/`。
 */
export function createMediaWriter(
  env: NodeJS.ProcessEnv = process.env,
  rootDir: string = process.cwd(),
): MediaWriter {
  const config = parseCosStorageConfig(env)
  return config.enabled ? createCosMediaWriter(config) : createLocalMediaWriter(rootDir)
}
