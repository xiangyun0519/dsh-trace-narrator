/**
 * 脱敏管线核心（docs/redaction.md）：
 *  - 确定性占位符：sha256(secret) 前 8 位；同一 secret 同一占位符；
 *    映射表只存内存，绝不序列化。
 *  - 审计只记类别与计数：报告/审计 API 不含任何原文（类型层面无法传入匹配文本）。
 *  - 报告为「累计」语义：同一 Redactor 先 redactScript 再对渲染输出 redactText，
 *    cumulative() 即全部替换统计，直接喂给审计条目。
 * @module dsh-trace-narrator/redaction
 */

import { createHash } from 'node:crypto'
import type { RedactLevel } from '../config.ts'
import type { Script, ScriptStep } from '../script.ts'
import { enabledDetectors } from './detectors.ts'
import type { DetectorId } from './detectors.ts'

export { DETECTORS, enabledDetectors } from './detectors.ts'
export type { Detector, DetectorId } from './detectors.ts'

export interface RedactOptions {
  /** 默认 strict（安全第一）。 */
  level?: RedactLevel
}

export interface DetectorCount {
  id: DetectorId
  count: number
  /** 出现位置（事件/步 seq），最多 20 个；超出则 truncated。 */
  eventSeqs: number[]
  truncated?: boolean
}

export interface RedactionReport {
  level: RedactLevel
  total: number
  detectors: DetectorCount[]
}

export interface Redactor {
  /** 脱敏整个剧本（返回新对象，不修改输入）；报告为累计值。 */
  redactScript(script: Script): { script: Script; report: RedactionReport }
  /** 脱敏任意文本（渲染输出二次脱敏用）；报告为累计值。 */
  redactText(text: string): { text: string; report: RedactionReport }
  /** 累计报告（发送前预览统计 / 审计条目来源）。 */
  cumulative(): RedactionReport
  reset(): void
}

/** DetectorId → 占位符标签（docs/redaction.md §3）。 */
const TYPE_TAGS: Record<DetectorId, string> = {
  'pem': 'PEM',
  'json-secrets': 'JSON_SECRET',
  'urls-token': 'URL_TOKEN',
  'connection-strings': 'CONN',
  'api-keys': 'API_KEY',
  'api-keys-assign': 'API_KEY',
  'jwt': 'JWT',
  'emails': 'EMAIL',
  'ips': 'IP',
  'paths': 'PATH',
  'files': 'FILE',
}

const MAX_SEQS = 20

/**
 * 创建一个脱敏器实例：一次叙述（读→脱敏→LLM→渲染）共用同一实例，
 * 保证剧本与各输出物中同一 secret 的占位符一致。
 */
export function createRedactor(options: RedactOptions = {}): Redactor {
  const level: RedactLevel = options.level ?? 'strict'
  const detectors = enabledDetectors(level)
  /** secret 原文 → 占位符（仅内存，never 序列化）。 */
  const placeholders = new Map<string, string>()
  const counters = new Map<DetectorId, DetectorCount>()

  const placeholder = (id: DetectorId, secret: string): string => {
    let value = placeholders.get(secret)
    if (value === undefined) {
      const hash = createHash('sha256').update(secret).digest('hex').slice(0, 8)
      value = `[REDACTED:${TYPE_TAGS[id]}:${hash}]`
      placeholders.set(secret, value)
    }
    return value
  }

  const record = (id: DetectorId, matches: number, seq?: number): void => {
    if (matches === 0) return
    let entry = counters.get(id)
    if (entry === undefined) {
      entry = { id, count: 0, eventSeqs: [] }
      counters.set(id, entry)
    }
    entry.count += matches
    if (seq !== undefined) {
      for (let i = 0; i < matches; i += 1) {
        if (entry.eventSeqs.length < MAX_SEQS) entry.eventSeqs.push(seq)
        else entry.truncated = true
      }
    }
  }

  const applyTo = (text: string, seq?: number): string => {
    let out = text
    for (const detector of detectors) {
      const result = detector.apply(out, secret => placeholder(detector.id, secret))
      out = result.text
      record(detector.id, result.count, seq)
    }
    return out
  }

  const cumulative = (): RedactionReport => ({
    level,
    total: [...counters.values()].reduce((sum, entry) => sum + entry.count, 0),
    detectors: [...counters.values()],
  })

  return {
    redactScript(script) {
      const steps: ScriptStep[] = script.steps.map(step => {
        const text = applyTo(step.text, step.seq)
        return text === step.text ? step : { ...step, text }
      })
      return { script: { ...script, steps }, report: cumulative() }
    },
    redactText(text) {
      return { text: applyTo(text), report: cumulative() }
    },
    cumulative,
    reset() {
      placeholders.clear()
      counters.clear()
    },
  }
}
