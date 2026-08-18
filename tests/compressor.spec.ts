import { describe, expect, it } from 'vitest'
import { applyBudget, buildScript, extractText, projectSteps } from '../src/compressor.ts'
import type { SessionEventLike, SessionLogSnapshotLike } from '../src/reader.ts'

const textBlock = (text: string): { type: 'text'; text: string } => ({ type: 'text', text })

function ev(type: string, data: unknown, seq: number, time = seq * 1000): SessionEventLike {
  return { type, seq, time, data }
}

const userEvent = (seq: number, ...texts: string[]): SessionEventLike =>
  ev('user/message', { content: texts.map(textBlock), source: { kind: 'user' } }, seq)

describe('extractText', () => {
  it('拼接多个 text 块，跳过非文本块', () => {
    expect(extractText([
      textBlock('a'),
      { type: 'reasoning', text: 'hidden' },
      textBlock('b'),
    ])).toBe('a\nb')
  })

  it('递归提取 tool-result 块', () => {
    expect(extractText([{
      type: 'tool-result',
      toolCallId: 'c1',
      content: [textBlock('out'), { type: 'tool-result', content: [textBlock('nested')] }],
    }])).toBe('out\nnested')
  })

  it('非数组返回空串', () => {
    expect(extractText(undefined)).toBe('')
    expect(extractText(null)).toBe('')
    expect(extractText('x')).toBe('')
  })
})

describe('projectSteps', () => {
  it('按投影表映射各类事件', () => {
    const events = [
      ev('turn/start', { turn: 3 }, 1),
      userEvent(2, '你好', '继续'),
      ev('user/message', { content: [textBlock('上下文')], source: { kind: 'plugin' } }, 3),
      ev('assistant/message', { turn: 3, step: 1, message: { content: [textBlock('收到'), { type: 'reasoning', text: '思考' }] } }, 4),
      ev('tool/call', { turn: 3, step: 1, callId: 'c1', name: 'pwsh', arguments: '{"a":1}' }, 5),
      ev('tool/result', { turn: 3, step: 1, message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [textBlock('out')], isError: true }] } }, 6),
      ev('todo/write', { todos: [{ content: '写测试', status: 'in_progress' }, { content: '提交', status: 'completed' }] }, 7),
      ev('turn/end', { turn: 3, reason: { kind: 'completed' } }, 8),
    ]
    const { steps, stats } = projectSteps(events)
    expect(steps.map(s => s.kind)).toEqual(['boundary', 'user', 'user', 'assistant', 'tool-call', 'tool-result', 'note', 'boundary'])
    expect(steps[0]?.text).toContain('第 3 轮')
    expect(steps[1]?.text).toBe('你好\n继续')
    expect(steps[2]?.text).toBe('[system] 上下文')
    expect(steps[3]?.text).toBe('收到')
    expect(steps[4]?.text).toBe('pwsh {"a":1}')
    expect(steps[5]?.text).toBe('[错误] out')
    expect(steps[6]?.text).toBe('写测试 (in_progress) | 提交 (completed)')
    expect(steps[7]?.text).toContain('completed')
    expect(stats).toMatchObject({ eventCount: 8, droppedEvents: 0, turns: 1, startedAt: 1000, endedAt: 8000 })
  })

  it('结构上忽略 step/request/chunk 等事件并计数', () => {
    const ignored = [
      ev('step/start', { turn: 1, step: 1 }, 1),
      ev('step/end', { turn: 1, step: 1 }, 2),
      ev('assistant/chunk', { turn: 1, step: 1, chunk: {} }, 3),
      ev('request/header', { header: {}, reason: 'x' }, 4),
      ev('request/context', {}, 5),
      ev('session/end-seed', {}, 6),
      ev('session/title', { title: 't', messageSeqs: [], source: { kind: 'user' } }, 7),
      ev('command/run', { commandId: 'c', name: 'trace-narrate', args: '' }, 8),
    ]
    const { steps, stats } = projectSteps(ignored)
    expect(steps).toEqual([])
    expect(stats.droppedEvents).toBe(8)
  })

  it('空文本行丢弃并计数', () => {
    const { steps, stats } = projectSteps([
      userEvent(1),
      ev('assistant/message', { message: { content: [{ type: 'image', attachment: {} }] } }, 2),
      ev('tool/call', { name: '', arguments: '' }, 3),
    ])
    expect(steps).toEqual([])
    expect(stats.droppedEvents).toBe(3)
  })

  it('英文 chrome', () => {
    const { steps } = projectSteps([ev('turn/start', { turn: 1 }, 1)], 'en')
    expect(steps[0]?.text).toBe('--- turn 1 ---')
  })
})

