/**
 * 报告 HTTP 服务（v1.1.0）：把已落盘的报告通过 webServer 前缀路由
 * `/trace-narrate/<文件名>` 暴露为同源资源，命令回复中给出可点击链接。
 * 安全：文件名白名单（无路径分隔符，阻断目录穿越）、仅 .html/.md/.json、
 * 根目录包含性检查、no-store。
 * 路由契约实测：{ kind: 'prefix', path, handler(req: IncomingMessage, res: ServerResponse) }。
 * @module dsh-trace-narrator/serve
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const REPORT_ROUTE = '/trace-narrate'

const ALLOWED_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,190}\.(html|md|json)$/

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
}

/** 命令回复里的链接（相对路径：随页面同源，不依赖端口）。 */
export function reportUrl(filename: string): string {
  return `${REPORT_ROUTE}/${filename}`
}

export interface ReportServeOptions {
  /** 报告根目录（绝对路径；与写盘时一致的解析结果）。 */
  root: string
  /** 读取器（默认 node fs；生产可注入沙箱化读取）。 */
  readFile?: (path: string) => string
  /** 自定义文件名校验（默认 ALLOWED_NAME）。 */
  isValidName?: (name: string) => boolean
}

function end(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' })
  res.end(body)
}

/**
 * 处理 GET /trace-narrate/<name>：
 *   200 + 报告内容（按扩展名定 content-type）
 *   400 非法文件名 / 405 非 GET / 404 不存在
 * 纯函数（req/res 为结构接口），可在无 Node 服务器环境下测试。
 */
export function handleReportRequest(
  options: ReportServeOptions,
  req: { url?: string; method?: string },
  res: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void },
): void {
  if (req.method !== undefined && req.method !== 'GET') {
    end(res as ServerResponse, 405, 'method not allowed')
    return
  }
  const pathname = (req.url ?? '').split('?')[0] ?? ''
  let name: string
  try {
    name = decodeURIComponent(pathname.slice(REPORT_ROUTE.length + 1))
  } catch {
    end(res as ServerResponse, 400, 'bad request')
    return
  }
  const isValid = options.isValidName ?? ((candidate: string) => ALLOWED_NAME.test(candidate))
  if (!isValid(name)) {
    end(res as ServerResponse, 400, 'invalid report name')
    return
  }
  const root = resolve(options.root)
  const full = resolve(join(root, name))
  if (!full.startsWith(root)) {
    end(res as ServerResponse, 400, 'invalid path')
    return
  }
  try {
    const content = (options.readFile ?? ((path: string) => readFileSync(path, 'utf8')))(full)
    const ext = name.slice(name.lastIndexOf('.') + 1)
    end(res as ServerResponse, 200, content, CONTENT_TYPES[ext] ?? 'application/octet-stream')
  } catch {
    end(res as ServerResponse, 404, 'report not found')
  }
}
