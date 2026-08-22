# 发布与安装指南

本文只描述 `dsh-trace-narrator` 的公开交付，不包含账号登录、token 或自动发布凭据。

## 1. 发布前检查

在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm pack --dry-run
```

`pack --dry-run` 的内容至少应包含：

- `lib/index.js`
- `lib/index.d.ts`
- `cordis.patch.yml`
- `package.json`
- `README.md`
- `LICENSE`

不应包含 `src/`、`tests/`、`.env`、会话日志或本机路径记录。

## 2. 源码安装

源码安装适合当前仓库验证和贡献者开发：

```bash
git clone https://github.com/xiangyun0519/dsh-trace-narrator.git
cd dsh-trace-narrator
pnpm install
pnpm build
dsh plugin --profile web add link:/absolute/path/to/dsh-trace-narrator
```

安装后重启 dsh，在会话中运行 `/trace-narrate`。如果需要反复改源码，重新执行 `pnpm build` 即可。

## 3. npm 发布

只有拥有该 npm 包发布权限的维护者才执行发布。发布前先确认版本号、远程提交和打包内容，登录状态通过 npm 自己的命令确认，不要把 token 写入命令行历史或仓库文件。

```bash
npm whoami
npm publish --access public
```

发布后确认：

```bash
npm view dsh-trace-narrator version
npm view dsh-trace-narrator repository.url
```

随后在一台干净环境中验证：

```bash
dsh plugin --profile web add dsh-trace-narrator
```

## 4. GitHub Release

GitHub Release 应对应一个已经验证过的 tag。Release 内容至少包含：

1. 本版本新增或修复的用户能力；
2. 安装命令；
3. DSH、Node.js 和 peer dependency 要求；
4. 已运行的测试、typecheck、build 和 package 检查；
5. 已知限制，尤其是本地报告与自托管 viewer 的边界。

不要把会话日志、构建机路径、凭据记录或未脱敏报告上传到 Release 附件。

## 5. 发布后首轮验证

发布完成后从用户视角检查：

- npm 页面能打开，版本和 README 与 GitHub 一致；
- `dsh plugin` 能安装包，重启后能发现 `/trace-narrate`；
- `/trace-narrate` 能生成 HTML，并能在 DSH web GUI 中打开同源链接；
- README 的示例链接、Issues 链接和 CI 徽章都能打开；
- 首批反馈只收集安装失败、命令失败和报告质量问题，不把“有 star”当成产品可用性的替代指标。
