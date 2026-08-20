# dsh-trace-narrator

[![npm version](https://img.shields.io/npm/v/dsh-trace-narrator?color=blue)](https://www.npmjs.com/package/dsh-trace-narrator)
[![license](https://img.shields.io/npm/l/dsh-trace-narrator?color=green)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)
[![DSH](https://img.shields.io/badge/DSH-cordis%20v4-purple)](https://github.com/deepseek-ai/deepseek-harness)

> **TL;DR** — 装一行，重启 dsh，任意会话输 `/trace-narrate` → 命令回短确认 + 同源链接，对话模型下一轮把总结讲给你听（不是按钮、不是文件清单）。

把 dsh 最被称赞的 trajectory 从本地私有日志变成可分享、可复盘、可教学的结构化报告——并让对话模型接管叙述。

## 安装

DSH 的插件管理走 `dsh plugin`，它会把包装进指定 profile 的 `node_modules` 并写入对应的 `cordis.patch.yml`：

```bash
# 装到 web profile（默认 GUI 入口；想装别的就把 web 换掉）
dsh plugin --profile web add dsh-trace-narrator
```

> 首次安装后**重启 dsh**，`/trace-narrate` 命令即出现在任意会话里。
> 本地开发请用 `dsh plugin --profile web add link:/path/to/dsh-trace-narrator`，源码改动随 `pnpm build` 生效。

**前置要求**：Node ≥ 20 · DSH ≥ 0.0.1-rc.1（cordis v4 · `@deepseek-ai/dsh-commands` & `-settings` ≥ 0.1.0-rc.6）

## 快速开始

```bash
# 1. 当前会话 → summary + HTML + strict 脱敏（默认）
/trace-narrate

# 2. 指定历史会话 + 自定义 schema + Markdown 输出
/trace-narrate sess_abc --schema postmortem --lang en --format md

# 3. 用本地 JSON schema + 最小脱敏
/trace-narrate --schema ./my-schema.json --redact minimal

# 4. 显式上报到自托管 viewer（默认不开 → 绝不联网）
/trace-narrate --upload https://viewer.myteam.com
```

命令回复会直接给可点击链接（在 DSH web GUI 内）打开自包含 HTML 报告；当前对话模型在**下一轮自然复述**总结 + 后续动作建议。

## 特性

- **对话式复述**（v1.2+）— 命令只回短确认，对话模型接管叙述：2-3 关键点 + 报告链接 + 主动建议 1-2 个后续动作（导出 Markdown / 入知识库 / 调整 schema 重跑）
- **`/trace-narrate` 命令** — 当前会话或任意历史会话 → 结构化报告
- **5 套内置 schema** + 自定义（本地路径 / HTTPS URL / 已保存名）：`summary` / `postmortem` / `tutorial` / `debug` / `executive`
- **默认 strict 脱敏** — 11 个检测器 · 确定性占位符 `[REDACTED:TYPE:hash8]` · 审计只记类别与计数（**无原文**）
- **三种输出** — 自包含 HTML（零外部资源） · Markdown · JSON（便于二次处理）
- **三层安全** — 发送前确认 · 注入防护（trace→LLM 包封 DATA，LLM→HTML 全量转义） · LLM 输出 ajv 校验 + 重试
- **opt-in 上报** — 自托管 viewer 协议（HTTPS-only · token 走环境变量）· 不开 `--upload` 绝不联网

## 命令参考

```text
/trace-narrate [sessionId]
 [--schema <name|path|url>]
 [--lang zh-CN|en|ja]
 [--redact off|minimal|standard|strict]
 [--format html|md|json]
 [--output <dir>]
 [--token-budget <n>] [--max-tokens <n>]
 [--yes|--no-confirm]
 [--upload <endpoint>]
 [--help]
```

完整退出码 / 确认语义 / settings 面板字段见 [docs/usage.md](docs/usage.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/usage.md](docs/usage.md) | 安装 · 命令 · 配置（settings 面板 `trace-narrator` 命名空间） · 上报协议 · 审计 · 安全模型 · 已知限制 |
| [docs/design.md](docs/design.md) | 架构 · 运行时契约（实测） · 管线 · 版本计划 |
| [docs/redaction.md](docs/redaction.md) | 4 级脱敏 · 11 个检测器 · 占位符规范 · 审计日志 |
| [docs/schemas.md](docs/schemas.md) | 5 套内置 schema · 自定义加载 · ajv 校验 · 重试策略 |
| [examples/custom-schema.json](examples/custom-schema.json) | 自定义 schema 完整示例 |
| [CHANGELOG.md](CHANGELOG.md) | 版本历史（每个 tag 都可回滚安装） |

## 开发

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest（200 用例 + golden 快照）
pnpm build       # tsup → lib/
```

## 版本与回滚

每个版本对应 main 上一个 commit + 一个 tag（`vX.Y.Z`），任意 tag 都可安装可回滚：

```bash
git checkout v1.2.1   # 回到任意历史版本
```

完整版本历史见 [CHANGELOG.md](CHANGELOG.md)。

## License

[MIT](./LICENSE)
