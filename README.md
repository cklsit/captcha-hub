# 邮件中心 · Mail Hub

一款本地优先的 Windows 桌面**邮件客户端**：多账户收发、文件夹与附件管理、
验证码自动高亮一键复制，内置 TOTP 验证器。

> 合规红线：本应用仅用于帮助你管理**你本人拥有或有权使用**的邮箱账户。
> 它**不是**接码平台，不提供代收、代持、转卖他人邮箱或号码验证码的能力。

---

## 1. 这是什么？

Mail Hub 把**你自己拥有**的一个或多个邮箱汇聚到一个桌面界面，用 IMAP 增量收取、
用 SMTP 发信，并把收到的邮件**无条件**全部入库。内置的验证码提取引擎会把识别到的
验证码**高亮**在列表与正文中，支持一键复制；但它**不再决定是否入库**——所有邮件都会保留。

```
邮箱服务器 ──(IMAP)──▶ Mail Hub ──(索引 + 正文落盘)──▶ 三栏阅读界面
             ◀─(SMTP)── 写信 / 回复 / 转发
```

TOTP 2FA 支持手动录入 Base32 密钥或扫描二维码，本地实时生成验证码。

## 2. 技术栈

| 层次 | 选型 |
| --- | --- |
| 桌面壳 | Electron 30（主进程负责所有敏感/IO 逻辑） |
| 渲染层 | React 18 + TypeScript + Vite |
| UI | MUI (Material UI) + Tailwind CSS（默认深色主题，可切换明/暗） |
| 收信 | `imapflow`（XOAUTH2、文件夹、移动/删除/取附件） |
| 发信 | `nodemailer`（密码 + OAuth2 XOAUTH2、MIME/附件构建） |
| 邮件解析 | `mailparser` |
| HTML 净化 | `sanitize-html`（主进程）+ 沙箱 iframe（渲染层）双保险 |
| TOTP | `otplib`（RFC 6238，支持 SHA1/SHA256/SHA512、6/8 位、自定义周期） |
| QR | `jsqr` |
| 配置存储 | **`electron-store`**（账户/密钥/设置/信封索引，纯 JS） |
| 正文存储 | **`node:fs` 磁盘文件（Maildir 风格，一邮件一文件）** |
| 敏感信息加密 | Electron `safeStorage`，不可用时降级为 AES-256-GCM + 机器指纹派生密钥 |
| 打包 | `electron-builder`（Windows NSIS） |
| 测试 | `vitest` |

### 关于存储引擎的取舍（零原生依赖）

本项目**刻意不引入任何原生模块**（包括 `better-sqlite3`）。原因是本机 Node ABI 与
Electron ABI 不同：一个 `node_modules` 只能存在一种 ABI，装了原生模块会让
`npm test`（Node 环境）与 `npm run dev`（Electron 环境）**互斥**。

因此存储完全由纯 JS 承担，并拆成两层以便单测：

- **`electron/mail-store-core.ts`（纯模块）**：信封索引 + 磁盘正文读写（原子写、路径安全化），
  `rootDir` 由构造参数注入，**零 `electron` 依赖**，可在 CI 临时目录中完整单测。
- **`electron/mail-service.ts`（薄封装）**：用 `app.getPath('userData')` 拼出 `rootDir` 注入单例。

| 数据域 | 载体 | 位置 |
| --- | --- | --- |
| 账户（IMAP/SMTP 凭据）、设置、TOTP 条目 | `electron-store` | `%APPDATA%/Mail Hub/mail-hub-data.json`（密钥加密） |
| 信封索引（邮件元数据） | `electron-store` | 同上，运行时整份载入内存 |
| 正文 / 报文 | `node:fs` | `<userData>/mail/accounts/<accountId>/<folderId>/<uid>.json` |
| 附件二进制 | 按需下载 | 用户选定目录 |

## 3. 安全与隐私设计

- 主进程 `contextIsolation: true`、`nodeIntegration: false`；渲染进程只能通过 `preload` 的
  `contextBridge` 暴露的**受控 API**（`MailHubApi`）访问能力。
- **邮件 HTML 双保险**：主进程 `sanitize-html` 剥离脚本/内联事件/危险标签；渲染层再用
  `sandbox=""` 沙箱 iframe + `srcdoc` 内联 CSP 二次收口，远程图片默认拦截（可手动放宽）。
