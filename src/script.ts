/**
 * 剧本（script）：事件流投影压缩后的中间表示。
 * 发给 LLM 前必须已经过脱敏管线（docs/redaction.md）；预算截断必须在脱敏之后。
 * @module dsh-trace-narrator/script
 */

export type ScriptLang = 'zh-CN' | 'en'

export type ScriptStepKind = 'user' | 'assistant' | 'tool-call' | 'tool-result' | 'boundary' | 'note'

export interface ScriptStep {
  /** 源事件 seq（预算窗口标记行取其后继窗口首个 seq）。 */
  seq: number
  kind: ScriptStepKind
  text: string
  /** 文本被截断时为 true（预算阶梯产物）。 */
  truncated?: boolean
}

export interface ScriptMeta {
  sessionId: string
  /** 会话标题（由上层经 sessionTitle 服务取得，v0.8.0 接线）。 */
  title?: string
  /** 首/末事件时间戳（毫秒）。 */
  startedAt?: number
  endedAt?: number
  eventCount: number
  /** 被丢弃的事件数：结构忽略 + 空文本行 + 预算丢弃的 note/窗口行。 */
  droppedEvents: number
  /** 是否发生过任何预算截断。 */
  truncated: boolean
  turns: number
}

export interface Script {
  meta: ScriptMeta
  steps: ScriptStep[]
}

/**
 * 与 @deepseek-ai/dsh-token-meter 一致的固定密度估算（chars/4）。
 * 平台启发式还有每块 +4 的结构开销；此处按行计，行开销由 compressor 另加。
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** 剧本 chrome 文案（与 LLM 输出语言一致）。 */
export interface ScriptChrome {
  turnStart(turn: number): string
  turnEnd(turn: number, reason: string): string
  truncationNote(droppedSteps: number): string
  middleOmitted(): string
}

export function scriptChrome(lang: ScriptLang = 'zh-CN'): ScriptChrome {
  if (lang === 'en') {
    return {
      turnStart: turn => `--- turn ${turn} ---`,
      turnEnd: (turn, reason) => `--- turn ${turn} ended (${reason}) ---`,
      truncationNote: dropped => `... (${dropped} lines truncated) ...`,
      middleOmitted: () => '... (middle omitted) ...',
    }
  }
  return {
    turnStart: turn => `—— 第 ${turn} 轮 ——`,
    turnEnd: (turn, reason) => `—— 第 ${turn} 轮结束（${reason}）——`,
    truncationNote: dropped => `……（中间 ${dropped} 行已截断）……`,
    middleOmitted: () => '…（中略）…',
  }
}
