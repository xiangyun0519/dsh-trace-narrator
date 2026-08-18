/**
 * 命令参数解析（docs/design.md §8）：手写、零依赖。
 * 支持 --key value、--key=value、布尔 flag；首个位置参数为 sessionId。
 * 未知参数 / 非法枚举 / 越界数值 → 用法错误（退出码 2）。
 * @module dsh-trace-narrator/args
 */

import type { Lang, OutputFormat, RedactLevel } from './config.ts'

export interface NarrateOverrides {
  lang?: Lang
  schema?: string
  redact?: RedactLevel
  format?: OutputFormat
  outputDir?: string
  tokenBudget?: number
  maxTokens?: number
  /** --yes / --no-confirm 均置为 false（跳过确认）。 */
  confirm?: boolean
  /** --upload <endpoint>：显式上报；失败 → exit 8（本地产物仍保留）。 */
  uploadEndpoint?: string
}

export type ParsedArgs =
  | { ok: true; sessionId?: string; overrides: NarrateOverrides; help: boolean }
  | { ok: false; errors: string[] }

const LANGS: readonly Lang[] = ['zh-CN', 'en', 'ja']
const REDACT_LEVELS: readonly RedactLevel[] = ['off', 'minimal', 'standard', 'strict']
const FORMATS: readonly OutputFormat[] = ['html', 'md', 'json']

const VALUE_FLAGS = new Set(['--schema', '--lang', '--redact', '--format', '--output', '--token-budget', '--max-tokens', '--upload'])
const BOOL_FLAGS = new Set(['--yes', '--no-confirm', '--help'])

export function parseArgs(rawInput: string): ParsedArgs {
  const tokens = rawInput.trim().split(/\s+/).filter(token => token.length > 0)
  const errors: string[] = []
  const overrides: NarrateOverrides = {}
  let sessionId: string | undefined
  let help = false

  const setValue = (flag: string, value: string): void => {
    switch (flag) {
      case '--lang':
        if ((LANGS as readonly string[]).includes(value)) overrides.lang = value as Lang
        else errors.push(`--lang 取值非法（应为 zh-CN|en|ja）`)
        break
      case '--redact':
        if ((REDACT_LEVELS as readonly string[]).includes(value)) overrides.redact = value as RedactLevel
        else errors.push(`--redact 取值非法（应为 off|minimal|standard|strict）`)
        break
      case '--format':
        if ((FORMATS as readonly string[]).includes(value)) overrides.format = value as OutputFormat
        else errors.push(`--format 取值非法（应为 html|md|json）`)
        break
      case '--schema':
        if (value.length === 0) errors.push('--schema 不能为空')
        else overrides.schema = value
        break
      case '--output':
        if (value.length === 0) errors.push('--output 不能为空')
        else overrides.outputDir = value
        break
      case '--upload':
        if (value.length === 0) errors.push('--upload 不能为空')
        else overrides.uploadEndpoint = value
        break
      case '--token-budget': {
        const n = Number(value)
        if (Number.isInteger(n) && n >= 3000 && n <= 100000) overrides.tokenBudget = n
        else errors.push('--token-budget 应为 3000-100000 的整数')
        break
      }
      case '--max-tokens': {
        const n = Number(value)
        if (Number.isInteger(n) && n >= 256 && n <= 8192) overrides.maxTokens = n
        else errors.push('--max-tokens 应为 256-8192 的整数')
        break
      }
      /* v8 ignore next -- VALUE_FLAGS 封闭集合 */
      default:
        errors.push(`未知参数：${flag}`)
    }
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? ''
    if (BOOL_FLAGS.has(token)) {
      if (token === '--help') help = true
      else overrides.confirm = false
      continue
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      const flag = eq === -1 ? token : token.slice(0, eq)
      const inline = eq === -1 ? undefined : token.slice(eq + 1)
      if (!VALUE_FLAGS.has(flag)) {
        errors.push(`未知参数：${flag}`)
        continue
      }
      if (inline !== undefined) {
        setValue(flag, inline)
      } else {
        const value = tokens[i + 1]
        if (value === undefined || value.startsWith('--')) {
          errors.push(`${flag} 缺少取值`)
          continue
        }
        i += 1
        setValue(flag, value)
      }
      continue
    }
    // 位置参数
    if (sessionId !== undefined) errors.push('最多一个位置参数（sessionId）')
    else sessionId = token
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, sessionId, overrides, help }
}
