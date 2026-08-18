# Changelog

每个版本对应 main 上一个 commit + 一个 tag（`vX.Y.Z`），任意 tag 均可安装可回滚。

## v0.2.0 — 脚手架

- `package.json`：`dsh.bundle.patch` 声明、`@deepseek-ai/*` 走 peerDependencies（共享 profile 单一 cordis 实例）、schemastery 为运行时依赖
- `cordis.patch.yml`：插件行 `trace-narrator` + 部署级默认配置（lang/redact/format/预算/audit/upload）
- `src/index.ts`：`TraceNarratorService`（Service 形态，`static inject` + `static Config`）
  - 注册 settings 命名空间 `trace-narrator`（schemastery schema，base = 行配置）
  - 注册 `/trace-narrate` 命令（no-op，回显当前已解析配置）
- `tsconfig.json` / `tsup.config.ts` / `.gitignore`

验收：可安装（`dsh plugin --profile … add`）、可加载（`--dump-config` 可见行与配置）、命令可发现。

## v0.1.0 — 设计定稿

- `docs/design.md`：架构、实测运行时契约、管线、安全模型、版本计划
- `docs/redaction.md`：4 级强度、10 检测器、确定性占位符、审计日志
- `docs/schemas.md`：5 套内置 schema、自定义加载限制、校验与重试
- `README.md`：文档指针
