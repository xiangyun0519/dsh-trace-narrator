/**
 * 渲染入口：按格式分发到 HTML / Markdown / JSON 渲染器。
 * @module dsh-trace-narrator/renderer
 */

import type { OutputFormat } from '../config.ts'
import type { NarratedReport } from '../report.ts'
import { renderHtml } from './html.ts'
import { renderMarkdown } from './markdown.ts'
import { renderJson } from './json.ts'

export { escapeHtml, safeCodeFence } from './escape.ts'
export { formatDuration, rendererChrome, renderFieldTitle, renderValue } from './common.ts'
export type { RenderedValue, RendererChrome } from './common.ts'
export { renderHtml } from './html.ts'
export { renderMarkdown } from './markdown.ts'
export { renderJson } from './json.ts'

export function renderReport(report: NarratedReport, format: OutputFormat): string {
  switch (format) {
    case 'html': return renderHtml(report)
    case 'md': return renderMarkdown(report)
    case 'json': return renderJson(report)
    /* v8 ignore next -- OutputFormat 是封闭联合 */
    default: return renderHtml(report)
  }
}
