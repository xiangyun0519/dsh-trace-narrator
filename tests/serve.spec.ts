import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleReportRequest, REPORT_ROUTE, reportUrl } from '../src/serve.ts'

interface MockRes {
  status?: number
  headers?: Record<string, string>
  body?: string
}

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'trace-narrator-serve-'))
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'r.html'), '<h1>hi</h1>')
  writeFileSync(join(root, 'r.md'), '# hi')
  writeFileSync(join(root, 'r.json'), '{"a":1}')
  writeFileSync(join(root, 'secret.txt'), 'SECRET_OUTSIDE')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function call(url: string, method = 'GET'): MockRes {
  const res: MockRes = {}
  handleReportRequest({ root }, { url, method }, {
    writeHead(status, headers) {
      res.status = status
      res.headers = headers
    },
    end(body) {
      res.body = body
    },
  })
  return res
}

describe('reportUrl', () => {
  it('生成同源相对链接', () => {
    expect(reportUrl('a.html')).toBe(`${REPORT_ROUTE}/a.html`)
  })
})

describe('handleReportRequest', () => {
  it('按扩展名返回报告与 content-type', () => {
    expect(call(`${REPORT_ROUTE}/r.html`)).toMatchObject({
      status: 200, body: '<h1>hi</h1>', headers: { 'content-type': 'text/html; charset=utf-8' },
    })
    expect(call(`${REPORT_ROUTE}/r.md`)).toMatchObject({ status: 200, body: '# hi' })
    expect(call(`${REPORT_ROUTE}/r.json`)).toMatchObject({ status: 200, body: '{"a":1}' })
  })

  it('查询串被剥离', () => {
    expect(call(`${REPORT_ROUTE}/r.html?a=1&b=2`)).toMatchObject({ status: 200 })
  })

  it('不存在 → 404', () => {
    expect(call(`${REPORT_ROUTE}/ghost.html`)).toMatchObject({ status: 404 })
  })

  it('目录穿越 → 400（不泄露根外文件）', () => {
    expect(call(`${REPORT_ROUTE}/..%2F..%2Fsecret.txt`)).toMatchObject({ status: 400 })
    expect(call(`${REPORT_ROUTE}/..%2Fsecret.txt`)).toMatchObject({ status: 400 })
  })

  it('非法扩展名 → 400', () => {
    expect(call(`${REPORT_ROUTE}/evil.exe`)).toMatchObject({ status: 400 })
  })

  it('无文件名（仅前缀）→ 400', () => {
    expect(call(REPORT_ROUTE)).toMatchObject({ status: 400 })
  })

  it('非 GET → 405', () => {
    expect(call(`${REPORT_ROUTE}/r.html`, 'POST')).toMatchObject({ status: 405 })
  })

  it('读取失败 → 404（不泄露错误细节）', () => {
    const res: MockRes = {}
    handleReportRequest({ root, readFile: () => { throw new Error('boom') } }, { url: `${REPORT_ROUTE}/r.html` }, {
      writeHead(status, headers) { res.status = status; res.headers = headers },
      end(body) { res.body = body },
    })
    expect(res.status).toBe(404)
    expect(res.body).not.toContain('boom')
  })

  it('bad percent-encoding → 400', () => {
    expect(call(`${REPORT_ROUTE}/%E0%A4%A.html`)).toMatchObject({ status: 400 })
  })
})