describe('applyBudget', () => {
  it('阶梯 0：单条上限截断', () => {
    const long = 'x'.repeat(2500)
    const { steps, truncated } = applyBudget([
      { seq: 1, kind: 'user', text: long },
      { seq: 2, kind: 'tool-call', text: 'y'.repeat(600) },
      { seq: 3, kind: 'note', text: 'z'.repeat(400) },
    ])
    expect(truncated).toBe(true)
    expect(steps[0]?.text.length).toBe(2000)
    expect(steps[0]?.truncated).toBe(true)
    expect(steps[1]?.text.length).toBe(512)
    expect(steps[2]?.text.length).toBe(300)
  })

  it('tool-result 头尾截断：保留头 1000 与尾 1000', () => {
    const body = '0123456789'.repeat(500) // 5000 字符
    const [step] = applyBudget([{ seq: 1, kind: 'tool-result', text: body }]).steps
    expect(step?.truncated).toBe(true)
    expect(step?.text.startsWith('0123456789')).toBe(true)
    expect(step?.text.endsWith('0123456789')).toBe(true)
    expect(step?.text).toContain('…（中略）…')
  })

  it('阶梯 1：超预算时 tool-result 收紧到 512（头尾 256/256）', () => {
    const steps = [
      { seq: 1, kind: 'user', text: 'a'.repeat(800) },
      { seq: 2, kind: 'tool-result', text: 'b'.repeat(2000) },
      { seq: 3, kind: 'assistant', text: 'c'.repeat(800) },
    ]
    // 全量上限下约 906 token，收紧后约 536 token：
    // budget 600 恰好卡在两者之间，验证阶梯 1 产物。
    const result = applyBudget(steps, { budget: 600 })
    expect(result.truncated).toBe(true)
    const toolResult = result.steps.find(s => s.kind === 'tool-result')
    expect(toolResult).toBeDefined()
    expect(toolResult?.text.length).toBeLessThanOrEqual(256 + 256 + 20)
  })

  it('阶梯 2：丢弃 note 行', () => {
    const steps = [
      { seq: 1, kind: 'user', text: 'a'.repeat(1200) },
      { seq: 2, kind: 'note', text: 'todo...' },
      { seq: 3, kind: 'assistant', text: 'b'.repeat(1200) },
    ]
    const result = applyBudget(steps, { budget: 200 })
    expect(result.steps.some(s => s.kind === 'note')).toBe(false)
    expect(result.droppedNotes).toBe(1)
  })

  it('阶梯 3：头-中-尾窗口 + 截断标记', () => {
    const steps = Array.from({ length: 50 }, (_, i) => ({ seq: i + 1, kind: 'user' as const, text: `step-${i} ${'x'.repeat(40)}` }))
    const result = applyBudget(steps, { budget: 50 })
    const marker = result.steps.find(s => s.kind === 'boundary')
    expect(marker).toBeDefined()
    expect(marker?.text).toContain('已截断')
    expect(result.droppedByWindow).toBe(50 - result.steps.length + 1)
    expect(result.truncated).toBe(true)
  })

  it('阶梯 4：兜底硬截 500', () => {
    const result = applyBudget([{ seq: 1, kind: 'user', text: 'x'.repeat(10000) }], { budget: 10 })
    expect(result.steps[0]?.text.length).toBe(500)
  })

  it('预算充足时不截断', () => {
    const result = applyBudget([{ seq: 1, kind: 'user', text: 'short' }], { budget: 12000 })
    expect(result.truncated).toBe(false)
    expect(result.steps[0]?.text).toBe('short')
  })

  it('确定性：同一输入两次输出一致', () => {
    const steps = [
      { seq: 1, kind: 'user', text: 'a'.repeat(1500) },
      { seq: 2, kind: 'tool-result', text: 'b'.repeat(3000) },
      { seq: 3, kind: 'note', text: 'n'.repeat(200) },
    ]
    expect(applyBudget(steps, { budget: 300 })).toEqual(applyBudget(steps, { budget: 300 }))
  })
})

describe('buildScript', () => {
  const snapshot: SessionLogSnapshotLike = {
    session: { id: 'sess_1' },
    events: [
      ev('turn/start', { turn: 1 }, 1),
      userEvent(2, 'hello'),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3),
    ],
  }

  it('组装 meta 与 steps', () => {
    const script = buildScript(snapshot, { title: '测试会话' })
    expect(script.meta).toMatchObject({
      sessionId: 'sess_1',
      title: '测试会话',
      eventCount: 3,
      turns: 1,
      truncated: false,
      startedAt: 1000,
      endedAt: 3000,
    })
    expect(script.steps.map(s => s.kind)).toEqual(['boundary', 'user', 'boundary'])
  })

  it('droppedEvents 汇总结构丢弃与预算丢弃', () => {
    const s2: SessionLogSnapshotLike = {
      session: { id: 'sess_2' },
      events: [
        ev('step/start', { turn: 1, step: 1 }, 1),
        ev('request/header', {}, 2),
        ev('todo/write', { todos: [{ content: 'x', status: 'pending' }] }, 3),
        ev('user/message', { content: [textBlock('y'.repeat(10000))], source: { kind: 'user' } }, 4),
      ],
    }
    const script = buildScript(s2, { budget: 10 })
    expect(script.meta.droppedEvents).toBeGreaterThanOrEqual(2)
    expect(script.meta.truncated).toBe(true)
  })
})
