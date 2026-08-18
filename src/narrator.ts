/**
 * 管线编排（docs/design.md §4）：
 *   目标解析 → 读取 → projectSteps → redact → applyBudget → 发送前确认
 *   → 加载 schema → summarize（重试/降级）→ 组装报告 → 渲染 → 二次脱敏
 *   → 落盘 → 审计。
 * 全部依赖经 NarratorDeps 注入：本模块无任何 DSH 依赖，可在无 DSH 环境测试；
 * 生产适配器在 index.ts（ctx.sessionQuery / ctx.llm / ctx.userQuestions / ctx.fs …）。
 * @module dsh-trace-narrator/narrator
 */

import { join } from 'node:path'
import type { TraceNarratorConfig } from './config.ts'
import { estimateTextTokens } from './script.ts'
import type { Script, ScriptLang, ScriptMeta } from './script.ts'
import { loadSessionLog, SessionReadError } from './reader.ts'
import type { SessionLogSource } from './reader.ts'
import { applyBudget, projectSteps } from './compressor.ts'
import { createRedactor } from './redaction/index.ts'
import type { Redactor } from './redaction/index.ts'
import { buildAuditEntry } from './redaction/audit.ts'
import type { AuditWriter } from './redaction/audit.ts'
import { loadSchema, SchemaLoadError } from './schemas/loader.ts'
import type { SchemaSource } from './schemas/loader.ts'
import { summarize } from './summarizer.ts'
import type { SummaryLlm } from './summarizer.ts'
import { renderReport } from './renderer/index.ts'
import type { NarratedReport } from './report.ts'
import type { NarrateOverrides } from './args.ts'
import { strings } from './i18n/index.ts'
import type { UiLang } from './i18n/index.ts'

export interface QuestionResult {
  /** 选中的选项 label 列表（单选为单元素）。 */
  selected: string[]
}

export interface NarratorDeps {
  /** settings 解析值（行配置 base + 用户层）。 */
  config: TraceNarratorConfig
  query: SessionLogSource
  schemaSource: SchemaSource
  /** 缺省 → 确认不可交互（除非显式跳过，否则取消）。 */
  questions?: {
    ask(request: { question: string; header: string; options: string[] }): Promise<QuestionResult>
  }
  /** 总结调用与模型路由；缺省 → 降级模板报告（exit 5）。 */
  llm?: SummaryLlm
  model?: { provider: string; model: string }
  /** 缺省 → 降级模板报告。 */
  writeFile(path: string, content: string): Promise<void>
  auditWriter?: AuditWriter
  /** $DSH_HOME（schemaDir/audit dir 的兜底根）。 */
  home: string
  workspaceRoot: string
  title?: () => Promise<string | undefined>
  now?: () => number
}

export interface NarrateRequest {
  sessionId: string
  overrides: NarrateOverrides
}

export type NarrateOutcome =
  | { kind: 'ok'; message: string; outputPath: string; report: NarratedReport }
  | { kind: 'degraded'; message: string; outputPath: string; report: NarratedReport }
  | { kind: 'cancelled'; exitCode: 4; message: string }
  | { kind: 'error'; exitCode: 2 | 3 | 6 | 7; message: string }

const STEP_OVERHEAD = 2

function definedOverrides(overrides: NarrateOverrides): Partial<TraceNarratorConfig> {
  const out: Partial<TraceNarratorConfig> = {}
  if (overrides.lang !== undefined) out.lang = overrides.lang
  if (overrides.schema !== undefined) out.schema = overrides.schema
  if (overrides.redact !== undefined) out.redact = overrides.redact
  if (overrides.format !== undefined) out.format = overrides.format
  if (overrides.outputDir !== undefined) out.outputDir = overrides.outputDir
  if (overrides.tokenBudget !== undefined) out.tokenBudget = overrides.tokenBudget
  if (overrides.maxTokens !== undefined) out.maxTokens = overrides.maxTokens
  return out
}

