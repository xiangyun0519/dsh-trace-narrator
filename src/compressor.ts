/**
 * 事件投影 + 预算截断。
 * 投影表与上限见 docs/design.md §5；顺序约束见 docs/redaction.md §3：
 * 所有文本截断（applyBudget）必须在脱敏之后执行——narrator 管线（v0.8.0）
 * 按 projectSteps → redact → applyBudget 编排；buildScript 是便于独立使用与
 * 测试的完整串联（此时不经过脱敏，仅用于内部测试与离线预览）。
 * @module dsh-trace-narrator/compressor
 */

import { estimateTextTokens, scriptChrome } from './script.ts'
import type { Script, ScriptChrome, ScriptLang, ScriptMeta, ScriptStep, ScriptStepKind } from './script.ts'
import type { SessionEventLike, SessionLogSnapshotLike } from './reader.ts'

/** 结构类型：与 @deepseek-ai/dsh-llm 的 ContentBlock 对齐（仅取 text / tool-result 递归）。 */
interface BlockLike {
  type?: unknown
  text?: unknown
  content?: unknown
  isError?: unknown
}

/** 递归提取可见文本块；reasoning/image/tool-call 等非文本块跳过。 */
export function extractText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const block of blocks as BlockLike[]) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'tool-result' && Array.isArray(block.content)) {
      const inner = extractText(block.content)
      if (inner.length > 0) parts.push(inner)
    }
  }
  return parts.join('\n')
}

/** turn/end 的 reason 是 merge-extensible 联合（{kind: …}）；渲染 kind，未知时退化 String。 */
function renderReason(reason: unknown): string {
  if (reason !== null && typeof reason === 'object') {
    const kind = (reason as { kind?: unknown }).kind
    if (typeof kind === 'string') return kind
  }
  return String(reason)
}

/** 投影统计（结构层）。 */
export interface ProjectionStats {
  eventCount: number
  /** 结构上忽略的事件（step/request/chunk 等）+ 空文本行。 */
  droppedEvents: number
  turns: number
  startedAt?: number
  endedAt?: number
}

export interface Projected {
  steps: ScriptStep[]
  stats: ProjectionStats
}

/** 各事件类型的单条文本上限（预算阶梯 0；阶梯 1 收紧 tool-result）。 */
export interface StepCaps {
  user: number
  assistant: number
  toolCall: number
  toolResult: number
  toolResultHead: number
  toolResultTail: number
  note: number
  boundary: number
}

export const DEFAULT_CAPS: StepCaps = {
  user: 2000,
  assistant: 3000,
  toolCall: 512,
  toolResult: 2000,
  toolResultHead: 1000,
  toolResultTail: 1000,
  note: 300,
  boundary: 80,
}

/** 预算阶梯 1 的收紧上限。 */
const TAPER_CAPS: StepCaps = {
  ...DEFAULT_CAPS,
  toolResult: 512,
  toolResultHead: 256,
  toolResultTail: 256,
}

/** 阶梯 4 兜底硬上限。 */
const HARD_CAP = 500

/**
 * 把会话事件投影为剧本行（不做任何文本截断——截断必须发生在脱敏之后）。
 * 投影表：
 *   turn/start、turn/end       → boundary
 *   user/message               → user（plugin 来源加 [system] 前缀）
 *   assistant/message          → assistant（仅可见文本，跳过 reasoning）
 *   tool/call                  → tool-call（name + arguments）
 *   tool/result                → tool-result（错误加 [错误] 前缀）
 *   todo/write                 → note
 *   其余（step/request/chunk/end-seed/未知，含插件域事件）→ 忽略并计数
 */
