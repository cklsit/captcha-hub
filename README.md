# 验证码收件箱 · Captcha Hub

一款 Windows 桌面应用，把**你自己拥有**的多个验证码来源汇聚到单一界面查看。

> 合规红线：本应用仅用于帮助你管理**本人拥有或有权使用**的验证码来源，必须能够回验所有权。
> 它**不是**接码平台，不提供代收、代持、转卖他人号码的能力。

---

## 1. 为什么需要“邮箱转发通道”？

Windows 桌面设备**没有蜂窝射频，无法直接接收短信**。因此短信/验证码通过以下方式进入本应用：

```
手机 / 运营商 ──(转发)──▶ 你的邮箱 ──(IMAP)──▶ Captcha Hub 桌面端 ──▶ 提取验证码
```

你在手机上（或运营商侧）把短信通知转发到某个邮箱，桌面端用 IMAP 定时收取该邮箱邮件，
再用内置的提取引擎识别验证码。TOTP 2FA 则支持手动录入 Base32 密钥，本地实时生成。

## 2. 技术栈

| 层次 | 选型 |
| --- | --- |
| 桌面壳 | Electron 30（主进程负责所有敏感/IO 逻辑） |
| 渲染层 | React 18 + TypeScript + Vite |
| UI | MUI (Material UI) + Tailwind CSS（默认深色主题，可切换明/暗） |
| 邮件收取 | `imapflow` + `mailparser` |
| TOTP | `otplib`（RFC 6238，支持 SHA1/SHA256/SHA512、6/8 位、自定义周期） |
| 本地存储 | **`electron-store`**（纯 JS，见下方说明） |
| 敏感信息加密 | Electron `safeStorage`，不可用时降级为 AES-256-GCM + 机器指纹派生密钥 |
| 打包 | `electron-builder`（Windows NSIS） |
| 测试 | `vitest` |

### 关于存储引擎的取舍

原方案建议 `better-sqlite3`。它在 Windows 上需要本机编译原生模块（依赖完整 MSVC 工具链），
在普通开发机上极易安装失败。为保证 **“能装、能跑、能构建”**，本项目改用纯 JS 的
`electron-store`（底层是 JSON 文件 + 原子写入），并在存储层做了抽象封装
（`electron/store.ts`），未来若要换成 SQLite 只需替换该文件实现。**这是相对设计文档的唯一主动偏离。**

## 3. 安全与隐私设计

- 主进程 `contextIsolation: true`、`nodeIntegration: false`；渲染进程只能通过 `preload` 的
  `contextBridge` 暴露的**受控 API** 访问能力。
- **TOTP 验证码在主进程生成**，渲染进程只拿到“当前验证码 + 剩余秒数”，永远接触不到明文密钥。
- 邮箱授权码、TOTP 密钥、OAuth 令牌在落盘前加密（`safeStorage` 优先，AES-256-GCM 兜底）。
- Microsoft 账户走 OAuth 2.0 设备码流程：访问/刷新令牌**只存在于主进程**，从不经过
  渲染层，界面只会显示设备码与状态。
- 界面不回显密钥/密码；编辑来源时密码留空表示不修改。
- 所有数据保存在本机，不上传任何服务器。

## 4. 目录结构

```
captcha-hub/
├── package.json / tsconfig.json / vite.config.ts / vitest.config.ts
├── tailwind.config.js / postcss.config.js / electron-builder.yml
├── index.html / README.md
├── shared/
│   └── types.ts              # 主进程与渲染进程共享的领域类型
├── electron/
│   ├── main.ts              # 主进程入口：窗口、生命周期、单实例
│   ├── preload.ts           # contextBridge 暴露受控 API
│   ├── ipc.ts               # 所有 ipcMain.handle 注册
│   ├── store.ts             # 存储层（sources / messages / settings）
│   ├── crypto.ts            # safeStorage 封装 + AES-256-GCM 降级
│   ├── imap.ts              # IMAP 拉取与连接测试
│   ├── extractor.ts         # 验证码提取引擎（纯函数 + 来源归属）
│   ├── totp.ts              # TOTP 生成与倒计时
│   ├── dedupe.ts            # 去重/合并（纯函数）
│   ├── ingest.ts            # 采集编排：拉取→提取→归属→落库→通知
│   ├── scheduler.ts         # 定时轮询调度
│   ├── events.ts            # 主进程 → 渲染进程事件广播
│   ├── autostart.ts         # 开机自启
│   └── presets.ts           # 常见邮箱预设
├── src/
│   ├── main.tsx / App.tsx / theme.ts / api.ts / types.ts / constants.ts / format.ts
│   ├── components/          # Sidebar / CodeCard / TotpCard / SourceForm / Toast / ...
│   └── pages/               # Inbox / Sources / Authenticator / Settings
└── tests/                   # vitest 单元测试（extractor / totp / dedupe）
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

1. **来源管理**：邮箱（IMAP，含 QQ/163/Gmail/Outlook 预设）、手机号（映射到邮箱转发规则）、
   TOTP 验证器；支持启用/停用、编辑、删除、测试连接。
   邮箱支持两种认证方式：**密码 / 授权码**，以及 **Microsoft 账户 OAuth 2.0 登录**
   （Outlook / Hotmail / Microsoft 365 —— 微软已停用 IMAP 密码登录，只能走 OAuth，
   见 [`docs/microsoft-oauth-setup.md`](docs/microsoft-oauth-setup.md)）。
2. **采集/同步**：IMAP 定时轮询（默认 60s，可配置 15s–10min）+ 手动“立即同步”；
   邮件解析 → 提取验证码 → 去重（来源 + UID）→ 归属到对应来源。
3. **统一收件箱**：时间线卡片、来源色标、验证码大字一键复制、置信度、有效期提示；
   新验证码实时插入并高亮；支持搜索、按来源/类型/时间筛选、只看未读、标记已读、删除、清空。
4. **验证器（TOTP）**：实时验证码卡片 + 环形倒计时，一键复制；支持导入/导出（导出含密钥需二次确认）。
5. **设置**：主题切换、轮询间隔、开机自启、数据导入/导出、清空全部数据、隐私与合规说明、关于页。

## 8. 验证码提取引擎

纯函数实现（见 `electron/extractor.ts`），便于测试：

- 中英文关键词锚点：验证码 / 校验码 / 动态码 / 一次性密码 / verification code / OTP / code is …
- 候选：4–8 位数字、含字母数字的 5–8 位组合、`G-XXXXXX` 风格；
- 打分：与关键词的距离 + 长度启发式 + 有效期提示；
- 干扰项惩罚：货币金额（¥/$）、年份、超长订单号等。

返回结构：`{ code, confidence, matchedKeyword, expiresAtHint }`。

## 9. 已知限制

- 未实现 Android/iOS 采集端（按要求忽略）。
- 邮箱密码不做备份导出（恢复后需重新填写），仅 TOTP 密钥可选明文导出。
- **Microsoft 账户必须走 OAuth**：微软自 2022 年起停用了 IMAP 基本验证，
  服务器直接返回 `LOGINDISABLED`，网页密码与应用密码均不可用。使用前需先注册一个
  免费 Azure 应用，步骤见 [`docs/microsoft-oauth-setup.md`](docs/microsoft-oauth-setup.md)。
  刷新令牌不随备份导出，恢复备份后需重新授权一次。
- IMAP 收取为“拉取最近 N 封”策略，去重依赖 UID；若邮件在服务端被移动/删除，历史记录仍保留在本地。
- 提取引擎为启发式实现，覆盖主流短信/邮件模板，不保证 100% 准确。
