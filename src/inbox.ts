/**
 * Agent inbox 注入（v1.2.0 对话式改造）：把 user-role 消息塞进当前 agent 的收件箱，
 * 下一轮对话模型会消费它并以自然语言复述（不需要用户再敲键盘）。
 * 契约实测：Agent.inbox: Inbox（公开），Inbox.splice(target, start, deleteCount, inserted)
 * 其中 target='next-turn'（turn 边界消费） / 'next-step'（step 边界）。
 * 我们用 'next-turn'：与对话节拍一致，模型在下一次用户交互时一并复述。
 * @module dsh-trace-narrator/inbox
 */

import { randomUUID } from 'node:crypto'

/** 结构契约：与 @deepseek-ai/dsh-agent 的 Agent / Inbox / UserMessage 对齐。 */
export interface InboxLike {
  splice(
    target: 'next-turn' | 'next-step',
    start: number,
    deleteCount: number,
    inserted: UserMessageLike[],
  ): unknown
  /** 当前 next-turn 消息数（用于 append）。 */
  readonly nextTurn: readonly unknown[]
}

export interface UserMessageLike {
  id: string
  role: 'user'
  content: ContentBlockLike[]
  source: { kind: 'user' }
}

export interface ContentBlockLike {
  type: 'text'
  text: string
}

export interface AgentLike {
  readonly inbox: InboxLike
}

/** 构造一个 user-role 消息。 */
export function buildUserMessage(text: string): UserMessageLike {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

/** 往 next-turn 末尾追加一条 user 消息。 */
export function injectUserMessage(agent: AgentLike, text: string): void {
  const inbox = agent.inbox
  inbox.splice('next-turn', inbox.nextTurn.length, 0, [buildUserMessage(text)])
}
