import { describe, expect, it } from 'vitest'
import { renderInlineReport } from '../src/index.ts'
import { strings } from '../src/i18n/index.ts'
import type { NarratedReport } from '../src/report.ts'

function report(): NarratedReport {
  return {
    meta: {
      sessionId: 'sess_1',
      eventCount: 1,
      droppedEvents: 0,
      truncated: false,
      turns: 1,
      schemaName: 'summary',
      lang: 'zh-CN',
      redactLevel: 'strict',
      generatedAt: 1710001000000,
    },
    status: 'ok',
    summary: { title: 'inline' },
  }
}

describe('命令入口降级输出', () => {
  it('无 inbox 时直接把已脱敏报告作为 Markdown 返回', () => {
    const text = renderInlineReport(report(), '报告已生成：trace-narrate/sess_1.md')
    expect(text).toContain('报告已生成：trace-narrate/sess_1.md')
    expect(text).toContain('# 会话轨迹报告')
    expect(text).toContain('inline')
  })

  it('没有后续对话消息时不承诺下一轮复述', () => {
    const text = strings('zh-CN').commandAck({
      sessionId: 'sess_1',
      outputPath: 'trace-narrate/sess_1.md',
      link: undefined,
      reportLine: '⚠️ 已输出纯模板报告。',
      inboxDelivered: false,
      lang: 'zh-CN',
    })
    expect(text).toContain('打开报告查看')
    expect(text).not.toContain('下一轮')
  })
})
