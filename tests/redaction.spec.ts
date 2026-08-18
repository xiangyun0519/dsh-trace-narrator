import { describe, expect, it } from 'vitest'
import { createRedactor } from '../src/redaction/index.ts'
import { enabledDetectors } from '../src/redaction/detectors.ts'
import type { Script } from '../src/script.ts'

const placeholder = (tag: string): RegExp => new RegExp(`^\\[REDACTED:${tag}:[0-9a-f]{8}\\]$`)

describe('enabledDetectors', () => {
  it('按强度级别筛选', () => {
    const ids = (level: 'off' | 'minimal' | 'standard' | 'strict') =>
      enabledDetectors(level).map(d => d.id)
    expect(ids('off')).toEqual([])
    expect(ids('minimal')).toEqual(['connection-strings', 'api-keys', 'api-keys-assign', 'jwt'])
    expect(ids('standard')).toContain('emails')
    expect(ids('standard')).toContain('json-secrets')
    expect(ids('strict')).toContain('pem')
    expect(ids('strict')).toContain('paths')
    expect(ids('strict')).toContain('files')
    expect(ids('strict').length).toBe(11)
  })
})

describe('检测器（strict 默认）', () => {
  const redact = (text: string) => createRedactor().redactText(text).text

  it('api-keys：sk-/ghp_/github_pat_/AKIA/xoxb-', () => {
    const out = redact('sk-abcdefghijklmnopqrstuvwxyz123456')
    expect(out).toMatch(placeholder('API_KEY'))
    expect(redact('ghp_abcdefghijklmnopqrstuvwxyz1234567890')).toMatch(placeholder('API_KEY'))
    expect(redact('github_pat_ABCDEFGHIJKLMNOPQRST12345')).toMatch(placeholder('API_KEY'))
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toMatch(placeholder('API_KEY'))
    expect(redact('xoxb-123456789012-abcdefghij')).toMatch(placeholder('API_KEY'))
  })

  it('api-keys-assign：赋值形态，保留前缀与引号结构', () => {
    expect(redact('token: mysecretvalue123456')).toMatch(/^token: \[REDACTED:API_KEY:[0-9a-f]{8}\]$/)
    expect(redact('password = "abc123def456ghi"')).toMatch(/^password = "\[REDACTED:API_KEY:[0-9a-f]{8}\]"$/)
    expect(redact('api_key=SECRETVALUE12345')).toMatch(/^api_key=\[REDACTED:API_KEY:[0-9a-f]{8}\]$/)
  })

  it('jwt：整段替换', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    expect(redact(jwt)).toMatch(placeholder('JWT'))
  })

  it('connection-strings：保留 scheme 与 host，只换凭证', () => {
    expect(redact('postgres://admin:s3cretpass@db.local:5432/app'))
      .toMatch(/^postgres:\/\/\[REDACTED:CONN:[0-9a-f]{8}\]@db\.local:5432\/app$/)
    expect(redact('mongodb+srv://user:pw123456@cluster0.example.com/db'))
      .toMatch(/^mongodb\+srv:\/\/\[REDACTED:CONN:[0-9a-f]{8}\]@cluster0\.example\.com\/db$/)
  })

  it('emails：只替换本地部分，保留域名', () => {
    const out = redact('联系 alice.bob+tag@example.com 或 bob@corp.io')
    expect(out).toMatch(/\[REDACTED:EMAIL:[0-9a-f]{8}\]@example\.com/)
    expect(out).toMatch(/\[REDACTED:EMAIL:[0-9a-f]{8}\]@corp\.io/)
    expect(out).not.toContain('alice.bob')
  })

  it('ips：IPv4 与 IPv6', () => {
    expect(redact('addr 10.0.0.1')).toContain('[REDACTED:IP:')
    expect(redact('addr 255.255.255.255')).toContain('[REDACTED:IP:')
    expect(redact('addr 2001:db8:85a3:8d3:1319:8a2e:370:7348')).toContain('[REDACTED:IP:')
    expect(redact('addr 2001:db8:85a3:8d3:1319:8a2e:370:7348')).not.toContain('2001:')
  })

  it('urls-token：只换参数值，保留其它参数', () => {
    const out = redact('https://x.com/a?token=abc123secret456&b=2&c=ok')
    expect(out).toContain('?token=[REDACTED:URL_TOKEN:')
    expect(out).toContain('&b=2&c=ok')
  })

  it('json-secrets：保留键名，替换值', () => {
    expect(redact('{"password": "hunter2secret!"}')).toMatch(/^\{"password": "\[REDACTED:JSON_SECRET:[0-9a-f]{8}\]"\}$/)
  })

  it('paths：unix → ~，windows → %USERPROFILE%', () => {
    expect(redact('/home/alice/repo/file.txt')).toBe('~/repo/file.txt')
    expect(redact('C:\\Users\\bob\\AppData\\x')).toBe('%USERPROFILE%\\AppData\\x')
  })

  it('files：敏感文件名', () => {
    expect(redact('cp .env backup')).toContain('[REDACTED:FILE]')
    expect(redact('cat id_rsa.pub')).toContain('[REDACTED:FILE]')
    expect(redact('scp server.pem host:')).toContain('[REDACTED:FILE]')
    expect(redact('kubeconfig here')).toContain('[REDACTED:FILE]')
    expect(redact('rm .git-credentials')).toContain('[REDACTED:FILE]')
    expect(redact('read credentials.json')).toContain('[REDACTED:FILE]')
  })

  it('pem：整块替换', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----'
    const out = redact(pem)
    expect(out).toMatch(placeholder('PEM'))
    expect(out).not.toContain('BEGIN')
  })
})

