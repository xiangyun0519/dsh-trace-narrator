/**
 * LLM 输出校验（docs/schemas.md §4）：
 *   剥围栏 → 提取 JSON（首 { 到末 }）→ 删未知键（additionalProperties:false 语义）
 *   → ajv 严格校验（draft 2020-12）。
 * 校验失败返回结构化错误文本，供 v0.6.0 重试回喂。
 * @module dsh-trace-narrator/schemas/validate
 */

import Ajv2020 from 'ajv/dist/2020'
import type { ErrorObject } from 'ajv'
import type { JsonSchema } from './builtin.ts'

export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: string[] }

const ajv = new Ajv2020({ strict: true, allErrors: true })

/**
 * 从 LLM 输出文本提取 JSON：
 * 支持 ```json 围栏（首尾）、前后杂文（定位第一个 { 与最后一个 }）。
 */
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let candidate = text.trim()
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i.exec(candidate)
  if (fence?.[1] !== undefined) candidate = fence[1].trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, error: '未找到 JSON 对象（{...}）' }
  }
  try {
    return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)) }
  } catch (error) {
    return { ok: false, error: `JSON 解析失败：${String(error)}` }
  }
}

/**
 * 按 schema 删除未知键（additionalProperties:false 的清理语义），
 * 递归处理嵌套对象与数组 items；深度上限与 loader 对齐。
 */
export function stripUnknownKeys(value: unknown, schema: JsonSchema, depth = 0): unknown {
  if (depth > 5) return value
  if (Array.isArray(value)) {
    const itemSchema = schema.items !== null && typeof schema.items === 'object' && !Array.isArray(schema.items)
      ? schema.items as JsonSchema
      : {}
    return value.map(item => stripUnknownKeys(item, itemSchema, depth + 1))
  }
  if (value === null || typeof value !== 'object') return value
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (!(key in properties)) continue
    out[key] = stripUnknownKeys(child, properties[key] ?? {}, depth + 1)
  }
  return out
}

/** 校验一份 LLM 输出：先清理未知键，再严格校验。 */
export function validateOutput(raw: string, schema: JsonSchema): ValidationResult {
  const parsed = extractJson(raw)
  if (!parsed.ok) return { ok: false, errors: [parsed.error] }
  if (parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return { ok: false, errors: ['输出必须是 JSON 对象'] }
  }
  const cleaned = stripUnknownKeys(parsed.value, schema) as Record<string, unknown>
  const valid = ajv.validate(schema, cleaned)
  if (valid) return { ok: true, value: cleaned }
  return { ok: false, errors: formatErrors(ajv.errors) }
}

/** ajv 错误 → 可读文本（重试回喂用；附 keyword 便于模型定位约束类型）。 */
export function formatErrors(errors: readonly ErrorObject[] | null | undefined): string[] {
  if (errors === null || errors === undefined) return []
  return errors.map(error =>
    `${error.instancePath === '' ? '根' : error.instancePath}: ${error.message ?? '校验失败'} (${error.keyword})`)
}
