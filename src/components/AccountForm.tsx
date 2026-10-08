import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LoginOutlinedIcon from '@mui/icons-material/LoginOutlined';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import type {
  AccountInput,
  AccountPreset,
  ConnectionTestResult,
  EmailAuthType,
  MsLoginMode,
  MsLoginStatus,
  SafeAccount,
} from '../../shared/types';
import { api } from '../api';

interface AccountFormProps {
  open: boolean;
  initial: SafeAccount | null;
  presets: AccountPreset[];
  onClose: () => void;
  onSubmit: (input: AccountInput) => Promise<void>;
  onTest: (input: AccountInput) => Promise<ConnectionTestResult>;
  onTestSmtp: (input: AccountInput) => Promise<ConnectionTestResult>;
}

interface ImapState {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  authType: EmailAuthType;
  clientId: string;
  tenant: string;
}

interface SmtpState {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  authType: EmailAuthType;
}

const EMPTY_IMAP: ImapState = {
  host: '',
  port: 993,
  secure: true,
  username: '',
  password: '',
  authType: 'password',
  clientId: '',
  tenant: 'common',
};

const EMPTY_SMTP: SmtpState = {
  enabled: false,
  host: '',
  port: 465,
  secure: true,
  username: '',
  password: '',
  authType: 'password',
};

/**
 * Microsoft serves IMAP from this one hostname for personal accounts *and* for
 * work/school tenants. The user has no reason to know it, so choosing the
 * Microsoft sign-in method fills it in for them.
 */
const MICROSOFT_IMAP_HOST = 'outlook.office365.com';

interface OAuthFlowState {
  flowId: string;
  /** Live mode — starts as `redirect` and may downgrade to `device`. */
  mode: MsLoginMode;
  userCode: string;
  verificationUri: string;
  intervalSec: number;
  status: MsLoginStatus;
  message: string;
  /** Why the quicker redirect path was not used, when that happened. */
  fallbackReason: string;
}

