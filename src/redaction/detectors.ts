/**
 * 检测器表：与 docs/redaction.md §3 一一对应，执行顺序即表序
 * （先块级、再键值、再裸 token，避免重复匹配）。
 *
 * 每个检测器的 apply 返回 { text, count }；需要哈希占位符的替换调用
 * redact(secret) 回调，固定替换（paths/files）自行计数。
 * @module dsh-trace-narrator/redaction/detectors
 */

import type { RedactLevel } from '../config.ts'

export type DetectorId =
  | 'pem'
  | 'json-secrets'
  | 'urls-token'
  | 'connection-strings'
  | 'api-keys'
  | 'api-keys-assign'
  | 'jwt'
  | 'emails'
  | 'ips'
  | 'paths'
  | 'files'

export interface DetectorResult {
  text: string
  count: number
}

export interface Detector {
  id: DetectorId
  /** 启用该检测器所需的最低强度级别。 */
  level: Exclude<RedactLevel, 'off'>
  apply(text: string, redact: (secret: string) => string): DetectorResult
}

const LEVEL_ORDER: Record<RedactLevel, number> = { off: 0, minimal: 1, standard: 2, strict: 3 }

/** 按强度级别筛出启用的检测器（保持表序）。 */
export function enabledDetectors(level: RedactLevel): readonly Detector[] {
  const threshold = LEVEL_ORDER[level]
  return DETECTORS.filter(detector => LEVEL_ORDER[detector.level] <= threshold)
}

const API_KEY_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9]{30,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
]

const FILE_PATTERNS: readonly RegExp[] = [
  /\.env\b/gi,
  /id_rsa(?:\.pub)?/g,
  /id_ed25519(?:\.pub)?/g,
  /\.pem\b/gi,
  /\.key\b/gi,
  /\bkubeconfig\b/gi,
  /\.git-credentials\b/gi,
  /\bcredentials\.json\b/gi,
]

export const DETECTORS: readonly Detector[] = [
  {
    // PEM / 私钥块：整块替换。
    id: 'pem',
    level: 'strict',
    apply(text, redact) {
      let count = 0
      const out = text.replace(
        /-----BEGIN [A-Z0-9 ]*(?:PRIVATE|RSA|EC|DSA|OPENSSH)[A-Z0-9 ]*-----[\s\S]*?-----END [A-Z0-9 ]*-----/gi,
        match => {
          count += 1
          return redact(match)
        },
      )
      return { text: out, count }
    },
  },
  {
    // JSON 键值对：保留键名，只替换值。
    id: 'json-secrets',
    level: 'standard',
    apply(text, redact) {
      let count = 0
      const out = text.replace(
        /"((?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key))"\s*:\s*"([^"]{4,})"/gi,
        (_match, key: string, value: string) => {
          count += 1
          return `"${key}": "${redact(value)}"`
        },
      )
      return { text: out, count }
    },
  },
  {
    // 带 token 的 URL：保留 URL 与参数名，只替换值。
    id: 'urls-token',
    level: 'standard',
    apply(text, redact) {
      let count = 0
      const out = text.replace(
        /https?:\/\/[^\s"'<>]+[?&#](?:token|access_token|key|api_key|sig|signature|auth|password|code|secret)=[^&\s"'<>]+/gi,
        match => {
          const eq = match.lastIndexOf('=')
          count += 1
          return `${match.slice(0, eq + 1)}${redact(match.slice(eq + 1))}`
        },
      )
      return { text: out, count }
    },
  },
  {
    // 连接串：保留 scheme 与 host，只替换凭证部分（user:pass）。
    id: 'connection-strings',
    level: 'minimal',
    apply(text, redact) {
      let count = 0
      const out = text.replace(
        /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|sqlserver):\/\/[^\s"'<>]*:[^\s"'<>@]*@/gi,
        match => {
          const schemeEnd = match.indexOf('://') + 3
          const at = match.lastIndexOf('@')
          count += 1
          return `${match.slice(0, schemeEnd)}${redact(match.slice(schemeEnd, at))}@`
        },
      )
      return { text: out, count }
    },
  },
  {
    // 知名 API key 前缀族。
    id: 'api-keys',
    level: 'minimal',
    apply(text, redact) {
      let count = 0
      let out = text
      for (const pattern of API_KEY_PATTERNS) {
        out = out.replace(pattern, match => {
          count += 1
          return redact(match)
        })
      }
      return { text: out, count }
    },
  },
  {
    // 赋值形态的通用密钥（key=value / key: value / key: "value"）。
    id: 'api-keys-assign',
    level: 'minimal',
    apply(text, redact) {
      let count = 0
      const out = text.replace(
        /((?:api[_-]?key|apikey|secret|token|password|passwd)\s*[:=]\s*['"]?)([A-Za-z0-9._~+/=-]{12,})/gi,
        (_match, prefix: string, value: string) => {
          count += 1
          return `${prefix}${redact(value)}`
        },
      )
      return { text: out, count }
    },
  },
  {
    // JWT（三段式）。
    id: 'jwt',
    level: 'minimal',
    apply(text, redact) {
      let count = 0
      const out = text.replace(
        /eyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
        match => {
          count += 1
          return redact(match)
        },
      )
      return { text: out, count }
    },
  },
  {
    // 邮箱：只替换本地部分，保留域名（报告可读性）。
    id: 'emails',
    level: 'standard',
    apply(text, redact) {
      let count = 0
      const out = text.replace(
        /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
        (_match, local: string, domain: string) => {
          count += 1
          return `${redact(`${local}@${domain}`)}@${domain}`
        },
      )
      return { text: out, count }
    },
  },
  {
    // IP 地址：IPv4 精确、IPv6 近似（宁可多脱）。
    id: 'ips',
    level: 'standard',
    apply(text, redact) {
      let count = 0
      // IPv4 带数字边界保护（版本号误报是文档化的接受代价）。
      let out = text.replace(/(?<!\d)(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?!\d)/g, match => {
        count += 1
        return redact(match)
      })
      // IPv6 近似：要求 ≥3 个冒号（全形 7、MAC 5；时间 HH:MM:SS 只有 2 个，必须放过）。
      out = out.replace(/(?:[0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{0,4}/g, match => {
        count += 1
        return redact(match)
      })
      return { text: out, count }
    },
  },
  {
    // 家目录路径：unix → ~，windows → %USERPROFILE%（无需哈希：用户名本身即敏感）。
    id: 'paths',
    level: 'strict',
    apply(text) {
      let count = 0
      let out = text.replace(/\/home\/[A-Za-z0-9._-]+(?=[\/\s"'<])/g, () => {
        count += 1
        return '~'
      })
      out = out.replace(/[A-Za-z]:\\Users\\[A-Za-z0-9._-]+(?=[\\\s"'<])/gi, () => {
        count += 1
        return '%USERPROFILE%'
      })
      return { text: out, count }
    },
  },
  {
    // 敏感文件名（无哈希：文件名是标记而非 secret）。
    id: 'files',
    level: 'strict',
    apply(text) {
      let count = 0
      let out = text
      for (const pattern of FILE_PATTERNS) {
        out = out.replace(pattern, () => {
          count += 1
          return '[REDACTED:FILE]'
        })
      }
      return { text: out, count }
    },
  },
]
