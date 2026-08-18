import { describe, expect, it } from 'vitest'
import { DEBUG_SCHEMA, EXECUTIVE_SCHEMA, POSTMORTEM_SCHEMA, SUMMARY_SCHEMA, TUTORIAL_SCHEMA } from '../src/schemas/builtin.ts'
import { extractJson, formatErrors, stripUnknownKeys, validateOutput } from '../src/schemas/validate.ts'
import type { JsonSchema } from '../src/schemas/builtin.ts'

describe('extractJson', () => {
  it('纯 JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })

  it('```json 围栏', () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ ok: true, value: { a: 1 } })
    expect(extractJson('```\n{"a": 1}\n```')).toEqual({ ok: true, value: { a: 1 } })
  })

  it('前后杂文：定位首 { 与末 }', () => {
    expect(extractJson('好的，结果如下：{"a": 1} 以上。')).toEqual({ ok: true, value: { a: 1 } })
  })

  it('非法 JSON / 无花括号 → 错误', () => {
    expect(extractJson('{"a": }').ok).toBe(false)
    expect(extractJson('没有 JSON').ok).toBe(false)
    expect(extractJson('').ok).toBe(false)
  })
})

describe('stripUnknownKeys', () => {
  const schema: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      tags: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' } } } },
    },
  }

  it('删除顶层与嵌套未知键', () => {
    const out = stripUnknownKeys(
      { name: 'x', extra: 1, tags: [{ label: 'a', junk: true }] },
      schema,
    )
    expect(out).toEqual({ name: 'x', tags: [{ label: 'a' }] })
  })

  it('数组/标量原样保留', () => {
    expect(stripUnknownKeys([1, 2], schema)).toEqual([1, 2])
    expect(stripUnknownKeys('text', schema)).toBe('text')
    expect(stripUnknownKeys(null, schema)).toBeNull()
  })
})

const GOOD_SUMMARY = {
  title: '搭建 dsh 插件脚手架',
  duration: '12 分钟',
  summary: '完成了一个插件的设计与实现。',
  key_steps: ['设计', '实现', '测试'],
  decisions: ['默认 strict 脱敏'],
  outcomes: ['插件可安装'],
}

describe('validateOutput（summary）', () => {
  it('合法输出通过', () => {
    const result = validateOutput(JSON.stringify(GOOD_SUMMARY), SUMMARY_SCHEMA)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(GOOD_SUMMARY)
  })

  it('多余字段被剥离后通过', () => {
    const result = validateOutput(JSON.stringify({ ...GOOD_SUMMARY, hallucinated: 'x', nested: { a: 1 } }), SUMMARY_SCHEMA)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(GOOD_SUMMARY)
  })

  it('缺 required 字段报错并点名字段', () => {
    const { ok, errors } = validateOutput(JSON.stringify({ title: '仅标题' }), SUMMARY_SCHEMA)
    expect(ok).toBe(false)
    if (!ok) expect(errors.some(e => e.includes('duration'))).toBe(true)
  })

  it('类型错误报错', () => {
    const bad = { ...GOOD_SUMMARY, key_steps: '不是数组' }
    expect(validateOutput(JSON.stringify(bad), SUMMARY_SCHEMA).ok).toBe(false)
  })

  it('maxItems 违规报错', () => {
    const bad = { ...GOOD_SUMMARY, key_steps: Array.from({ length: 13 }, (_, i) => `s${i}`) }
    const { ok, errors } = validateOutput(JSON.stringify(bad), SUMMARY_SCHEMA)
    expect(ok).toBe(false)
    if (!ok) expect(errors.some(e => e.includes('maxItems'))).toBe(true)
  })

  it('围栏输出通过', () => {
    const result = validateOutput('```json\n' + JSON.stringify(GOOD_SUMMARY) + '\n```', SUMMARY_SCHEMA)
    expect(result.ok).toBe(true)
  })

  it('非 JSON 文本 → 错误列表含原因', () => {
    const { ok, errors } = validateOutput('抱歉我无法完成', SUMMARY_SCHEMA)
    expect(ok).toBe(false)
    if (!ok) expect(errors[0]).toContain('JSON')
  })
})

describe('5 套内置 schema 的 golden 样本', () => {
  const cases: Array<[string, JsonSchema, Record<string, unknown>]> = [
    ['summary', SUMMARY_SCHEMA, GOOD_SUMMARY],
    ['postmortem', POSTMORTEM_SCHEMA, {
      incident: '接口 502',
      timeline: ['12:03 用户报告', '12:10 定位'],
      root_cause: '上游超时',
      fix: '加重试',
      lessons: ['加监控'],
    }],
    ['tutorial', TUTORIAL_SCHEMA, {
      goal: '学会写 dsh 插件',
      prerequisites: ['Node 20'],
      steps: ['第一步', '第二步', '第三步'],
      key_concepts: ['Cordis 服务'],
      pitfalls: ['忘记 dispose'],
    }],
    ['debug', DEBUG_SCHEMA, {
      problem: '构建失败',
      investigation: '查日志',
      smoking_gun: '第 42 行',
      why_it_failed: '类型不匹配',
      fix: '加注解',
    }],
    ['executive', EXECUTIVE_SCHEMA, {
      what: '做了一个报告工具',
      who: '你和助手',
      when: '今天下午，2 小时',
      outcome: '成功',
      next_actions: ['试用', '反馈'],
    }],
  ]

  it.each(cases)('%s：合法样本通过', (_name, schema, sample) => {
    expect(validateOutput(JSON.stringify(sample), schema).ok).toBe(true)
  })

  it.each(cases)('%s：空对象失败', (_name, schema) => {
    expect(validateOutput('{}', schema).ok).toBe(false)
  })
})

describe('formatErrors', () => {
  it('instancePath + message + keyword 格式', () => {
    const errors = formatErrors([{ instancePath: '/key_steps', message: 'must be array', keyword: 'type' }] as never)
    expect(errors[0]).toBe('/key_steps: must be array (type)')
  })

  it('根路径显示为「根」', () => {
    const errors = formatErrors([{ instancePath: '', message: 'must be object', keyword: 'type' }] as never)
    expect(errors[0]).toBe('根: must be object (type)')
  })

  it('空输入返回空数组', () => {
    expect(formatErrors(null)).toEqual([])
    expect(formatErrors([])).toEqual([])
  })
})
