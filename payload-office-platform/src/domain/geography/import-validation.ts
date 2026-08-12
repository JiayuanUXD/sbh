/**
 * 地理种子文件校验（纯函数层，Task 19）
 *
 * 不依赖 payload / req，可单测。职责：
 *   - 剥离种子文件注释（// 行注释与块注释）
 *   - 解析为 SeedFile 结构
 *   - 文件内校验：必需字段、code 格式、坐标范围、code/slug 全局唯一、
 *     商圈 districtCode 层级引用可解析、sortOrder 非负整数
 *
 * 与 DB 的交互（按 immutableCode 幂等 / 冲突比对）留在 scripts/import-geography.ts。
 * 组合写侧校验由 protectLocation hook 承担，本层只做「写之前」的结构与格式把关。
 *
 * 命名规范见 docs/geography-code-convention.md；schema 见 seed/geography/schema.md。
 */

import {
  isValidLatitude,
  isValidLongitude,
  isValidRegionCode,
} from '@/domain/geography/location-hierarchy'

// —— 种子文件结构 ——

export type SeedNodeBase = {
  name: string
  immutableCode: string
  slug: string
  centerLatitude?: number | null
  centerLongitude?: number | null
  sortOrder?: number
  /**
   * 存量对账别名（「存量为准、只补差集」策略，审核修复 P0-1）。
   *
   * 库里已有的历史节点往往用的是旧编码（如上海静安区存量码 `SH-JINGAN`，
   * 而本规范是 `SH-D-310106`）。导入时若只按 immutableCode 匹配，会把同一个
   * 现实对象当成新节点再建一遍，产生「重复双树」。
   *
   * 在此显式列出该节点对应的存量编码，导入器命中后**沿用存量节点**：
   * 不改名、不改码、不改 slug，只把它作为下级节点的父级。
   *
   * 刻意要求人工显式声明而非按名称模糊匹配——地理节点改名后果重，
   * 宁可 dry-run 报「未认领存量节点」让人补，也不自动猜。
   */
  legacyCodes?: string[]
}

export type SeedCity = SeedNodeBase

export type SeedDistrict = SeedNodeBase

/** 商圈：靠 districtCode（immutableCode 引用）挂到行政区 */
export type SeedBusinessArea = SeedNodeBase & { districtCode: string }

export type SeedStation = SeedNodeBase

export type SeedMetroLine = SeedNodeBase & { stations?: SeedStation[] }

export type SeedFile = {
  city: SeedCity
  districts: SeedDistrict[]
  businessAreas: SeedBusinessArea[]
  metroLines: SeedMetroLine[]
}

// —— 校验结果类型 ——

export type ImportValidationIssue = {
  /** 稳定机器码，供脚本汇总与测试断言 */
  code: string
  /** 定位，如 city / districts[0] / metroLines[1].stations[2] */
  path: string
  message: string
  value?: unknown
}

// —— 注释剥离与解析 ——

/**
 * 剥离 // 行注释与 /* *​/ 块注释（种子文件头说明用）。
 * 仅按行剥离 //，避免误伤字符串内的 //（本类种子数据不含 URL，可接受）。
 */