- **TOTP 验证码在主进程生成**，渲染进程只拿到“当前验证码 + 剩余秒数”，永远接触不到明文密钥。
- IMAP/SMTP 密码、OAuth 令牌、TOTP 密钥在落盘前加密（`safeStorage` 优先，AES-256-GCM 兜底）。
- Microsoft 账户走 OAuth 2.0：**优先授权码 + PKCE + 回环重定向**——点一次按钮就跳转到微软
  登录页，登录完自动回来，**无需填写邮箱地址、也无需输入验证码**；若 Azure 应用未注册
  `http://localhost` 回调地址，会**自动降级**为设备码方式（先探测再决定，不会把用户丢在报错页上）。
  访问/刷新令牌**只存在于主进程**，从不经过渲染层。
- 界面不回显密钥/密码；编辑账户时密码留空表示不修改。
- 所有数据保存在本机，不上传任何服务器。

## 4. 目录结构

```
mail-hub/
├── package.json / tsconfig.json / vite.config.ts / vitest.config.ts
├── tailwind.config.js / postcss.config.js / electron-builder.yml
├── index.html / README.md
├── docs/
│   └── microsoft-oauth-setup.md
├── shared/
│   └── types.ts              # 主进程与渲染进程共享的领域类型（MailHubApi）
├── electron/
│   ├── main.ts              # 主进程入口：窗口、生命周期、启动迁移
│   ├── preload.ts           # contextBridge 暴露 MailHubApi
│   ├── ipc.ts               # 所有 ipcMain.handle 注册
│   ├── store.ts             # 配置存储（accounts / totpEntries / settings / 信封索引）
│   ├── mail-store-core.ts   # 纯 JS 存储核心（信封索引 + 正文文件，可单测）
│   ├── mail-service.ts      # 注入 userData 的存储单例
│   ├── migrate.ts / migrate-core.ts  # 旧数据一次性迁移（纯函数 + 落库）
│   ├── crypto.ts            # safeStorage 封装 + AES-256-GCM 降级
│   ├── imap.ts              # IMAP：文件夹、增量拉取、已读/移动/删除/取附件、连接测试
│   ├── smtp.ts              # SMTP：发信（密码/OAuth2）、连接测试、Sent 副本
│   ├── attachments.ts       # 附件按需下载
│   ├── drafts.ts            # 草稿 CRUD + 回复/转发预填
│   ├── parse-mail.ts        # 纯函数：解析邮件为 text/html/附件元数据
│   ├── sanitize.ts          # 纯函数：HTML 净化
│   ├── ingest-core.ts       # 纯函数：信封构造 + 验证码高亮
│   ├── ingest.ts            # 同步编排：拉取→解析→净化→落库→通知
│   ├── extractor.ts         # 验证码提取引擎（纯函数，结果降级为高亮）
│   ├── ms-oauth.ts          # Microsoft OAuth 原语：端点/scope/令牌解析与刷新
│   ├── ms-authcode.ts       # 授权码 + PKCE + 本地回环（一键跳转登录）
│   ├── ms-login.ts          # 登录编排：重定向优先，设备码兜底
│   ├── mail-auth.ts         # scope 感知的令牌刷新
│   ├── totp.ts / otpauth.ts / qr.ts  # TOTP + QR 全套
│   ├── dedupe.ts            # 去重（account::folder::uid）
│   ├── scheduler.ts         # 定时同步调度
│   ├── events.ts            # 主进程 → 渲染进程事件广播
│   ├── presets.ts           # 常见邮箱预设（IMAP + SMTP）
│   └── autostart.ts         # 开机自启
├── src/
│   ├── main.tsx / App.tsx / theme.ts / api.ts / types.ts / constants.ts / format.ts / html.ts
│   ├── components/          # Sidebar / AccountNav / FolderTree / MailList / MessageView / ...
│   └── pages/               # Mail / Accounts / Authenticator / Settings
└── tests/                   # vitest 单元测试（存储核心 / 净化 / 解析 / 迁移 / TOTP 等）
```

## 5. 环境要求

- Node.js 18+（本项目在 Node 22 上开发验证）
- Windows 10/11

