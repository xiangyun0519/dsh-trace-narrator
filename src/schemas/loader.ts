/**
 * 用户自定义 schema 加载（docs/schemas.md §3）。
 * 解析顺序：内置名 → URL → 路径 → 已保存名（$DSH_HOME/schemas/<name>.json）。
 * 所有来源一律过结构安全检查；URL 另加 HTTPS / 10s 超时 / ≤64KB 限制。
 * DI：SchemaSource 由上层注入（生产 = ctx.fs + ctx.web.fetch，v0.8.0 接线）。
 * @module dsh-trace-narrator/schemas/loader
 */

import { join } from 'node:path'
import { BUILTIN_SCHEMAS, isBuiltinName } from './builtin.ts'
import type { JsonSchema } from './builtin.ts'

export type SchemaSourceKind = 'builtin' | 'saved' | 'file' | 'url'

export interface LoadedSchema {
  /** 展示名：内置名 / URL / 路径。 */
  name: string
  kind: SchemaSourceKind
  schema: JsonSchema
  /** 结构检查产生的非致命警告（缺 type/description 等）。 */
  warnings: string[]
}

/** schema 加载失败（映射命令退出码 6，见 docs/design.md §8）。 */
export class SchemaLoadError extends Error {
  readonly code = 'SCHEMA_LOAD_FAILED'

  constructor(
    public readonly spec: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`trace-narrator: schema "${spec}" 加载失败：${message}`)
    this.name = 'SchemaLoadError'
  }
}

/** 可注入的读取源：文件与 URL。 */
export interface SchemaSource {
  readFileText(path: string): Promise<string>
  fetchUrl(url: string, options: { timeoutMs: number; signal: AbortSignal }): Promise<string>
}

export interface LoadSchemaOptions {
  source: SchemaSource
  /** 已解析的 schema 目录（'' 的 settings 默认由上层解析为 $DSH_HOME/schemas）。 */
  schemaDir: string
  signal?: AbortSignal
}

export const URL_TIMEOUT_MS = 10000
export const URL_MAX_BYTES = 65536
const MAX_TOP_LEVEL_PROPERTIES = 30
const MAX_DEPTH = 5
const SAVED_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export function isUrlSpec(spec: string): boolean {
  return /^https?:\/\//i.test(spec)
}

function looksLikePath(spec: string): boolean {
  return spec.startsWith('.') || spec.includes('/') || spec.includes('\\') || /^[A-Za-z]:/.test(spec)
}

/** 进程级缓存：同一 spec 只加载一次（URL 尤其需要）。 */
const cache = new Map<string, Promise<LoadedSchema>>()

export function clearSchemaCache(): void {
  cache.clear()
}

export async function loadSchema(spec: string, options: LoadSchemaOptions): Promise<LoadedSchema> {
  let task = cache.get(spec)
  if (task === undefined) {
    task = doLoad(spec, options)
    cache.set(spec, task)
  }
  try {
    // 每次返回 fresh 深拷贝：调用方改坏副本不会污染缓存（后续加载仍拿到原始 schema）。
    const loaded = await task
    return { ...loaded, schema: structuredClone(loaded.schema), warnings: [...loaded.warnings] }
  } catch (error) {
    cache.delete(spec)
    throw error
  }
}

async function doLoad(spec: string, options: LoadSchemaOptions): Promise<LoadedSchema> {
  try {
    if (isBuiltinName(spec)) {
      return { name: spec, kind: 'builtin', schema: structuredClone(BUILTIN_SCHEMAS[spec]), warnings: [] }
    }
    let raw: string
    let name: string
    let kind: SchemaSourceKind
    if (isUrlSpec(spec)) {
      if (!/^https:\/\//i.test(spec)) throw new SchemaLoadError(spec, 'URL 必须是 HTTPS')
      const timeout = AbortSignal.timeout(URL_TIMEOUT_MS)
      const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
      raw = await options.source.fetchUrl(spec, { timeoutMs: URL_TIMEOUT_MS, signal })
      if (Buffer.byteLength(raw, 'utf8') > URL_MAX_BYTES) {
        throw new SchemaLoadError(spec, `超过 ${URL_MAX_BYTES} 字节上限`)
      }
      name = spec
      kind = 'url'
    } else if (looksLikePath(spec)) {
      raw = await options.source.readFileText(spec)
      name = spec
      kind = 'file'
    } else {
      if (!SAVED_NAME.test(spec)) {
        throw new SchemaLoadError(spec, `已保存 schema 名必须匹配 ${String(SAVED_NAME)}`)
      }
      const path = join(options.schemaDir, `${spec}.json`)
      raw = await options.source.readFileText(path)
      name = path
      kind = 'saved'
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new SchemaLoadError(spec, `JSON 解析失败：${String(error)}`)
    }
    const warnings: string[] = []
    checkStructure(parsed, spec, warnings)
    return { name, kind, schema: parsed as JsonSchema, warnings }
  } catch (error) {
    if (error instanceof SchemaLoadError) throw error
    throw new SchemaLoadError(spec, String(error), error)
  }
}

/**
 * 结构安全检查（docs/schemas.md §3，任何来源一律执行）：
 * 根 object、声明 properties、≤30 顶层属性、嵌套深度 ≤5、拒绝一切 $ref；
 * 字段缺 type / description 记为警告。
 */
export function checkStructure(value: unknown, spec: string, warnings: string[]): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SchemaLoadError(spec, '根必须是 JSON Schema 对象')
  }
  const root = value as Record<string, unknown>
  if (root.type !== 'object') throw new SchemaLoadError(spec, '根必须是 type: "object"')
  const props = root.properties
  if (props === null || typeof props !== 'object' || Array.isArray(props)) {
    throw new SchemaLoadError(spec, '根必须声明 properties')
  }
  const keys = Object.keys(props)
  if (keys.length > MAX_TOP_LEVEL_PROPERTIES) {
    throw new SchemaLoadError(spec, `顶层属性 ${keys.length} 个，超过上限 ${MAX_TOP_LEVEL_PROPERTIES}`)
  }
  for (const key of keys) {
    const field = (props as Record<string, unknown>)[key]
    if (field === null || typeof field !== 'object') {
      throw new SchemaLoadError(spec, `字段 "${key}" 必须是对象`)
    }
    const f = field as Record<string, unknown>
    if (f.type === undefined) warnings.push(`字段 "${key}" 缺少 type`)
    if (typeof f.description !== 'string' || f.description.length === 0) {
      warnings.push(`字段 "${key}" 缺少 description（description 会进入提示词，强烈建议补充）`)
    }
  }
  walk(value, 1, spec)
}

function walk(node: unknown, depth: number, spec: string): void {
  if (depth > MAX_DEPTH) throw new SchemaLoadError(spec, `嵌套深度超过 ${MAX_DEPTH}`)
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, depth, spec)
    return
  }
  const obj = node as Record<string, unknown>
  if (obj.$ref !== undefined) throw new SchemaLoadError(spec, `v1 不支持 $ref（${String(obj.$ref)}）`)
  const props = obj.properties
  if (props !== null && typeof props === 'object' && !Array.isArray(props)) {
    for (const child of Object.values(props)) walk(child, depth + 1, spec)
  }
  const items = obj.items
  if (items !== null && typeof items === 'object' && !Array.isArray(items)) {
    walk(items, depth + 1, spec)
  } else if (Array.isArray(items)) {
    for (const child of items) walk(child, depth + 1, spec)
  }
}