export function stripJsonComments(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

/** 剥离注释后 JSON.parse；解析失败抛错（带原始信息）。 */
export function parseSeedJson(raw: string): unknown {
  const stripped = stripJsonComments(raw)
  assertNoDuplicateKeys(stripped)
  return JSON.parse(stripped)
}

/**
 * 重复键检测：`JSON.parse` 对同一对象里重复出现的键**静默取最后一个**，
 * 前面的值无声消失。种子文件是人工 + 脚本混合维护的，很容易出现同一节点被
 * 两次写入 `legacyCodes` 这类情况（真实发生过：先按本地存量写了一遍别名，
 * 后按生产存量又写了一遍，结果生产别名被本地别名覆盖，导入会挂错父级树）。
 *
 * `JSON.parse` 的 reviver 拿不到重复键（此时已被覆盖），故用最小状态机扫描
 * 原始文本，按对象层级收集键名。只关心对象键，数组与字符串内容跳过。
 */
export function assertNoDuplicateKeys(json: string): void {
  const stack: Array<Set<string>> = []
  let i = 0
  const n = json.length
  while (i < n) {
    const ch = json[i]
    if (ch === '"') {
      // 读一个完整字符串（处理转义）
      let j = i + 1
      let out = ''
      while (j < n) {
        if (json[j] === '\\') {
          out += json[j + 1] ?? ''
          j += 2
          continue
        }
        if (json[j] === '"') break
        out += json[j]
        j += 1
      }
      // 判断它是不是对象键：跳过空白后下一个非空白字符是冒号
      let k = j + 1
      while (k < n && /\s/.test(json[k])) k += 1
      if (json[k] === ':' && stack.length > 0) {
        const scope = stack[stack.length - 1]
        if (scope.has(out)) {
          throw new Error(
            `种子文件存在重复键「${out}」——JSON.parse 会静默丢弃前一个值，必须先去重再导入`,
          )
        }
        scope.add(out)
      }
      i = j + 1
      continue
    }
    if (ch === '{') stack.push(new Set())
    else if (ch === '}') stack.pop()
    i += 1
  }
}

/** 把弱类型解析结果归一为 SeedFile；结构错误以 issue 形式返回（不校验业务字段）。 */
export function coerceSeedFile(value: unknown): { file?: SeedFile; issues: ImportValidationIssue[] } {
  const issues: ImportValidationIssue[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      issues: [
        { code: 'SEED_NOT_OBJECT', path: '$', message: '种子文件顶层必须是对象（含 city/districts/businessAreas/metroLines）' },
      ],
    }
  }
  const raw = value as Record<string, unknown>

  const obj = (v: unknown, path: string): Record<string, unknown> | null =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  const arr = (v: unknown, path: string): unknown[] | null =>
    Array.isArray(v) ? v : null

  const file: SeedFile = {
    // 顶层字段缺失时给空默认，统一由 validateSeedFile 的必需字段检查兜底
    city: (obj(raw.city, 'city') ?? {}) as SeedCity,
    districts: (arr(raw.districts, 'districts') ?? []).flatMap((d, i) => (obj(d, `districts[${i}]`) ? [d as SeedDistrict] : [])),
    businessAreas: (arr(raw.businessAreas, 'businessAreas') ?? []).flatMap((b, i) => (obj(b, `businessAreas[${i}]`) ? [b as SeedBusinessArea] : [])),
    metroLines: (arr(raw.metroLines, 'metroLines') ?? []).flatMap((m, i) => (obj(m, `metroLines[${i}]`) ? [m as SeedMetroLine] : [])),
  }
  return { file, issues }
}

// —— 业务校验 ——

const NON_NEGATIVE_INT = /^\d+$/

function checkNodeBase(base: SeedNodeBase, path: string, issues: ImportValidationIssue[]): void {
  // 必需字段
  for (const key of ['name', 'immutableCode', 'slug'] as const) {
    if (typeof base[key] !== 'string' || base[key].trim() === '') {
      issues.push({ code: 'MISSING_FIELD', path, message: `缺少必需字段 ${key}`, value: base[key] })
    }
  }
  // code 格式
  if (typeof base.immutableCode === 'string' && !isValidRegionCode(base.immutableCode)) {
    issues.push({
      code: 'INVALID_REGION_CODE',
      path,
      message: `区域代码格式非法：${base.immutableCode}`,
      value: base.immutableCode,
    })
  }
  // 存量对账别名：必须是字符串数组、格式合法、且不等于自身 code
  if (base.legacyCodes !== undefined) {
    if (!Array.isArray(base.legacyCodes)) {
      issues.push({
        code: 'INVALID_LEGACY_CODES',
        path,
        message: 'legacyCodes 必须是字符串数组',
        value: base.legacyCodes,
      })
    } else {
      base.legacyCodes.forEach((code, i) => {
        if (typeof code !== 'string' || !isValidRegionCode(code)) {
          issues.push({
            code: 'INVALID_LEGACY_CODE',
            path: `${path}.legacyCodes[${i}]`,
            message: `存量别名代码格式非法：${String(code)}`,
            value: code,
          })
        } else if (code === base.immutableCode) {
          issues.push({
            code: 'LEGACY_CODE_SELF',
            path: `${path}.legacyCodes[${i}]`,
            message: `存量别名不能等于自身 immutableCode：${code}`,
            value: code,
          })
        }
      })
    }
  }
  // 坐标：必须成对且在范围
  const lat = base.centerLatitude
  const lng = base.centerLongitude
  const hasLat = lat !== null && lat !== undefined
  const hasLng = lng !== null && lng !== undefined
  if (hasLat !== hasLng) {
    issues.push({ code: 'COORDINATE_INCOMPLETE', path, message: '中心坐标必须同时填写经度和纬度' })
  } else if (hasLat && hasLng) {
    if (typeof lat !== 'number' || !isValidLatitude(lat)) {
      issues.push({ code: 'INVALID_LATITUDE', path, message: `纬度必须在 -90 ~ 90 之间：${String(lat)}`, value: lat })
    }
    if (typeof lng !== 'number' || !isValidLongitude(lng)) {
      issues.push({ code: 'INVALID_LONGITUDE', path, message: `经度必须在 -180 ~ 180 之间：${String(lng)}`, value: lng })
    }
  }
  // sortOrder：若填则必须非负整数
  if (base.sortOrder !== null && base.sortOrder !== undefined) {
    if (typeof base.sortOrder !== 'number' || !Number.isInteger(base.sortOrder) || base.sortOrder < 0) {
      issues.push({ code: 'INVALID_SORT_ORDER', path, message: `排序必须为非负整数：${String(base.sortOrder)}`, value: base.sortOrder })
    }
  }
}

