/**
 * 叙述报告模型：narrator（v0.8.0）编排管线后的最终产物，
 * renderer 只消费此类型，不感知任何 DSH 对象。
 * @module dsh-trace-narrator/report
 */

import type { Lang, RedactLevel } from './config.ts'

/** 总结生成状态：ok = 校验通过；其余为降级（docs/design.md §4 降级链）。 */
export type NarratedStatus = 'ok' | 'no-llm' | 'validation-failed'

export interface NarratedReportMeta {
  sessionId: string
  title?: string
  startedAt?: number
  endedAt?: number
  eventCount: number
  droppedEvents: number
  truncated: boolean
  turns: number
  schemaName: string
  lang: Lang
  redactLevel: RedactLevel
  generatedAt: number
}

export interface NarratedReport {
  meta: NarratedReportMeta
  status: NarratedStatus
  /** 校验通过的总结对象（ok 时存在）。 */
  summary?: Record<string, unknown>
  /** validation-failed 时的 LLM 原文（渲染层转义后放入附录）。 */
  rawOutput?: string
  /** 错误记录（展示用；不含任何 secret 原文——脱敏报告保证）。 */
  errors?: string[]
}
