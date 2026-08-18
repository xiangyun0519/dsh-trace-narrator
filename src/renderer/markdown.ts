/**
 * Markdown 渲染：总结字段为小节，数组为列表，原始输出放防逃逸代码围栏。
 * @module dsh-trace-narrator/renderer/markdown
 */

import type { NarratedReport } from '../report.ts'
import { safeCodeFence } from './escape.ts'
import { formatDuration, rendererChrome, renderFieldTitle, renderValue } from './common.ts'

function metaLine(label: string, value: string): string {
  return `- **${label}**: ${value}`
}

function timeRange(report: NarratedReport): string {
  const { startedAt, endedAt } = report.meta
  if (startedAt === undefined || endedAt === undefined) return `${new Date(startedAt ?? endedAt ?? 0).toISOString()} —`
  return `${new Date(startedAt).toISOString()} — ${new Date(endedAt).toISOString()}`
}

export function renderMarkdown(report: NarratedReport): string {
  const c = rendererChrome(report.meta.lang)
  const lines: string[] = []
  lines.push(`# ${report.meta.title ?? c.docTitle}${report.meta.truncated ? c.truncatedNote : ''}`, '')

  const duration = formatDuration(report.meta.startedAt, report.meta.endedAt, report.meta.lang)
  const meta = [
    metaLine(c.meta.session, report.meta.sessionId),
    metaLine(c.meta.timeRange, timeRange(report)),
    ...(duration === undefined ? [] : [metaLine(c.meta.duration, duration)]),
    metaLine(c.meta.events, String(report.meta.eventCount)),
    metaLine(c.meta.dropped, String(report.meta.droppedEvents)),
    metaLine(c.meta.turns, String(report.meta.turns)),
    metaLine(c.meta.schema, report.meta.schemaName),
    metaLine(c.meta.redaction, report.meta.redactLevel),
    metaLine(c.meta.generated, new Date(report.meta.generatedAt).toISOString()),
  ]
  lines.push(...meta, '')

  if (report.status === 'no-llm') lines.push(`> ${c.bannerNoLlm}`, '')
  if (report.status === 'validation-failed') lines.push(`> ${c.bannerValidation}`, '')

  if (report.summary !== undefined) {
    lines.push(`## ${c.summaryHeading}`, '')
    for (const [key, value] of Object.entries(report.summary)) {
      lines.push(`### ${renderFieldTitle(key, report.meta.lang)}`, '')
      const rendered = renderValue(value)
      if (rendered.kind === 'list') {
        lines.push(...rendered.items.map(item => `- ${item}`), '')
      } else if (rendered.kind === 'json') {
        lines.push(safeCodeFence(rendered.json, 'json'), '')
      } else {
        lines.push(rendered.text, '')
      }
    }
  }

  if (report.status === 'validation-failed' && report.rawOutput !== undefined) {
    lines.push(`## ${c.rawAppendixHeading}`, '', safeCodeFence(report.rawOutput), '')
  }
  if (report.errors !== undefined && report.errors.length > 0) {
    lines.push('## 错误', '', ...report.errors.map(e => `- ${e}`), '')
  }
  lines.push('---', c.footer)
  return `${lines.join('\n').trim()}\n`
}