/**
 * 校验整个种子文件，返回 issue 列表（空 = 通过）。
 * 任一 issue 即整文件拒绝（Task 19：不做部分导入）。
 */
export function validateSeedFile(input: unknown): ImportValidationIssue[] {
  const { file, issues } = coerceSeedFile(input)
  if (!file) return issues

  // 城市
  checkNodeBase(file.city, 'city', issues)

  // 行政区
  file.districts.forEach((d, i) => checkNodeBase(d, `districts[${i}]`, issues))

  // 商圈：districtCode 必须解析到文件内行政区
  file.businessAreas.forEach((b, i) => {
    checkNodeBase(b, `businessAreas[${i}]`, issues)
    if (typeof b.districtCode !== 'string' || b.districtCode.trim() === '') {
      issues.push({ code: 'MISSING_FIELD', path: `businessAreas[${i}]`, message: '缺少必需字段 districtCode', value: b.districtCode })
    }
  })

  // 地铁线路与站点
  file.metroLines.forEach((m, i) => {
    checkNodeBase(m, `metroLines[${i}]`, issues)
    ;(m.stations ?? []).forEach((s, j) => checkNodeBase(s, `metroLines[${i}].stations[${j}]`, issues))
  })

  // —— 文件内唯一性：immutableCode 与 slug 必须全局唯一（含站点）——
  const codeSeen = new Map<string, string>()
  const slugSeen = new Map<string, string>()
  const record = (code: string | undefined, slug: string | undefined, path: string) => {
    if (typeof code === 'string' && code !== '') {
      if (codeSeen.has(code)) {
        issues.push({ code: 'DUP_IMMUTABLE_CODE', path, message: `immutableCode 重复：${code}（亦见于 ${codeSeen.get(code)}）`, value: code })
      } else {
        codeSeen.set(code, path)
      }
    }
    if (typeof slug === 'string' && slug !== '') {
      if (slugSeen.has(slug)) {
        issues.push({ code: 'DUP_SLUG', path, message: `slug 重复：${slug}（亦见于 ${slugSeen.get(slug)}）`, value: slug })
      } else {
        slugSeen.set(slug, path)
      }
    }
  }
  record(file.city.immutableCode, file.city.slug, 'city')
  file.districts.forEach((d, i) => record(d.immutableCode, d.slug, `districts[${i}]`))
  file.businessAreas.forEach((b, i) => record(b.immutableCode, b.slug, `businessAreas[${i}]`))
  file.metroLines.forEach((m, i) => {
    record(m.immutableCode, m.slug, `metroLines[${i}]`)
    ;(m.stations ?? []).forEach((s, j) =>
      record(s.immutableCode, s.slug, `metroLines[${i}].stations[${j}]`),
    )
  })

  // —— 存量别名唯一性：同一个存量编码不能被两个种子节点认领，也不能撞上文件内的 immutableCode ——
  const legacySeen = new Map<string, string>()
  const recordLegacy = (node: SeedNodeBase | undefined, path: string) => {
    for (const code of node?.legacyCodes ?? []) {
      if (typeof code !== 'string' || code === '') continue
      if (codeSeen.has(code)) {
        issues.push({
          code: 'LEGACY_CODE_COLLIDES_WITH_CODE',
          path,
          message: `存量别名 ${code} 与文件内 immutableCode 冲突（见 ${codeSeen.get(code)}）`,
          value: code,
        })
      } else if (legacySeen.has(code)) {
        issues.push({
          code: 'DUP_LEGACY_CODE',
          path,
          message: `存量别名重复认领：${code}（亦见于 ${legacySeen.get(code)}）`,
          value: code,
        })
      } else {
        legacySeen.set(code, path)
      }
    }
  }
  recordLegacy(file.city, 'city')
  file.districts.forEach((d, i) => recordLegacy(d, `districts[${i}]`))
  file.businessAreas.forEach((b, i) => recordLegacy(b, `businessAreas[${i}]`))
  file.metroLines.forEach((m, i) => {
    recordLegacy(m, `metroLines[${i}]`)
    ;(m.stations ?? []).forEach((s, j) => recordLegacy(s, `metroLines[${i}].stations[${j}]`))
  })

  // —— 层级引用：商圈 districtCode 必须指向文件内存在的行政区 (否则写侧 hook 会 PARENT 解析失败) ——
  const districtCodes = new Set(file.districts.map((d) => d.immutableCode))
  file.businessAreas.forEach((b, i) => {
    if (typeof b.districtCode === 'string' && b.districtCode !== '' && !districtCodes.has(b.districtCode)) {
      issues.push({
        code: 'BROKEN_DISTRICT_REF',
        path: `businessAreas[${i}]`,
        message: `districtCode 指向不存在的行政区：${b.districtCode}`,
        value: b.districtCode,
      })
    }
  })

  return issues
}