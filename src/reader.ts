/**
 * 会话日志读取。
 * v0.3.0：纯函数 + 可注入源（DI，便于无 DSH 环境测试）；
 * 命令层接线（默认当前会话、显式 sessionId）在 v0.8.0。
 *
 * 结构类型与 @deepseek-ai/dsh-session 的 SessionHeader / SessionEvent、
 * @deepseek-ai/dsh-session-query 的 SessionLogSnapshot 对齐（0.1.0-rc.x 实测），
 * 故意不引入运行时依赖：sessionQuery.readSession 的返回满足这些结构即可传入。
 * @module dsh-trace-narrator/reader
 */

export interface SessionHeaderLike {
  id: string
  [key: string]: unknown
}

export interface SessionEventLike {
  type: string
  seq: number
  time: number
  data: unknown
  [key: string]: unknown
}

export interface SessionLogSnapshotLike {
  session: SessionHeaderLike
  events: readonly SessionEventLike[]
}

/** 可注入的读取源；生产实现为 ctx.sessionQuery（v0.8.0 接线）。 */
export interface SessionLogSource {
  readSession(sessionId: string): Promise<SessionLogSnapshotLike>
}

/** 会话读取失败（映射命令退出码 3，见 docs/design.md §8）。 */
export class SessionReadError extends Error {
  readonly code = 'SESSION_READ_FAILED'

  constructor(
    public readonly sessionId: string,
    public readonly cause: unknown,
  ) {
    super(`trace-narrator: 会话 "${sessionId}" 读取失败：${String(cause)}`)
    this.name = 'SessionReadError'
  }
}

function isSnapshotLike(value: unknown): value is SessionLogSnapshotLike {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { session?: unknown; events?: unknown }
  return candidate !== null
    && typeof candidate.session === 'object'
    && (candidate.session as SessionHeaderLike).id !== undefined
    && Array.isArray(candidate.events)
}

/**
 * 读取一个会话的完整日志快照。
 * @throws {SessionReadError} sessionId 非法、源抛错、或返回结构不满足快照契约。
 */
export async function loadSessionLog(
  source: SessionLogSource,
  sessionId: string,
): Promise<SessionLogSnapshotLike> {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new SessionReadError(String(sessionId), 'sessionId 必须是非空字符串')
  }
  try {
    const snapshot: unknown = await source.readSession(sessionId)
    if (!isSnapshotLike(snapshot)) {
      throw new SessionReadError(sessionId, '读取结果不满足快照契约（缺少 session.id 或 events 数组）')
    }
    return snapshot
  } catch (error) {
    if (error instanceof SessionReadError) throw error
    throw new SessionReadError(sessionId, error)
  }
}