function formatTimestamp(time: number): string {
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export async function narrate(deps: NarratorDeps, request: NarrateRequest): Promise<NarrateOutcome> {
  const resolved: TraceNarratorConfig = { ...deps.config, ...definedOverrides(request.overrides) }
  const bypassConfirm = request.overrides.confirm === false || !resolved.confirmBeforeSend
  const ui = strings(resolved.lang === 'en' ? 'en' : 'zh-CN') as ReturnType<typeof strings>
  const now = deps.now ?? Date.now
  const langUi: UiLang = resolved.lang === 'en' ? 'en' : 'zh-CN'

  // 1. 读取会话
  let snapshot
  try {
    snapshot = await loadSessionLog(deps.query, request.sessionId)
  } catch (error) {
    const detail = error instanceof SessionReadError ? String(error.cause) : String(error)
    return { kind: 'error', exitCode: 3, message: ui.errSessionRead(request.sessionId, detail) }
  }

  // 2. 投影 → 脱敏 → 预算（截断必须在脱敏之后，docs/redaction.md §3）
  const scriptLang: ScriptLang = resolved.lang === 'en' ? 'en' : 'zh-CN'
  const projected = projectSteps(snapshot.events, scriptLang)
  const redactor: Redactor = createRedactor({ level: resolved.redact })
  const redactedScript = redactor.redactScript({ meta: {} as ScriptMeta, steps: projected.steps })
  const budgeted = applyBudget(redactedScript.script.steps, {
    lang: scriptLang,
    budget: resolved.tokenBudget,
  })

  let title: string | undefined
  if (deps.title !== undefined) {
    try {
      title = await deps.title()
    } catch {
      title = undefined
    }
  }
  const meta: ScriptMeta = {
    sessionId: request.sessionId,
    ...(title === undefined ? {} : { title }),
    eventCount: projected.stats.eventCount,
    droppedEvents: projected.stats.droppedEvents + budgeted.droppedNotes + budgeted.droppedByWindow,
    truncated: budgeted.truncated,
    turns: projected.stats.turns,
    startedAt: projected.stats.startedAt,
    endedAt: projected.stats.endedAt,
  }
  const script: Script = { meta, steps: budgeted.steps }

  // 3. 发送前确认
  let confirmed = false
  if (!bypassConfirm) {
    if (deps.questions === undefined) {
      return { kind: 'cancelled', exitCode: 4, message: ui.errNonInteractive }
    }
    const tokens = script.steps.reduce((sum, step) => sum + estimateTextTokens(step.text) + STEP_OVERHEAD, 0)
    const question = ui.confirmQuestion(
      request.sessionId, script.meta.eventCount, script.steps.length, tokens, redactor.cumulative().total,
    )
    let answer: QuestionResult
    try {
      answer = await deps.questions.ask({ question, header: ui.confirmHeader, options: [ui.confirmSend, ui.confirmCancel] })
    } catch {
      return { kind: 'cancelled', exitCode: 4, message: ui.errNonInteractive }
    }
    if (!answer.selected.includes(ui.confirmSend)) {
      if (deps.auditWriter !== undefined && resolved.audit.enabled) {
        deps.auditWriter.write(buildAuditEntry(request.sessionId, redactor.cumulative(), false, false))
      }
      return { kind: 'cancelled', exitCode: 4, message: ui.errCancelled }
    }
    confirmed = true
  }

  // 4. 加载 schema
  let loadedSchema
  try {
    const schemaDir = resolved.schemaDir.length > 0 ? resolved.schemaDir : join(deps.home, 'schemas')
    loadedSchema = await loadSchema(resolved.schema, { source: deps.schemaSource, schemaDir })
  } catch (error) {
    const detail = error instanceof SchemaLoadError ? error.message.split('：').slice(1).join('：') : String(error)
    return { kind: 'error', exitCode: 6, message: ui.errSchema(resolved.schema, detail) }
  }

  // 5. 总结（含重试与降级）
  let status: NarratedReport['status'] = 'ok'
  let summary: Record<string, unknown> | undefined
  let rawOutput: string | undefined
  let errors: string[] | undefined
  let degradedMessage: string | undefined

  if (deps.llm === undefined || deps.model === undefined) {
    status = 'no-llm'
    errors = [ui.degradedNoLlm]
    degradedMessage = ui.degradedNoLlm
  } else {
    const result = await summarize({
      llm: deps.llm,
      schema: loadedSchema.schema,
      script,
      lang: resolved.lang,
      provider: deps.model.provider,
      model: deps.model.model,
      maxTokens: resolved.maxTokens,
    })
    if (result.ok) {
      summary = result.value
    } else if (result.reason === 'aborted') {
      return { kind: 'cancelled', exitCode: 4, message: ui.errCancelled }
    } else {
      rawOutput = result.rawText
      errors = result.errors
      if (result.reason === 'llm-failed') {
        status = 'no-llm'
        degradedMessage = ui.degradedNoLlm
      } else {
        status = 'validation-failed'
        degradedMessage = ui.degradedValidation
      }
    }
  }

  // 6. 组装报告 → 渲染 → 二次脱敏（LLM 复述的 secret 也要替换）
  const report: NarratedReport = {
    meta: {
      sessionId: request.sessionId,
      ...(script.meta.title === undefined ? {} : { title: script.meta.title }),
      startedAt: script.meta.startedAt,
      endedAt: script.meta.endedAt,
      eventCount: script.meta.eventCount,
      droppedEvents: script.meta.droppedEvents,
      truncated: script.meta.truncated,
      turns: script.meta.turns,
      schemaName: loadedSchema.name,
      lang: resolved.lang,
      redactLevel: resolved.redact,
      generatedAt: now(),
    },
    status,
    ...(summary === undefined ? {} : { summary }),
    ...(rawOutput === undefined ? {} : { rawOutput }),
    ...(errors === undefined ? {} : { errors }),
  }
  const rendered = redactor.redactText(renderReport(report, resolved.format)).text

  // 7. 落盘
  const outputDir = resolved.outputDir.length > 0 ? resolved.outputDir : 'trace-narrate'
  const ext = resolved.format === 'md' ? 'md' : resolved.format
  const outputPath = join(outputDir, `${request.sessionId}-${formatTimestamp(now())}.${ext}`)
  try {
    await deps.writeFile(outputPath, rendered)
  } catch (error) {
    return { kind: 'error', exitCode: 7, message: ui.errWrite(outputPath, String(error)) }
  }

  // 8. 审计（confirmed=false 时也记预览统计——用户取消路径在第 3 步已写）
  const sent = status === 'ok'
  if (deps.auditWriter !== undefined && resolved.audit.enabled) {
    try {
      deps.auditWriter.write(buildAuditEntry(request.sessionId, redactor.cumulative(), confirmed || bypassConfirm, sent))
    } catch {
      // 审计失败不阻塞报告产物。
    }
  }

  const warningsSuffix = loadedSchema.warnings.length > 0 ? ` ${ui.schemaWarnings(loadedSchema.warnings.length)}` : ''
  const okMessage = ui.okMessage(outputPath, redactor.cumulative().total)
  if (status === 'ok') {
    return { kind: 'ok', message: `${okMessage}${warningsSuffix}`, outputPath, report }
  }
  return {
    kind: 'degraded',
    message: `${degradedMessage ?? ''} ${okMessage}${warningsSuffix}`.trim(),
    outputPath,
    report,
  }
}