export function projectSteps(
  events: readonly SessionEventLike[],
  lang: ScriptLang = 'zh-CN',
): Projected {
  const c = scriptChrome(lang)
  const steps: ScriptStep[] = []
  const stats: ProjectionStats = { eventCount: events.length, droppedEvents: 0, turns: 0 }

  const push = (seq: number, kind: ScriptStepKind, text: string): void => {
    if (text.length === 0) {
      stats.droppedEvents += 1
      return
    }
    steps.push({ seq, kind, text })
  }

  for (const event of events) {
    const data = event.data as Record<string, unknown> | null | undefined
    switch (event.type) {
      case 'turn/start': {
        stats.turns += 1
        const turn = data?.turn
        push(event.seq, 'boundary', c.turnStart(typeof turn === 'number' ? turn : stats.turns))
        break
      }
      case 'turn/end': {
        const turn = data?.turn
        const fallback = stats.turns
        push(event.seq, 'boundary', c.turnEnd(typeof turn === 'number' ? turn : fallback, renderReason(data?.reason)))
        break
      }
      case 'user/message': {
        const source = data?.source
        const kind = source !== null && typeof source === 'object' && 'kind' in source
          ? (source as { kind?: unknown }).kind
          : undefined
        const prefix = kind === 'plugin' ? '[system] ' : ''
        push(event.seq, 'user', prefix + extractText(data?.content))
        break
      }
      case 'assistant/message': {
        const message = data?.message as { content?: unknown } | null | undefined
        push(event.seq, 'assistant', extractText(message?.content))
        break
      }
      case 'tool/call': {
        const name = data?.name
        const args = data?.arguments
        push(event.seq, 'tool-call', `${typeof name === 'string' ? name : ''} ${typeof args === 'string' ? args : ''}`.trim())
        break
      }
      case 'tool/result': {
        const message = data?.message as { content?: unknown } | null | undefined
        const firstBlock = Array.isArray(message?.content) ? message.content[0] as BlockLike | undefined : undefined
        const isError = data?.error !== undefined || firstBlock?.isError === true
        push(event.seq, 'tool-result', (isError ? '[错误] ' : '') + extractText(message?.content))
        break
      }
      case 'todo/write': {
        const todos = data?.todos
        if (Array.isArray(todos)) {
          const line = todos
            .map(item => {
              const t = item as { content?: unknown; status?: unknown } | null
              return `${typeof t?.content === 'string' ? t.content : ''} (${typeof t?.status === 'string' ? t.status : 'pending'})`
            })
            .join(' | ')
          push(event.seq, 'note', line)
        } else {
          stats.droppedEvents += 1
        }
        break
      }
      default: {
        // step/start、step/end、assistant/chunk、request/header、request/context、
        // session/end-seed，以及插件域事件（command/*、session/title 等）。
        stats.droppedEvents += 1
        break
      }
    }
  }

  if (events.length > 0) {
    stats.startedAt = events[0]?.time
    stats.endedAt = events[events.length - 1]?.time
  }
  return { steps, stats }
}

/** 单行截断（超出加省略号）。 */
function cut(text: string, cap: number): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false }
  return { text: `${text.slice(0, cap - 1)}…`, truncated: true }
}

/** 头尾截断（保留 head + tail，中间换标记行）。 */
function cutHeadTail(text: string, head: number, tail: number, marker: string): { text: string; truncated: boolean } {
  if (text.length <= head + tail) return { text, truncated: false }
  return { text: `${text.slice(0, head)}\n${marker}\n${text.slice(text.length - tail)}`, truncated: true }
}

/** 按种类应用单条上限（tool-result 用头尾截断）。 */
function applyCaps(steps: readonly ScriptStep[], caps: StepCaps, c: ScriptChrome): ScriptStep[] {
  return steps.map(step => {
    switch (step.kind) {
      case 'user': return { ...step, ...cut(step.text, caps.user) }
      case 'assistant': return { ...step, ...cut(step.text, caps.assistant) }
      case 'tool-call': return { ...step, ...cut(step.text, caps.toolCall) }
      case 'tool-result':
        return { ...step, ...cutHeadTail(step.text, caps.toolResultHead, caps.toolResultTail, c.middleOmitted()) }
      case 'note': return { ...step, ...cut(step.text, caps.note) }
      case 'boundary': return { ...step, ...cut(step.text, caps.boundary) }
      /* v8 ignore next -- ScriptStepKind 是封闭联合 */
      default: return step
    }
  })
}

export interface BudgetOptions {
  lang?: ScriptLang
  /** 剧本 token 预算；默认 12000（对齐 settings.tokenBudget）。 */
  budget?: number
  /** 行 token 估算器；默认 estimateTextTokens。 */
  estimator?: (text: string) => number
}

