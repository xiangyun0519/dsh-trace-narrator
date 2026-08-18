import { describe, expect, it } from 'vitest'
import { loadSessionLog, SessionReadError } from '../src/reader.ts'
import type { SessionEventLike, SessionLogSnapshotLike } from '../src/reader.ts'

const good: SessionLogSnapshotLike = {
  session: { id: 'sess_1', cwd: 'F:/x' },
  events: [{ type: 'user/message', seq: 1, time: 1000, data: {} } as SessionEventLike],
}

describe('loadSessionLog', () => {
  it('成功返回快照', async () => {
    const source = { async readSession(id: string) { return good } }
    await expect(loadSessionLog(source, 'sess_1')).resolves.toBe(good)
  })

  it('空 sessionId 拒绝', async () => {
    const source = { async readSession() { return good } }
    await expect(loadSessionLog(source, '')).rejects.toMatchObject({
      code: 'SESSION_READ_FAILED',
    })
  })

  it('源抛错时包装为 SessionReadError 且保留 sessionId', async () => {
    const source = {
      async readSession() { throw new Error('backend down') },
    }
    const error = await loadSessionLog(source, 'sess_9').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SessionReadError)
    expect((error as SessionReadError).sessionId).toBe('sess_9')
    expect((error as SessionReadError).message).toContain('backend down')
  })

  it('返回结构不满足快照契约时拒绝', async () => {
    const source = { async readSession() { return { session: {}, events: 'nope' } } }
    await expect(loadSessionLog(source, 'sess_1')).rejects.toBeInstanceOf(SessionReadError)
  })

  it('已是 SessionReadError 不二次包装', async () => {
    const source = {
      async readSession() { throw new SessionReadError('sess_1', 'inner') },
    }
    const error = await loadSessionLog(source, 'sess_1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SessionReadError)
    expect((error as SessionReadError).cause).toBe('inner')
  })
})