describe('级别矩阵', () => {
  const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456'
  const email = 'user@example.com'
  const path = '/home/alice/x'

  it('off：不脱敏', () => {
    expect(createRedactor({ level: 'off' }).redactText(secret).text).toBe(secret)
  })

  it('minimal：脱 api-key，不脱邮箱/路径', () => {
    const r = createRedactor({ level: 'minimal' })
    expect(r.redactText(secret).text).toMatch(placeholder('API_KEY'))
    expect(r.redactText(email).text).toBe(email)
    expect(r.redactText(path).text).toBe(path)
  })

  it('standard：脱邮箱，不脱路径', () => {
    const r = createRedactor({ level: 'standard' })
    expect(r.redactText(email).text).not.toContain('user@')
    expect(r.redactText(path).text).toBe(path)
  })

  it('strict：全脱', () => {
    const r = createRedactor()
    expect(r.redactText(path).text).toBe('~/x')
  })
})

describe('确定性占位符', () => {
  it('同一 secret 同一占位符；不同 secret 不同占位符', () => {
    const r = createRedactor()
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456'
    const other = 'sk-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
    expect(r.redactText(secret).text).toBe(r.redactText(secret).text)
    expect(r.redactText(other).text).not.toBe(r.redactText(secret).text)
  })

  it('跨上下文（剧本行 vs 输出物）占位符一致', () => {
    const r = createRedactor()
    const a = r.redactText('key: sk-abcdefghijklmnopqrstuvwxyz123456').text
    const b = r.redactText('again sk-abcdefghijklmnopqrstuvwxyz123456').text
    const ph = /\[REDACTED:API_KEY:[0-9a-f]{8}\]/
    expect(a).toMatch(ph)
    expect(b).toMatch(ph)
    expect(b.match(ph)?.[0]).toBe(a.match(ph)?.[0])
  })

  it('邮箱：同一邮箱在剧本与输出物中占位符一致', () => {
    const r = createRedactor()
    const first = r.redactText('user@example.com').text
    const second = r.redactText('mailto:user@example.com').text
    expect(second).toContain(first)
  })
})

describe('redactScript', () => {
  const script: Script = {
    meta: { sessionId: 'sess_1', eventCount: 3, droppedEvents: 0, truncated: false, turns: 1 },
    steps: [
      { seq: 2, kind: 'user', text: '用这个 token: abcdefghijklmnopqrst' },
      { seq: 4, kind: 'tool-call', text: 'curl -H "Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456" https://x' },
      { seq: 6, kind: 'assistant', text: 'ok, email 是 user@example.com' },
    ],
  }

  it('替换步骤文本并归因 seq', () => {
    const r = createRedactor()
    const { script: out, report } = r.redactScript(script)
    expect(out.steps[0]?.text).not.toContain('abcdefghijklmnopqrst')
    expect(out.steps[1]?.text).toContain('[REDACTED:API_KEY:')
    expect(out.steps[2]?.text).toContain('[REDACTED:EMAIL:')
    const apiKeys = report.detectors.find(d => d.id === 'api-keys-assign')
    expect(apiKeys?.count).toBe(1)
    expect(apiKeys?.eventSeqs).toEqual([2])
    const emails = report.detectors.find(d => d.id === 'emails')
    expect(emails?.eventSeqs).toEqual([6])
    expect(report.total).toBeGreaterThanOrEqual(3)
  })

  it('不修改输入（不可变）', () => {
    const r = createRedactor()
    r.redactScript(script)
    expect(script.steps[0]?.text).toContain('abcdefghijklmnopqrst')
    expect(script.meta.sessionId).toBe('sess_1')
  })

  it('meta 原样保留', () => {
    const r = createRedactor()
    const { script: out } = r.redactScript(script)
    expect(out.meta).toEqual(script.meta)
  })

  it('累计报告：剧本 + 输出物合计', () => {
    const r = createRedactor()
    r.redactScript(script)
    const after = r.redactText('另一次 user@example.com')
    expect(after.report.total).toBe(r.cumulative().total)
    const emails = after.report.detectors.find(d => d.id === 'emails')
    expect(emails?.count).toBe(2)
  })

  it('reset 清空累计', () => {
    const r = createRedactor()
    r.redactScript(script)
    r.reset()
    expect(r.cumulative().total).toBe(0)
    expect(r.cumulative().detectors).toEqual([])
  })
})

describe('报告不变量', () => {
  it('报告与输出不含原文 secret', () => {
    const r = createRedactor()
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456'
    const { text, report } = r.redactText(`use ${secret}`)
    expect(text).not.toContain(secret)
    expect(JSON.stringify(report)).not.toContain(secret)
    expect(JSON.stringify(report)).not.toContain('abcdefghijklmnopqrstuvwxyz')
  })
})
