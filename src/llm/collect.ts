/**
 * 流式输出收集（结构类型，与 @deepseek-ai/dsh-llm 的 StreamChunk 对齐，
 * 0.1.0-rc.x 实测）：拼接 text-delta，终点是 finish chunk（含 usage）；
 * error/aborted 终结抛 LlmStreamError。生产接线（ctx.llm.prepareCall + stream）
 * 在 v0.8.0 的 narrator 中完成。
 * @module dsh-trace-narrator/llm/collect
 */

export interface StreamChunkLike {
  type: string
  text?: string
  reason?: unknown
  usage?: unknown
  [key: string]: unknown
}

export class LlmStreamError extends Error {
  readonly code = 'LLM_STREAM_FAILED'

  constructor(
    message: string,
    public readonly kind?: string,
  ) {
    super(`trace-narrator: LLM 流失败：${message}`)
    this.name = 'LlmStreamError'
  }
}

export interface CollectedText {
  /** 全部可见文本增量（reasoning/tool-call/块结构均忽略）。 */
  text: string
  /** finish.reason.kind（stop/tool-calls/max-tokens/…）。 */
  finishKind?: string
  /** usage 块（TokenUsage，结构未知时原样透传）。 */
  usage?: unknown
}

export async function collectStreamText(chunks: AsyncIterable<StreamChunkLike>): Promise<CollectedText> {
  let text = ''
  let usage: unknown
  for await (const chunk of chunks) {
    switch (chunk.type) {
      case 'text-delta':
        if (typeof chunk.text === 'string') text += chunk.text
        break
      case 'usage':
        usage = chunk.usage
        break
      case 'finish': {
        const reason = chunk.reason as { kind?: string; failure?: { message?: string } } | null | undefined
        const kind = reason?.kind
        if (kind === 'error' || kind === 'aborted') {
          throw new LlmStreamError(reason?.failure?.message ?? `流以 ${String(kind)} 终结`, kind)
        }
        return { text, finishKind: kind, usage }
      }
      default:
        // block-start / block-end / reasoning-delta / tool-call-delta：总结只需可见文本。
        break
    }
  }
  throw new LlmStreamError('流在 finish 之前结束')
}
