import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/args.ts'

describe('parseArgs', () => {
  it('空输入', () => {
    expect(parseArgs('')).toEqual({ ok: true, sessionId: undefined, overrides: {}, help: false })
  })

  it('位置参数为 sessionId', () => {
    const parsed = parseArgs('sess_abc')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.sessionId).toBe('sess_abc')
  })

  it('值 flag（空格与 = 两种形态）', () => {
    const a = parseArgs('--schema postmortem --lang en')
    const b = parseArgs('--redact=minimal --format=json')
    expect(a.ok && a.overrides).toMatchObject({ schema: 'postmortem', lang: 'en' })
    expect(b.ok && b.overrides).toMatchObject({ redact: 'minimal', format: 'json' })
  })

  it('布尔 flag：--yes / --no-confirm 均跳过确认', () => {
    expect(parseArgs('--yes').ok && parseArgs('--yes').overrides.confirm).toBe(false)
    expect(parseArgs('--no-confirm').ok && parseArgs('--no-confirm').overrides.confirm).toBe(false)
  })

  it('--help', () => {
    expect(parseArgs('--help')).toMatchObject({ ok: true, help: true })
  })

  it('数值 flag 与边界', () => {
    expect(parseArgs('--token-budget 12000').ok && parseArgs('--token-budget 12000').overrides.tokenBudget).toBe(12000)
    expect(parseArgs('--token-budget 100').ok).toBe(false)
    expect(parseArgs('--token-budget abc').ok).toBe(false)
    expect(parseArgs('--max-tokens 2048').ok && parseArgs('--max-tokens 2048').overrides.maxTokens).toBe(2048)
    expect(parseArgs('--max-tokens 100').ok).toBe(false)
  })

  it('非法枚举报错', () => {
    expect(parseArgs('--lang fr').ok).toBe(false)
    expect(parseArgs('--redact super').ok).toBe(false)
    expect(parseArgs('--format pdf').ok).toBe(false)
  })

  it('未知 flag / 缺值 / 多位置参数报错', () => {
    expect(parseArgs('--wat x').ok).toBe(false)
    expect(parseArgs('--schema').ok).toBe(false)
    expect(parseArgs('a b').ok).toBe(false)
  })

  it('错误信息给出原因', () => {
    const parsed = parseArgs('--wat x')
    if (!parsed.ok) expect(parsed.errors.some(e => e.includes('--wat'))).toBe(true)
  })
})
