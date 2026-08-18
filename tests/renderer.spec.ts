import { describe, expect, it } from 'vitest'
import { escapeHtml, safeCodeFence } from '../src/renderer/escape.ts'
import { formatDuration, renderFieldTitle } from '../src/renderer/common.ts'
import { renderReport } from '../src/renderer/index.ts'
import type { NarratedReport } from '../src/report.ts'

function baseReport(overrides: Partial<NarratedReport> = {}): NarratedReport {
  return {
    meta: {
      sessionId: 'sess_1',
      title: '示例会话',
      startedAt: 1710000000000,
      endedAt: 1710000720000,
      eventCount: 10,
      droppedEvents: 2,
      truncated: false,
      turns: 2,
      schemaName: 'summary',
      lang: 'zh-CN',
      redactLevel: 'strict',
      generatedAt: 1710001000000,
    },
    status: 'ok',
    summary: {
      title: '搭建插件',
      duration: '12 分钟',
      summary: '完成了脚手架。',
      key_steps: ['设计', '实现', '测试'],
      decisions: ['strict 默认'],
      outcomes: [],
    },
    ...overrides,
  }
}

describe('escapeHtml', () => {
  it('转义全部五个字符', () => {
    expect(escapeHtml(`<a href="x" onload='y'>1 & 2</a>`))
      .toBe('&lt;a href=&quot;x&quot; onload=&#39;y&#39;&gt;1 &amp; 2&lt;/a&gt;')
  })
})

describe('safeCodeFence', () => {
  it('围栏长于内容中的最长反引号段', () => {
    expect(safeCodeFence('plain')).toBe('```\nplain\n```')
    const tricky = 'has ``` inside ``` and more'
    const out = safeCodeFence(tricky)
    expect(out.startsWith('````')).toBe(true)
    expect(out.endsWith('````')).toBe(true)
  })
})

describe('renderReport（HTML 注入防护）', () => {
  it('LLM 输出中的 script/img/属性注入全部被转义', () => {
    const evil: NarratedReport = baseReport({
      meta: { ...baseReport().meta, title: '</title><script>alert(1)</script>' },
      summary: {
        title: '<script>alert(1)</script>',
        duration: '1 分钟',
        summary: '<img src=x onerror="alert(2)">',
        key_steps: ['<b>bold</b>', `a"b'c&d`],
        decisions: [],
        outcomes: [],
      },
    })
    const html = renderReport(evil, 'html')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(2)&quot;&gt;')
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;')
    expect(html).toContain('a&quot;b&#39;c&amp;d')
  })

  it('标题同时出现在 <title> 与 <h1> 且均转义', () => {
    const html = renderReport(baseReport({ meta: { ...baseReport().meta, title: '<x>' } }), 'html')
    expect(html).toContain('<title>&lt;x&gt;</title>')
    expect(html).toContain('<h1>&lt;x&gt;</h1>')
  })

  it('降级横幅（no-llm / validation-failed）', () => {
    const noLlm = renderReport(baseReport({ status: 'no-llm', summary: undefined }), 'html')
    expect(noLlm).toContain('未生成 AI 总结')
    const failed = renderReport(baseReport({ status: 'validation-failed', rawOutput: '<bad>{"x":' }), 'html')
    expect(failed).toContain('未通过 schema 校验')
    expect(failed).toContain('&lt;bad&gt;')
    expect(failed).not.toContain('<bad>')
  })

  it('meta 与中文字段标题渲染', () => {
    const html = renderReport(baseReport(), 'html')
    expect(html).toContain('sess_1')
    expect(html).toContain('关键步骤')
    expect(html).toContain('strict')
    expect(html).toContain('summary')
  })

  it('英文 chrome', () => {
    const html = renderReport(baseReport({ meta: { ...baseReport().meta, lang: 'en' } }), 'html')
    expect(html).toContain('Key Steps')
    expect(html).toContain('<html lang="en">')
  })

  it('确定性：同一输入两次输出一致', () => {
    expect(renderReport(baseReport(), 'html')).toBe(renderReport(baseReport(), 'html'))
  })
})

describe('renderReport（Markdown）', () => {
  it('结构完整：标题/meta/总结/字段', () => {
    const md = renderReport(baseReport(), 'md')
    expect(md.startsWith('# 示例会话')).toBe(true)
    expect(md).toContain('**会话**: sess_1')
    expect(md).toContain('## 总结')
    expect(md).toContain('### 关键步骤')
    expect(md).toContain('- 设计')
    expect(md).toContain('- 实现')
    expect(md).toContain('- 测试')
  })

  it('原始输出用防逃逸围栏（内容含 ```）', () => {
    const raw = '中间 ``` 出现\n以及结尾 ```'
    const md = renderReport(baseReport({ status: 'validation-failed', rawOutput: raw }), 'md')
    expect(md).toContain('## 原始输出附录')
    expect(md).toContain('````')
    expect(md).toContain(raw)
  })
})

describe('renderReport（JSON）', () => {
  it('可解析且保留原文与错误', () => {
    const json = renderReport(baseReport({ status: 'validation-failed', rawOutput: 'x', errors: ['e1'] }), 'json')
    const parsed = JSON.parse(json) as NarratedReport
    expect(parsed.meta.sessionId).toBe('sess_1')
    expect(parsed.status).toBe('validation-failed')
    expect(parsed.rawOutput).toBe('x')
    expect(parsed.errors).toEqual(['e1'])
  })

  it('正常状态含 summary', () => {
    const parsed = JSON.parse(renderReport(baseReport(), 'json')) as NarratedReport
    expect(parsed.summary?.key_steps).toEqual(['设计', '实现', '测试'])
  })
})

describe('formatDuration / renderFieldTitle', () => {
  it('时长格式化', () => {
    expect(formatDuration(0, 720000, 'zh-CN')).toBe('12 分钟')
    expect(formatDuration(0, 720000, 'en')).toBe('12 minutes')
    expect(formatDuration(0, 45000, 'zh-CN')).toBe('45 秒')
    expect(formatDuration(0, 400, 'zh-CN')).toBe('1 秒')
    expect(formatDuration(1000, 500, 'zh-CN')).toBeUndefined()
    expect(formatDuration(undefined, 1000, 'zh-CN')).toBeUndefined()
  })

  it('字段标题：内置映射 / 未知回退键名', () => {
    expect(renderFieldTitle('key_steps', 'zh-CN')).toBe('关键步骤')
    expect(renderFieldTitle('key_steps', 'en')).toBe('Key Steps')
    expect(renderFieldTitle('custom_field', 'zh-CN')).toBe('custom_field')
  })
})
