# 清理本机 GitHub / Gitee 账号记录

> 扫描时间：2026-08-19  
> 适用系统：Windows（PowerShell）  
> 用户：`祥云`（`C:\Users\Administrator`）

本机当前与 GitHub / Gitee 相关的痕迹分布在 **4 个地方**。逐项处理后即可让本机"不再认识"这两个平台。

---

## 总览

| # | 位置 | 内容 | 是否可逆 |
|---|---|---|---|
| 1 | Windows 凭据管理器 | GitHub / Gitee 的 HTTPS 登录 token | ✅ 重登即可 |
| 2 | `C:\Users\Administrator\.gitconfig` | 用户身份 + gitee 的 generic provider 配置 | ✅ 重配即可 |
| 3 | `C:\Users\Administrator\.ssh\` | 个人 SSH 私钥 + known_hosts | ⚠️ 私钥删了要重传 |
| 4 | `F:\deepseek\dsh-trace-narrator\dsh-trace-narrator\.git\config` | 仓库的 `origin` 指向 GitHub | ✅ 重 `git remote add` 即可 |

---

## 1. Windows 凭据管理器

`cmdkey /list` 输出：

```
LegacyGeneric:target=git:https://github.com     User: xiangyun0519
LegacyGeneric:target=git:https://gitee.com
```

### 方式 A：命令行（推荐）

```powershell
cmdkey /delete:LegacyGeneric:target=git:https://github.com
cmdkey /delete:LegacyGeneric:target=git:https://gitee.com
```

### 方式 B：图形界面

`Win + R` → 输入 `control /name Microsoft.CredentialManager` → `Windows 凭据` 选项卡 → 找到 `git:https://github.com` 和 `git:https://gitee.com` → 展开 → `删除`。

> 凭据是 HTTPS 推送的凭据。删掉之后，下次 `git push` 会被重新询问用户名密码 / PAT。

---

## 2. 全局 git 配置

路径：`C:\Users\Administrator\.gitconfig`

当前内容：

```ini
[user]
    name = 祥云
    email = 1474731240@qq.com
[credential "https://gitee.com"]
    provider = generic
```

### 选 A：只删 gitee 那段

```powershell
git config --global --unset credential.https://gitee.com.provider
```

### 选 B：连用户身份一起清（之后所有 commit 会变匿名提交者）

```powershell
git config --global --unset user.name
git config --global --unset user.email
git config --global --unset credential.https://gitee.com.provider
```

### 选 C：整文件清空

```powershell
Remove-Item "$env:USERPROFILE\.gitconfig" -Force
```

> 之后需要时，新建空白 `.gitconfig` 重新配置即可。

---

## 3. SSH 目录

路径：`C:\Users\Administrator\.ssh\`

```
id_ed25519          ← 个人私钥
id_ed25519.pub      ← 个人公钥
id_rsa              ← 个人私钥
id_rsa.pub          ← 个人公钥
id_rsa_company      ← ⚠️ 公司私钥（不要删）
id_rsa_company.pub  ← ⚠️ 公司公钥（不要删）
known_hosts         ← SSH 主机指纹（含 github.com / gitee.com）
known_hosts.old     ← 上一份 known_hosts 备份
```

### 第一步：确认哪些密钥属于 GitHub / Gitee

```powershell
# 看每个公钥末尾的注释（一般是 "user@host"）
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"
Get-Content "$env:USERPROFILE\.ssh\id_rsa.pub"
Get-Content "$env:USERPROFILE\.ssh\id_rsa_company.pub"
```

如果 `id_rsa_company.pub` 的注释里有公司邮箱（不是你的 qq 邮箱），那 `id_rsa_company*` 就是公司的，**不要删**。

通常 `id_ed25519` / `id_rsa` 是 GitHub / Gitee / 个人其它用途的私钥。  
如果你**确认**它们只用于 GitHub / Gitee，就执行：

```powershell
Remove-Item "$env:USERPROFILE\.ssh\id_ed25519"      -Force
Remove-Item "$env:USERPROFILE\.ssh\id_ed25519.pub"  -Force
Remove-Item "$env:USERPROFILE\.ssh\id_rsa"          -Force
Remove-Item "$env:USERPROFILE\.ssh\id_rsa.pub"      -Force
```

### 第二步：清掉 known_hosts 里的 GitHub / Gitee 指纹

**方式 A（精准）**：只删指定主机行

```powershell
$kh = "$env:USERPROFILE\.ssh\known_hosts"
(Get-Content $kh) | Where-Object { $_ -notmatch '^(github\.com|gitee\.com)(,.*)?$' } | Set-Content $kh -Encoding UTF8
```

**方式 B（最干净）**：整文件删，之后 ssh 重新写

```powershell
Remove-Item "$env:USERPROFILE\.ssh\known_hosts", "$env:USERPROFILE\.ssh\known_hosts.old" -Force
```

### ⚠️ 千万别动

```powershell
# id_rsa_company* 是公司密钥，删了就上不了公司内网
# 公司密钥被删无法补救（除非你本地有备份）
```

---

## 4. 当前仓库的 remote

`F:\deepseek\dsh-trace-narrator\dsh-trace-narrator\.git\config` 含：

```ini
[remote "origin"]
    url = https://github.com/xiangyun0519/dsh-trace-narrator.git
