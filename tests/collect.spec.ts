import { describe, expect, it } from 'vitest'
import { collectStreamText, LlmStreamError } from '../src/llm/collect.ts'
import type { StreamChunkLike } from '../src/llm/collect.ts'

async function* gen(...chunks: StreamChunkLike[]): AsyncIterable<StreamChunkLike> {
  for (const chunk of chunks) yield chunk
}

describe('collectStreamText', () => {
  it('拼接 text-delta 并返回 finish kind 与 usage', async () => {
    const result = await collectStreamText(gen(
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '{"a": ' },
      { type: 'text-delta', index: 0, text: '1}' },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ))
    expect(result.text).toBe('{"a": 1}')
    expect(result.finishKind).toBe('stop')
    expect(result.usage).toEqual({ inputTokens: 1, outputTokens: 2 })
  })

  it('忽略 reasoning/tool-call/块结构 chunk', async () => {
    const result = await collectStreamText(gen(
      { type: 'reasoning-delta', index: 1, text: '思考' },
      { type: 'tool-call-delta', index: 2, id: 'c1', argumentsDelta: '{}' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'x' } },
      { type: 'text-delta', index: 0, text: 'ok' },
      { type: 'finish', reason: { kind: 'stop' } },
    ))
    expect(result.text).toBe('ok')
  })

  it('error finish 抛 LlmStreamError 并带失败信息', async () => {
    const error = await collectStreamText(gen(
      { type: 'finish', reason: { kind: 'error', failure: { message: 'backend 500', code: 'HTTP' } } },
    )).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmStreamError)
    expect((error as LlmStreamError).kind).toBe('error')
    expect((error as LlmStreamError).message).toContain('backend 500')
  })

  it('aborted finish 抛 LlmStreamError', async () => {
    const error = await collectStreamText(gen(
      { type: 'finish', reason: { kind: 'aborted', failure: { message: 'cancelled', code: 'ABORTED' } } },
    )).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmStreamError)
    expect((error as LlmStreamError).kind).toBe('aborted')
  })

  it('流在 finish 前结束抛错', async () => {
    await expect(collectStreamText(gen(
      { type: 'text-delta', index: 0, text: 'unfinished' },
    ))).rejects.toBeInstanceOf(LlmStreamError)
  })

  it('空流抛错', async () => {
    await expect(collectStreamText(gen())).rejects.toBeInstanceOf(LlmStreamError)
  })
})
