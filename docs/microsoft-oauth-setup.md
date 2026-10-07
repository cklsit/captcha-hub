# 配置 Microsoft 账户登录（OAuth 2.0）

微软自 2022 年起停用了 IMAP 的密码登录。`outlook.office365.com` 会在 `CAPABILITY`
里直接声明 `LOGINDISABLED` 并只接受 `AUTH=XOAUTH2`，登录尝试会被明文拒绝：

```
S> * CAPABILITY IMAP4 IMAP4rev1 AUTH=XOAUTH2 LOGINDISABLED ...
C> a2 LOGIN you@outlook.com ********
S> a2 NO Basic authentication is disabled.
```

网页密码、应用密码都不行，唯一出路是 OAuth 2.0。本应用使用**设备码流程**
（device authorization grant），无需回调地址、无需内嵌浏览器，只做一次注册。

---

## 一次性注册（约 5 分钟，免费，不需要 Azure 订阅）

### 1. 进入应用注册

打开 <https://portal.azure.com>，用你的 Microsoft 账户登录（个人账户即可）。
顶部搜索框输入 **Microsoft Entra ID**（旧称 Azure AD）并进入。

左侧菜单 → **应用注册** → **新注册**。

### 2. 填写注册信息

| 字段 | 填什么 |
| --- | --- |
| 名称 | 随意，例如 `Captcha Hub` |
| 支持的帐户类型 | ⚠️ 选**第三项**：「任何组织目录中的帐户…和个人 Microsoft 帐户」 |
| 重定向 URI | **留空**（设备码流程不需要） |

> 第二项选错的话，个人 `outlook.com` 账户会登录失败。这点最容易踩坑。

点 **注册**。

### 3. 复制 Client ID

注册完成后页面会显示 **应用程序(客户端) ID**，形如
`1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d`。
**这就是要填进本应用的「Application (client) ID」。**

### 4. 打开公共客户端流（必做）

左侧 **身份验证** → 拉到最下 **高级设置** →
**允许公共客户端流** 设为 **是** → **保存**。

> 不开这一步，获取设备码会报 `invalid_client` / `AADSTS7000218`。

### 5. 添加 IMAP 权限

左侧 **API 权限** → **添加权限**：

1. 选 **我的组织使用的 API** 标签页
2. 搜索 `Office 365 Exchange Online` 并点进去
   （若这里找不到，改走 **Microsoft Graph** → 委托的权限 → 搜 `IMAP`）
3. 选 **委托的权限**，勾选 **IMAP.AccessAsUser.All**
4. **添加权限**

个人账户到此即可——登录时会在授权页现场征求你的同意。

> **工作/学校账户（Microsoft 365）** 额外需要管理员在「API 权限」页点击
> **代表 <组织> 授予管理员同意**，否则登录可能被拒绝。

---

## 在应用里添加来源

1. 来源管理 → **新增来源** → 类型选「邮箱来源」
2. **认证方式** 选 **「Microsoft 账户登录（Outlook / Hotmail / M365）」**
3. 服务器填 `outlook.office365.com`，端口 `993`，开启 SSL/TLS
   （点「Outlook / Hotmail」快捷预设会自动填好）
4. 用户名填完整邮箱地址，例如 `you@outlook.com`
5. 粘贴刚才复制的 **Application (client) ID**；租户保持 `common`
6. 点 **「使用 Microsoft 账户登录」** → 应用会显示一个形如 `ABCD-EFGH` 的设备码
7. 点 **「打开授权页面」**（或手动访问 <https://microsoft.com/devicelogin>），
   输入该设备码，用你的 Microsoft 账户登录并同意授权
8. 应用会自动检测到授权完成并提示「登录成功」→ 点 **保存**

---

## 安全说明

- 访问令牌与刷新令牌**只存在于主进程**，不经过渲染层，也不会显示在任何界面上
- 两者落盘前都加密（`safeStorage` 优先，降级 AES-256-GCM）
- 访问令牌过期前会自动静默刷新，你无需重复登录
- 导出备份时**不会**包含令牌；恢复备份后需要重新授权一次
- 把来源的认证方式改回「密码 / 授权码」会**清除**已保存的令牌

## 撤销授权

在 <https://account.microsoft.com/consent> 或 Microsoft Entra ID 的
「企业应用程序」中可以随时撤销本应用的访问权限。

## 排错

| 现象 | 原因 |
| --- | --- |
| `invalid_client` / `AADSTS7000218` | 第 4 步「允许公共客户端流」没开 |
| `AADSTS700038` | Client ID 填错或不是有效的应用 ID |
| `unauthorized_client` / 授权页报错 | 第 2 步账户类型选成了「仅此组织目录」 |
| 登录成功但同步报 `AUTHENTICATE failed` | 第 5 步的 IMAP 权限没加，或工作账户缺管理员同意 |
| `服务端未启用 IMAP` | 到 Outlook.com 网页版「设置 → 邮件 → 转发和 IMAP」打开 IMAP |

参考：[微软官方文档 — 使用 OAuth 验证 IMAP/POP/SMTP 连接](https://learn.microsoft.com/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
