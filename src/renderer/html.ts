/**
 * 自包含 HTML 报告：内联样式 + 全量转义（任何动态文本都过 escapeHtml）。
 * 不加载任何外部资源，可直接双击打开或分享。
 * @module dsh-trace-narrator/renderer/html
 */

import type { NarratedReport } from '../report.ts'
import { escapeHtml } from './escape.ts'
import { formatDuration, rendererChrome, renderFieldTitle, renderValue } from './common.ts'

const STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; max-width: 860px; margin: 0 auto; padding: 24px 16px 48px; line-height: 1.6; }
  h1 { border-bottom: 2px solid #8884; padding-bottom: 8px; }
  h2 { margin-top: 28px; }
  h3 { margin-top: 20px; font-size: 1.05em; }
  dl.meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
  dl.meta dt { opacity: .65; }
  dl.meta dd { margin: 0; }
  .banner { border: 1px solid #e0b00088; background: #e0b00022; border-radius: 8px; padding: 10px 14px; }
  pre { background: #8882; border-radius: 8px; padding: 12px; overflow-x: auto; }
  footer { margin-top: 32px; opacity: .55; font-size: .85em; }
`

export function renderHtml(report: NarratedReport): string {
  const c = rendererChrome(report.meta.lang)
  const e = escapeHtml
  const lang = report.meta.lang === 'en' ? 'en' : 'zh-CN'

  const metaRows: string[] = []
  const pushMeta = (label: string, value: string): void => {
    metaRows.push(`<dt>${e(label)}</dt><dd>${e(value)}</dd>`)
  }
  pushMeta(c.meta.session, report.meta.sessionId)
  if (report.meta.startedAt !== undefined || report.meta.endedAt !== undefined) {
    const start = report.meta.startedAt === undefined ? '—' : new Date(report.meta.startedAt).toISOString()
    const end = report.meta.endedAt === undefined ? '—' : new Date(report.meta.endedAt).toISOString()
    pushMeta(c.meta.timeRange, `${start} — ${end}`)
  }
  const duration = formatDuration(report.meta.startedAt, report.meta.endedAt, report.meta.lang)
  if (duration !== undefined) pushMeta(c.meta.duration, duration)
  pushMeta(c.meta.events, String(report.meta.eventCount))
  pushMeta(c.meta.dropped, String(report.meta.droppedEvents))
  pushMeta(c.meta.turns, String(report.meta.turns))
  pushMeta(c.meta.schema, report.meta.schemaName)
  pushMeta(c.meta.redaction, report.meta.redactLevel)
  pushMeta(c.meta.generated, new Date(report.meta.generatedAt).toISOString())

  const sections: string[] = []
  if (report.status === 'no-llm') sections.push(`<div class="banner">${e(c.bannerNoLlm)}</div>`)
  if (report.status === 'validation-failed') sections.push(`<div class="banner">${e(c.bannerValidation)}</div>`)

  if (report.summary !== undefined) {
    sections.push(`<h2>${e(c.summaryHeading)}</h2>`)
    for (const [key, value] of Object.entries(report.summary)) {
      sections.push(`<h3>${e(renderFieldTitle(key, report.meta.lang))}</h3>`)
      const rendered = renderValue(value)
      if (rendered.kind === 'list') {
        sections.push(`<ul>${rendered.items.map(item => `<li>${e(item)}</li>`).join('')}</ul>`)
      } else if (rendered.kind === 'json') {
        sections.push(`<pre>${e(rendered.json)}</pre>`)
      } else {
        sections.push(`<p>${e(rendered.text)}</p>`)
      }
    }
  }

  if (report.status === 'validation-failed' && report.rawOutput !== undefined) {
    sections.push(`<h2>${e(c.rawAppendixHeading)}</h2><pre>${e(report.rawOutput)}</pre>`)
  }
  if (report.errors !== undefined && report.errors.length > 0) {
    sections.push(`<h2>${e('错误')}</h2><ul>${report.errors.map(err => `<li>${e(err)}</li>`).join('')}</ul>`)
  }

  const title = report.meta.title ?? c.docTitle
  const truncatedNote = report.meta.truncated ? e(c.truncatedNote) : ''
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>${e(title)}${truncatedNote}</h1>
<dl class="meta">${metaRows.join('')}</dl>
</header>
<main>${sections.join('\n')}</main>
<footer>${e(c.footer)}</footer>
</body>
</html>
`
}
