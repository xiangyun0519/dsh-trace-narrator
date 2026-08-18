# 脱敏规则（redaction）

> 设计定稿 v0.1.0 ｜实现：v0.4.0 ｜实现细节以本文档为准，冲突时回看 `docs/design.md` §6。

## 1. 原则（不可违反）

1. **先于 LLM**：剧本在离开本地前必须已完成脱敏（管线第 5 步，永远先于第 7 步）。
2. **确定性占位**：同一 secret 在同一轮报告内的所有出现（剧本 + 三种输出物）映射到同一占位符。
3. **审计不含原文**：`audit.ts` 的公开 API 只接受 `{detector, count, eventSeqs}`，**类型层面禁止传入匹配文本**；不记录原文、不记录 secret→占位符映射。
4. **输出物全覆盖**：HTML/MD/JSON 渲染输出在落盘/上传前二次过同一管线（防御 LLM 复述 secret）。
5. **占位符映射只存内存**，报告渲染完毕即丢弃；绝不序列化。

## 2. 强度级别

| 级别 | 启用检测器 | 说明 |
|---|---|---|
| `off` | 无 | 显式关闭；确认步骤会加红色警告「未脱敏」 |
| `minimal` | api-keys、jwt、connection-strings | 最小可用 |
| `standard` | + emails、ips、urls-token、json-secrets | 常规 |
| `strict`（默认） | + paths、files、pem | 含路径与密钥文件块 |

## 3. 检测器规范

执行顺序即下表顺序（先块级、后键值、再裸 token，避免重复匹配）。

| id | 正则（JS 字面量语义） | 替换策略 |
|---|---|---|
| pem | `/-----BEGIN [A-Z0-9 ]*(?:PRIVATE\|RSA\|EC\|DSA\|OPENSSH)[A-Z0-9 ]*-----[\s\S]*?-----END [A-Z0-9 ]*-----/gi` | 整块 → `[REDACTED:PEM:<h>]` |
| json-secrets | `/"((?:password\|passwd\|secret\|token\|api[_-]?key\|access[_-]?key\|client[_-]?secret\|private[_-]?key))"\s*:\s*"([^"]{4,})"/gi` | 保留键名，值 → `[REDACTED:JSON_SECRET:<h>]` |
| urls-token | `/(https?:\/\/[^\s"'<>]+[?&#](?:token\|access_token\|key\|api_key\|sig\|signature\|auth\|password\|code\|secret)=)[^&\s"'<>]+/gi` | 保留 URL 与参数名，值 → `[REDACTED:URL_TOKEN:<h>]` |
| connection-strings | `/\b(?:postgres(?:ql)?\|mysql\|mariadb\|mongodb(?:\+srv)?\|redis\|rediss\|amqps?\|mssql\|sqlserver):\/\/[^\s"'<>]*:[^\s"'<>@]*@/gi` | 凭证部分 → `[REDACTED:CONN:<h>]`（保留 scheme 与 host） |
| api-keys | `/sk-[A-Za-z0-9_-]{16,}/g`；`/ghp_[A-Za-z0-9]{30,}/g`；`/github_pat_[A-Za-z0-9_]{20,}/g`；`/AKIA[0-9A-Z]{16}/g`；`/xox[baprs]-[A-Za-z0-9-]{10,}/g` | 整体 → `[REDACTED:API_KEY:<h>]` |
| api-keys-assign | `/(?:api[_-]?key\|apikey\|secret\|token\|password\|passwd)\s*[:=]\s*['"]?([A-Za-z0-9._~+/=-]{12,})/gi` | 仅替换捕获组 1 → `[REDACTED:API_KEY:<h>]` |
| jwt | `/eyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g` | 整体 → `[REDACTED:JWT:<h>]` |
| emails | `/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g` | 仅替换本地部分 → `[REDACTED:EMAIL:<h>]@域名`（保留域名保持可读性） |
| ips | IPv4：`/(?<!\d)(?:25[0-5]\|2[0-4]\d\|1?\d?\d)(?:\.(?:25[0-5]\|2[0-4]\d\|1?\d?\d)){3}(?!\d)/g`；IPv6（近似）：`/(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}/g` | 整体 → `[REDACTED:IP:<h>]` |
| paths | unix：`/\/home\/[A-Za-z0-9._-]+(?=[\/\s"'<])/g`；windows：`/[A-Za-z]:\\Users\\[A-Za-z0-9._-]+(?=[\\\s"'<])/gi` | unix → `~`；windows → `%USERPROFILE%`（无需 hash：用户名本身即敏感） |
| files | `/\b\.env\b/gi`；`/id_rsa(?:\.pub)?/g`；`/id_ed25519(?:\.pub)?/g`；`/\.pem\b/gi`；`/\.key\b/gi`；`/\bkubeconfig\b/gi`；`/\.git-credentials\b/gi`；`/\bcredentials\.json\b/gi` | 文件名 → `[REDACTED:FILE]`（无 hash：文件名不是 secret，是标记） |

**占位符算法**：`h = sha256(被替换文本).slice(0, 8)`（hex）。`<h>` 省略的情形见上表。哈希输入是**原样匹配串**（不规范化），保证同一 secret 的重复出现得到同一占位符；不同 secret 哈希碰撞概率可接受（8 hex = 2^32，报告尺度下无实际风险）。

**已知边界**（文档化，不视为 bug）：
- IPv6 检测器是近似值（不校验合法性），`standard` 级别即可用；误伤以「宁可多脱」为准。
- `files` 检测器存在误报可能（如代码注释中讨论 `.env`），strict 级别接受此代价。
- 压缩后的剧本里 `tool-call` 行只有 512 字符，长 secret 可能被截断 → 检测器对截断处不保证（设计上接受；预算截断发生在脱敏**之后**以避免此类问题——实现时注意顺序）。

## 4. 审计日志

- 位置：`$DSH_HOME/trace-narrator/audit.jsonl`（可用 `settings.audit.dir` 覆盖）。
- 格式（每轮一次一行）：
  ```jsonc
  {"ts":1710000000000,"sessionId":"sess_…","level":"strict",
   "total":7,"detectors":[{"id":"api-keys","count":2,"eventSeqs":[12,18]},
                            {"id":"emails","count":3,"eventSeqs":[15,20,22]}],
   "confirmed":true,"sent":true}
  ```
- `eventSeqs` 只记**前 20 个**出现位置，超出加 `"truncated":true`；`sent` 表示确认通过并实际调用 LLM，`confirmed=false` 表示用户取消（审计仍记，因为预览统计本身有价值）。
- 轮转：单文件超过 `maxBytes`（默认 1MB）→ `audit.jsonl → audit.1.jsonl`，保留 `keep`（默认 3）份。
- 权限：创建时尽力 0600（Windows 上为 ACL 尽力而为，文档注明）。

## 5. 预览统计格式（确认步骤展示）

```
本次将发送：事件 142 条 → 剧本 96 行（token 预算 12000）
脱敏替换 7 处：api-keys 2｜emails 3｜json-secrets 2
```