```

### 选 A：断云端、保留仓库代码

```powershell
cd F:\deepseek\dsh-trace-narrator\dsh-trace-narrator
git remote remove origin
```

之后可以 `git remote add origin <新地址>` 重新连别的云。

### 选 B：整个项目都不要了

```powershell
Remove-Item "F:\deepseek\dsh-trace-narrator\dsh-trace-narrator" -Recurse -Force
```

> 这是**最彻底**的做法，连 `.git/`、reflog、缓存的 remote 全部一起消失。**先确认代码无需保留**。

### 选 C：保留 `origin` 这个名字但清掉 URL

编辑 `.git/config`，删掉 `[remote "origin"]` 整段。  
（之后 `git push` 会报 `No configured push destination` 错误，达到同样的"断云"效果。）

---

## 5. 一键清理脚本（执行前请先通读上面 4 节）

```powershell
# ===== 1. 凭据管理器 =====
cmdkey /delete:LegacyGeneric:target=git:https://github.com
cmdkey /delete:LegacyGeneric:target=git:https://gitee.com

# ===== 2. 全局 git 配置（保留 user，删 gitee provider） =====
git config --global --unset credential.https://gitee.com.provider

# ===== 3. SSH 已知主机指纹 =====
$kh = "$env:USERPROFILE\.ssh\known_hosts"
if (Test-Path $kh) {
    (Get-Content $kh) | Where-Object { $_ -notmatch '^(github\.com|gitee\.com)(,.*)?$' } | Set-Content $kh -Encoding UTF8
}

# ===== 4. 当前仓库断开 origin =====
cd F:\deepseek\dsh-trace-narrator\dsh-trace-narrator
git remote remove origin
```

**不要直接粘贴运行**的代码（确认后再决定）：

```powershell
# 删除个人 SSH 私钥（⚠️ 删前确认它们不是用于其它服务）
Remove-Item "$env:USERPROFILE\.ssh\id_ed25519"      -Force
Remove-Item "$env:USERPROFILE\.ssh\id_ed25519.pub"  -Force
Remove-Item "$env:USERPROFILE\.ssh\id_rsa"          -Force
Remove-Item "$env:USERPROFILE\.ssh\id_rsa.pub"      -Force

# 整文件清空 .gitconfig（会连 user.name/email 一起删）
Remove-Item "$env:USERPROFILE\.gitconfig" -Force

# 整个项目连仓库一起删（⚠️ 不可逆）
Remove-Item "F:\deepseek\dsh-trace-narrator\dsh-trace-narrator" -Recurse -Force
```

---

## 6. 校验清理结果

```powershell
# 凭据管理器应不再出现 github/gitee
cmdkey /list | Select-String "github|gitee"

# .gitconfig 不应再有 gitee/github 痕迹
Get-Content "$env:USERPROFILE\.gitconfig"

# .ssh 目录里 github/gitee 私钥、known_hosts 已清
Get-ChildItem "$env:USERPROFILE\.ssh" -Force

# 所有 git 配置不应再指向 github/gitee
git config --list --show-origin | Select-String "github|gitee"

# 当前仓库的 remote 已断
git -C "F:\deepseek\dsh-trace-narrator\dsh-trace-narrator" remote -v
```

期望输出：所有命令的匹配项**均为空**。

---

## 7. 注意

- **本机清理 ≠ 云端删除**。GitHub / Gitee 服务器上的仓库、提交历史、issue 都不动。要彻底清掉云端，需要去网站 Settings → Danger Zone → Delete this repository。
- 清理后**本机无法再推送到 GitHub / Gitee**（除非重新配 SSH key 或重新登录），这正是"断干净"的目的。
- 如果只是想换账号、不是要断干净，看的是第 1 节"删凭据"就够了。
- `id_rsa_company*` 是公司密钥，无论如何不要碰。