/** Create / edit dialog for a mail account (IMAP + SMTP + signature). */
export function AccountForm({
  open,
  initial,
  presets,
  onClose,
  onSubmit,
  onTest,
  onTestSmtp,
}: AccountFormProps): JSX.Element {
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [signature, setSignature] = useState('');
  const [imap, setImap] = useState<ImapState>(EMPTY_IMAP);
  const [smtp, setSmtp] = useState<SmtpState>(EMPTY_SMTP);
  const [error, setError] = useState<string | null>(null);
  const [presetNote, setPresetNote] = useState<string | null>(null);
  const [testImap, setTestImap] = useState<ConnectionTestResult | null>(null);
  const [testSmtp, setTestSmtp] = useState<ConnectionTestResult | null>(null);
  const [oauthFlow, setOauthFlow] = useState<OAuthFlowState | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isEditing = initial !== null;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPresetNote(null);
    setTestImap(null);
    setTestSmtp(null);
    setOauthFlow(null);
    setOauthError(null);
    if (initial) {
      setName(initial.name);
      setEnabled(initial.enabled);
      setSignature(initial.signature);
      setImap({
        host: initial.imap.host,
        port: initial.imap.port,
        secure: initial.imap.secure,
        username: initial.imap.username,
        password: '',
        authType: initial.imap.authType ?? 'password',
        clientId: initial.imap.clientId ?? '',
        tenant: initial.imap.tenant ?? 'common',
      });
      setSmtp(
        initial.smtp
          ? {
              enabled: true,
              host: initial.smtp.host,
              port: initial.smtp.port,
              secure: initial.smtp.secure,
              username: initial.smtp.username,
              password: '',
              authType: initial.smtp.authType ?? 'password',
            }
          : { ...EMPTY_SMTP, username: initial.imap.username },
      );
    } else {
      setName('');
      setEnabled(true);
      setSignature('');
      setImap(EMPTY_IMAP);
      setSmtp(EMPTY_SMTP);
    }
  }, [open, initial]);

  function buildInput(): AccountInput {
    const input: AccountInput = { name: name.trim(), enabled, signature };
    if (initial) input.id = initial.id;
    input.imap = {
      host: imap.host,
      port: imap.port,
      secure: imap.secure,
      username: imap.username,
      password: imap.password,
      authType: imap.authType,
      clientId: imap.clientId,
      tenant: imap.tenant,
      ...(oauthFlow?.status === 'success' ? { oauthFlowId: oauthFlow.flowId } : {}),
    };
    input.smtp = smtp.enabled
      ? {
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          username: smtp.username || imap.username,
          password: smtp.password,
          authType: smtp.authType,
        }
      : null;
    return input;
  }

  function validate(): string | null {
    if (!name.trim()) return '请填写账户名称。';
    if (!imap.host) return '请填写 IMAP 服务器地址。';

    if (imap.authType === 'oauth2') {
      if (!imap.clientId.trim()) return '请填写 Application (client) ID。';
      const alreadyAuthorised = Boolean(initial?.imap.hasRefreshToken);
      const justAuthorised = oauthFlow?.status === 'success';
      if (!alreadyAuthorised && !justAuthorised) {
        return '请先点击「使用 Microsoft 账户登录」并完成浏览器中的登录。';
      }
      // The address is filled in from Microsoft's own answer, so the field is
      // only a problem when the sign-in did not report one.
      if (!imap.username.trim()) {
        return '未能从 Microsoft 获取邮箱地址，请手动填写登录用户名。';
      }
    } else {
      if (!imap.username) return '请填写登录用户名（通常是邮箱地址）。';
      if (!imap.password && !initial?.imap.hasPassword) return '请填写邮箱授权码 / 密码。';
    }
    return null;
  }

  async function handleSubmit(): Promise<void> {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(buildInput());
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    setTestImap(null);
    setTestSmtp(null);
    try {
      setTestImap(await onTest(buildInput()));
    } catch (testError) {
      setTestImap({ ok: false, message: testError instanceof Error ? testError.message : String(testError) });
    } finally {
      setTesting(false);
    }
  }

  async function handleTestSmtp(): Promise<void> {
    setTesting(true);
    setTestSmtp(null);
    try {
      setTestSmtp(await onTestSmtp(buildInput()));
    } catch (testError) {
      setTestSmtp({ ok: false, message: testError instanceof Error ? testError.message : String(testError) });
    } finally {
      setTesting(false);
    }
  }

  const flowId = oauthFlow?.flowId ?? null;
  const flowStatus = oauthFlow?.status ?? null;
  const flowIntervalSec = oauthFlow?.intervalSec ?? 5;

  useEffect(() => {
    if (!open || !flowId) return;
    if (flowStatus !== 'pending' && flowStatus !== 'slow_down') return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const result = await api.accounts.msLoginPoll(flowId);
          if (cancelled) return;
          setOauthFlow((prev) =>
            prev && prev.flowId === flowId
              ? {
                  ...prev,
                  status: result.status,
                  message: result.message,
                  // The flow may downgrade from redirect to device code
                  // mid-flight; always render whatever it is *now*.
                  mode: result.mode ?? prev.mode,
                  userCode: result.userCode ?? prev.userCode,
                  verificationUri: result.verificationUri ?? prev.verificationUri,
                }
              : prev,
          );

          // Microsoft tells us who signed in, so the address never has to be
          // typed by hand — only fill fields the user left untouched.
          if (result.status === 'success' && result.account) {
            const account = result.account;
            setImap((prev) => (prev.username.trim() ? prev : { ...prev, username: account }));
            setName((prev) => (prev.trim() ? prev : account));
          }
        } catch {
          /* transient — the next tick retries */
        }
      })();
    }, Math.max(2, flowIntervalSec) * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, flowId, flowStatus, flowIntervalSec]);

  async function startMicrosoftLogin(): Promise<void> {
    setOauthBusy(true);
    setOauthError(null);
    try {
      if (flowId) await api.accounts.msLoginCancel(flowId);
      setOauthFlow(null);
      const result = await api.accounts.msLoginStart({ ...imap });
      if (!result.ok || !result.flowId) {
        setOauthError(result.message);
        return;
      }
      setOauthFlow({
        flowId: result.flowId,
        mode: result.mode ?? 'device',
        userCode: result.userCode ?? '',
        verificationUri: result.verificationUri ?? '',
        intervalSec: result.intervalSec ?? 5,
        status: 'pending',
        message: result.message,
        fallbackReason: result.fallbackReason ?? '',
      });

      // The whole point of the redirect flow: land the user on Microsoft's own
      // sign-in page, with nothing to look up and no code to copy.
      if (result.mode === 'redirect' && result.verificationUri) {
        void api.system.openExternal(result.verificationUri);
      }
    } catch (loginError) {
      setOauthError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setOauthBusy(false);
    }
  }

  async function handleClose(): Promise<void> {
    if (flowId && flowStatus !== 'success') {
      try {
        await api.accounts.msLoginCancel(flowId);
      } catch {
        /* best effort */
      }
    }
    onClose();
  }

  function applyPreset(preset: AccountPreset): void {
    setImap((prev) => ({ ...prev, host: preset.host, port: preset.port, secure: preset.secure }));
    setSmtp((prev) => ({
      ...prev,
      enabled: true,
      host: preset.smtpHost,
      port: preset.smtpPort,
      secure: preset.smtpSecure,
      username: prev.username || imap.username,
    }));
    setPresetNote(preset.note);
  }

  return (
    <Dialog open={open} onClose={() => void handleClose()} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditing ? '编辑账户' : '新增账户'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <TextField
            label="账户名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：我的 QQ 邮箱"
            fullWidth
          />
          <FormControlLabel
            control={<Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />}
            label="启用该账户（自动同步）"
          />

          <Divider textAlign="left">快捷预设</Divider>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {presets.map((preset) => (
              <Chip key={preset.key} label={preset.label} size="small" variant="outlined" onClick={() => applyPreset(preset)} />
            ))}
          </Box>
          {presetNote ? <Alert severity="info">{presetNote}</Alert> : null}

          <Divider textAlign="left">收信（IMAP）</Divider>
          <TextField
            select
            label="认证方式"
            value={imap.authType}
            onChange={(event) => {
              const authType = event.target.value as EmailAuthType;
              setImap((prev) => {
                const next = { ...prev, authType };
                if (authType === 'oauth2') {
                  // Microsoft is the only provider this app signs into with
                  // OAuth, and it only serves IMAP from one endpoint — filling
                  // it in here means the user never has to know the hostname.
                  next.host = MICROSOFT_IMAP_HOST;
                  next.port = 993;
                  next.secure = true;
                }
                return next;
              });
              // A previous authorisation belongs to the previous settings.
              setOauthFlow(null);
              setOauthError(null);
            }}
            fullWidth
          >
            <MenuItem value="password">密码 / 授权码（QQ、163、Gmail 等）</MenuItem>
            <MenuItem value="oauth2">Microsoft 账户登录（Outlook / Hotmail / M365）</MenuItem>
          </TextField>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="IMAP 服务器"
              value={imap.host}
              onChange={(event) => setImap({ ...imap, host: event.target.value.trim() })}
              fullWidth
            />
            <TextField
              label="端口"
              type="number"
              value={imap.port}
              onChange={(event) => setImap({ ...imap, port: Number(event.target.value) || 993 })}
              sx={{ width: 120 }}
            />
          </Box>
          <FormControlLabel
            control={<Switch checked={imap.secure} onChange={(event) => setImap({ ...imap, secure: event.target.checked })} />}
            label="使用 SSL/TLS"
          />
          <TextField
            label={
              imap.authType === 'oauth2' ? '邮箱地址（留空即可）' : '用户名 / 邮箱地址'
            }
            value={imap.username}
            onChange={(event) => setImap({ ...imap, username: event.target.value.trim() })}
            helperText={
              imap.authType === 'oauth2'
                ? '无需手动填写：完成 Microsoft 登录后会自动填入你登录所用的邮箱地址。'
                : undefined
            }
            fullWidth
          />
          {imap.authType === 'password' ? (
            <TextField
              label={initial?.imap.hasPassword ? '授权码 / 密码（留空表示不修改）' : '授权码 / 密码'}
              type="password"
              value={imap.password}
              onChange={(event) => setImap({ ...imap, password: event.target.value })}
              helperText="网易 163/126、QQ 邮箱必须先开启 IMAP 服务并生成「授权码」，此处填授权码，不是网页登录密码。"
              fullWidth
            />
          ) : (
            <Stack spacing={2}>
              <Alert severity="info">
                微软已停用 IMAP 的密码登录（服务器直接返回 LOGINDISABLED），只能用 Microsoft 账户登录。
                先注册一个免费 Azure 应用，把 Application (client) ID 填在下面；之后点一次按钮就能完成授权，
                <strong>邮箱地址与服务地址都会自动填好</strong>。
              </Alert>
              <TextField
                label="Application (client) ID"
                value={imap.clientId}
                onChange={(event) => setImap({ ...imap, clientId: event.target.value.trim() })}
                helperText="在 portal.azure.com → Microsoft Entra ID → 应用注册 中创建，并开启「允许公共客户端流」。"
                fullWidth
              />
              <TextField
                label="租户"
                value={imap.tenant}
                onChange={(event) => setImap({ ...imap, tenant: event.target.value.trim() })}
                helperText="个人账户填 consumers，工作/学校账户填 organizations；不确定就保持 common。"
                fullWidth
              />

              <Button
                variant="contained"
                startIcon={<LoginOutlinedIcon />}
                disabled={oauthBusy || !imap.clientId.trim()}
                onClick={() => void startMicrosoftLogin()}
              >
                {oauthBusy ? '正在连接 Microsoft…' : oauthFlow ? '重新登录' : '使用 Microsoft 账户登录'}
              </Button>

              {initial?.imap.hasRefreshToken && !oauthFlow ? (
                <Typography variant="caption" color="text.secondary">
                  该账户已完成授权，不重新登录则沿用现有令牌。
                </Typography>
              ) : null}

              {oauthFlow?.fallbackReason && oauthFlow.status !== 'success' ? (
                <Alert severity="warning">
                  {oauthFlow.fallbackReason}
                  <br />
                  在 Azure 应用的「身份验证 → 添加平台 → 移动和桌面应用程序」中加上
                  <code> http://localhost </code>
                  后，即可改成免输码的一键登录。
                </Alert>
              ) : null}

              {oauthFlow ? (
                <Alert
                  severity={
                    oauthFlow.status === 'success'
                      ? 'success'
                      : oauthFlow.status === 'error'
                        ? 'error'
                        : 'info'
                  }
                >
                  {oauthFlow.status === 'success' ? (
                    <>登录成功，邮箱地址已自动填入，令牌已加密保存在本机。点击「保存」即可。</>
                  ) : oauthFlow.status === 'error' ? (
                    oauthFlow.message
                  ) : oauthFlow.mode === 'redirect' ? (
                    <>
                      已在浏览器中打开 Microsoft 登录页，请在那里登录你的 Microsoft 账户。
                      <br />
                      登录完成后这里会自动继续，无需再回到此对话框操作。
                    </>
                  ) : (
                    <>
                      在浏览器打开授权页面，输入代码{' '}
                      <strong style={{ letterSpacing: 2 }}>{oauthFlow.userCode}</strong> 并完成登录。
                      <br />
                      {oauthFlow.message}
                    </>
                  )}

                  {oauthFlow.status !== 'error' && oauthFlow.verificationUri ? (
                    <Box sx={{ mt: 1 }}>
                      <Button
                        size="small"
                        startIcon={<OpenInNewOutlinedIcon />}
                        onClick={() => void api.system.openExternal(oauthFlow.verificationUri ?? '')}
                      >
                        {oauthFlow.mode === 'redirect' ? '重新打开登录页' : '打开授权页面'}
                      </Button>
                    </Box>
                  ) : null}
                </Alert>
              ) : null}

              {oauthError ? <Alert severity="error">{oauthError}</Alert> : null}
            </Stack>
          )}

          <Divider textAlign="left">发信（SMTP）</Divider>
          <FormControlLabel
            control={<Switch checked={smtp.enabled} onChange={(event) => setSmtp({ ...smtp, enabled: event.target.checked })} />}
            label="配置 SMTP 以启用发信"
          />
          {smtp.enabled ? (
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label="SMTP 服务器"
                  value={smtp.host}
                  onChange={(event) => setSmtp({ ...smtp, host: event.target.value.trim() })}
                  fullWidth
                />
                <TextField
                  label="端口"
                  type="number"
                  value={smtp.port}
                  onChange={(event) => setSmtp({ ...smtp, port: Number(event.target.value) || 465 })}
                  sx={{ width: 120 }}
                />
              </Box>
              <FormControlLabel
                control={<Switch checked={smtp.secure} onChange={(event) => setSmtp({ ...smtp, secure: event.target.checked })} />}
                label="使用 SSL/TLS（465 用 SSL；587 关闭后走 STARTTLS）"
              />
              <TextField
                label="SMTP 用户名"
                value={smtp.username}
                onChange={(event) => setSmtp({ ...smtp, username: event.target.value.trim() })}
                helperText="留空则复用 IMAP 用户名。"
                fullWidth
              />
              <TextField
                label={initial?.smtp?.hasPassword ? 'SMTP 授权码（留空表示不修改）' : 'SMTP 授权码 / 密码'}
                type="password"
                value={smtp.password}
                onChange={(event) => setSmtp({ ...smtp, password: event.target.value })}
                fullWidth
              />
              <Button size="small" onClick={() => void handleTestSmtp()} disabled={testing} sx={{ alignSelf: 'flex-start' }}>
                测试 SMTP
              </Button>
              {testSmtp ? <Alert severity={testSmtp.ok ? 'success' : 'error'}>{testSmtp.message}</Alert> : null}
            </Stack>
          ) : null}

          <Divider textAlign="left">签名</Divider>
          <TextField
            label="默认签名"
            value={signature}
            onChange={(event) => setSignature(event.target.value)}
            multiline
            minRows={2}
            helperText="发送时自动附加到正文末尾。"
            fullWidth
          />

          {testImap ? <Alert severity={testImap.ok ? 'success' : 'error'}>{testImap.message}</Alert> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={() => void handleTest()} disabled={testing} sx={{ mr: 'auto' }}>
          {testing ? '测试中…' : '测试 IMAP'}
        </Button>
        <Button onClick={() => void handleClose()} color="inherit">
          取消
        </Button>
        <Button onClick={() => void handleSubmit()} variant="contained" disabled={submitting}>
          {submitting ? '保存中…' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