export interface BudgetResult {
  steps: ScriptStep[]
  /** 是否发生过任何截断（阶梯 0 的单条截断也算）。 */
  truncated: boolean
  /** 阶梯 2 丢弃的 note 行数。 */
  droppedNotes: number
  /** 阶梯 3 头-中-尾窗口丢弃的行数。 */
  droppedByWindow: number
}

const STEP_OVERHEAD = 2

/**
 * 对已脱敏的剧本行应用预算（docs/design.md §5 的截断阶梯）：
 *   0. 单条上限（DEFAULT_CAPS）
 *   1. tool-result 收紧到 512（头尾 256/256）
 *   2. 丢弃 note 行
 *   3. 头-中-尾：保留前 20% 与后 30%，中间换一行截断标记
 *   4. 兜底：每行硬截 500
 */
export function applyBudget(
  steps: readonly ScriptStep[],
  options: BudgetOptions = {},
): BudgetResult {
  const lang = options.lang ?? 'zh-CN'
  const budget = options.budget ?? 12000
  const estimator = options.estimator ?? estimateTextTokens
  const c = scriptChrome(lang)
  const total = (list: readonly ScriptStep[]): number =>
    list.reduce((sum, step) => sum + estimator(step.text) + STEP_OVERHEAD, 0)

  let list = applyCaps(steps, DEFAULT_CAPS, c)
  let truncated = list.some(step => step.truncated === true)
  let droppedNotes = 0
  let droppedByWindow = 0

  if (total(list) <= budget) {
    return { steps: list, truncated, droppedNotes, droppedByWindow }
  }

  // 阶梯 1：tool-result 收紧
  list = applyCaps(steps, TAPER_CAPS, c)
  truncated = true
  if (total(list) <= budget) {
    return { steps: list, truncated, droppedNotes, droppedByWindow }
  }

  // 阶梯 2：丢弃 note 行
  const withoutNotes = list.filter(step => step.kind !== 'note')
  droppedNotes = list.length - withoutNotes.length
  list = withoutNotes
  if (total(list) <= budget) {
    return { steps: list, truncated, droppedNotes, droppedByWindow }
  }

  // 阶梯 3：头-中-尾窗口
  const headCount = Math.max(1, Math.ceil(list.length * 0.2))
  const tailCount = Math.max(1, Math.ceil(list.length * 0.3))
  if (list.length > headCount + tailCount) {
    droppedByWindow = list.length - headCount - tailCount
    const head = list.slice(0, headCount)
    const tail = list.slice(list.length - tailCount)
    const marker: ScriptStep = {
      seq: tail[0]?.seq ?? 0,
      kind: 'boundary',
      text: c.truncationNote(droppedByWindow),
    }
    list = [...head, marker, ...tail]
  }
  truncated = true
  if (total(list) <= budget) {
    return { steps: list, truncated, droppedNotes, droppedByWindow }
  }

  // 阶梯 4：兜底硬截
  list = list.map(step => ({ ...step, ...cut(step.text, HARD_CAP) }))
  return { steps: list, truncated: true, droppedNotes, droppedByWindow }
}

export interface BuildScriptOptions extends BudgetOptions {
  /** 会话标题（上层经 sessionTitle 服务取得后传入）。 */
  title?: string
}

/**
 * 完整串联：projectSteps + applyBudget + 组装 meta。
 * 注意：此路径不经过脱敏；生产管线（v0.8.0）必须在两步之间插入脱敏。
 */
export function buildScript(
  snapshot: SessionLogSnapshotLike,
  options: BuildScriptOptions = {},
): Script {
  const projected = projectSteps(snapshot.events, options.lang)
  const result = applyBudget(projected.steps, options)
  const meta: ScriptMeta = {
    sessionId: snapshot.session.id,
    eventCount: projected.stats.eventCount,
    droppedEvents: projected.stats.droppedEvents + result.droppedNotes + result.droppedByWindow,
    truncated: result.truncated,
    turns: projected.stats.turns,
    startedAt: projected.stats.startedAt,
    endedAt: projected.stats.endedAt,
    ...(options.title === undefined ? {} : { title: options.title }),
  }
  return { meta, steps: result.steps }
}
