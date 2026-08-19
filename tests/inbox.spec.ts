import { describe, expect, it } from 'vitest'
import { buildUserMessage, injectUserMessage } from '../src/inbox.ts'
import type { AgentLike, InboxLike, UserMessageLike } from '../src/inbox.ts'

function fakeAgent(): { agent: AgentLike; calls: Array<{ target: 'next-turn' | 'next-step'; start: number; deleteCount: number; inserted: UserMessageLike[] }>; pendingNextTurn: UserMessageLike[] } {
  const pendingNextTurn: UserMessageLike[] = []
  const calls: Array<{ target: 'next-turn' | 'next-step'; start: number; deleteCount: number; inserted: UserMessageLike[] }> = []
  const inbox: InboxLike = {
    nextTurn: pendingNextTurn,
    splice(target, start, deleteCount, inserted) {
      calls.push({ target, start, deleteCount, inserted })
      if (target === 'next-turn') {
        pendingNextTurn.splice(start, deleteCount, ...(inserted as UserMessageLike[]))
      }
      return []
    },
  }
  const agent: AgentLike = { inbox }
  return { agent, calls, pendingNextTurn }
}

describe('buildUserMessage', () => {
  it('构造合法的 user-role 消息', () => {
    const message = buildUserMessage('hello')
    expect(message.role).toBe('user')
    expect(message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(message.source).toEqual({ kind: 'user' })
    expect(typeof message.id).toBe('string')
    expect(message.id.length).toBeGreaterThan(0)
  })

  it('每次 id 唯一', () => {
    expect(buildUserMessage('a').id).not.toBe(buildUserMessage('a').id)
  })
})

describe('injectUserMessage', () => {
  it('追加到 next-turn 末尾（start = 当前长度）', () => {
    const { agent, calls, pendingNextTurn } = fakeAgent()
    injectUserMessage(agent, 'first')
    injectUserMessage(agent, 'second')
    expect(calls.length).toBe(2)
    expect(calls[0]?.target).toBe('next-turn')
    expect(calls[0]?.start).toBe(0)
    expect(calls[0]?.deleteCount).toBe(0)
    expect(calls[1]?.start).toBe(1)
    expect(pendingNextTurn.length).toBe(2)
    expect(pendingNextTurn[0]?.content[0]).toEqual({ type: 'text', text: 'first' })
  })

  it('text 通过 buildUserMessage 包装', () => {
    const { agent, calls } = fakeAgent()
    injectUserMessage(agent, 'summary pls')
    const message = calls[0]?.inserted[0]
    expect(message?.role).toBe('user')
    expect(message?.content[0]).toEqual({ type: 'text', text: 'summary pls' })
    expect(message?.source).toEqual({ kind: 'user' })
  })
})