## 6. 安装与运行

```bash
# 安装依赖
npm install

# 开发模式（自动拉起 Electron 窗口）
npm run dev

# 类型检查 + 生产构建（tsc --noEmit && vite build，含主进程/preload 构建）
npm run build

# 打包 Windows 安装包（NSIS）
npm run build:win

# 运行单元测试
npm test
```

## 7. 核心功能

1. **账户管理**：邮箱账户（IMAP 收信 + SMTP 发信 + 同步文件夹多选 + 签名），
   含 QQ/163/Gmail/Outlook 预设；支持启用/停用、编辑、删除、测试 IMAP/SMTP 连接。
   邮箱支持两种认证方式：**密码 / 授权码**，以及 **Microsoft 账户 OAuth 2.0 登录**
   （见 [`docs/microsoft-oauth-setup.md`](docs/microsoft-oauth-setup.md)）。
2. **邮件同步**：IMAP 定时轮询（默认 60s，可配置 15s–10min）+ 手动“立即同步”；
   列文件夹 → 按 `UIDVALIDITY`/`lastUid` 增量收取订阅文件夹 → **无条件全量入库**
   （正文落盘、附件存元数据、验证码降级为高亮）。
3. **三栏阅读**：账户/文件夹树 + 邮件列表 + 阅读区。搜索、快捷筛选（全部/未读/有附件/验证码）、
   已读/未读、移动、删除、附件按需下载；正文走沙箱 iframe，远程图片可手动放行。
4. **写信**：新邮件 / 回复 / 转发（自动预填引用），存草稿、发信；Outlook 首次发信按需重授权。
5. **验证码高亮**：列表与正文中高亮识别到的验证码并支持一键复制；**不影响入库**。
6. **验证器（TOTP）**：实时验证码卡片 + 环形倒计时、一键复制；新增/编辑/删除、扫码录入、
   导入/导出（导出含密钥需二次确认）。
7. **设置**：主题、同步间隔、阅读偏好（HTML/纯文本、外部图片、附件目录）、开机自启、
   数据导入/导出、清空全部数据、隐私与合规说明、关于页。

## 8. 验证码提取引擎

纯函数实现（见 `electron/extractor.ts`），便于测试：

- 中英文关键词锚点：验证码 / 校验码 / 动态码 / 一次性密码 / verification code / OTP / code is …
- 候选：4–8 位数字、含字母数字的 5–8 位组合、`G-XXXXXX` 风格；
- 打分：与关键词的距离 + 长度启发式 + 有效期提示；
- 干扰项惩罚：货币金额（¥/$）、年份、超长订单号等。

返回结构：`{ code, confidence, matchedKeyword, expiresAtHint }`。`MIN_CONFIDENCE` 仅决定
**是否高亮 / 是否显示一键复制**，不再决定是否入库。

## 9. 已知限制

- 未实现 Android/iOS 采集端（按要求忽略）。
- 邮箱密码不做备份导出（恢复后需重新填写），仅 TOTP 密钥可选明文导出。
- **Microsoft 账户必须走 OAuth**：微软自 2022 年起停用了 IMAP 基本验证，
  服务器直接返回 `LOGINDISABLED`。**发信额外需要 `SMTP.Send` scope**，若账户是在
  旧版本授权、缺少该 scope，首次发信时应用会提示重新登录一次。
  步骤见 [`docs/microsoft-oauth-setup.md`](docs/microsoft-oauth-setup.md)。
- 发信副本依赖服务器自身写入 Sent 文件夹；本地仅在索引补插一条已发送记录，不做 IMAP `APPEND`。
- **个人 Microsoft 账户目前无法注册 Azure 应用**：`@outlook.com` / `@hotmail.com` 默认被归到
  没有目录的 "Microsoft Services" 租户，在 Azure 门户上会得到 `AADSTS50020`。这是微软侧的
  账户策略，应用无法绕过；请改用转发，或先用无痕窗口创建 Azure 免费账户获得真实租户。
  应用会识别该错误并给出对应说明，不会误导成「密码错误」。
- 正文搜索为**按需扫描**（并发/结果上限/渐进返回），不承诺全文索引级即时性。
- 提取引擎为启发式实现，覆盖主流验证码模板，不保证 100% 准确。
