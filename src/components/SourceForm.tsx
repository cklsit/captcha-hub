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
import ContentPasteOutlinedIcon from '@mui/icons-material/ContentPasteOutlined';
import QrCodeScannerOutlinedIcon from '@mui/icons-material/QrCodeScannerOutlined';
import type {
  ConnectionTestResult,
  MatchField,
  SafeSource,
  SourceInput,
  SourceKind,
  SourcePreset,
  TotpAlgorithm,
  TotpScanResult,
} from '../../shared/types';
import { api } from '../api';

interface SourceFormProps {
  open: boolean;
  initial: SafeSource | null;
  presets: SourcePreset[];
  emailSources: SafeSource[];
  onClose: () => void;
  onSubmit: (input: SourceInput) => Promise<void>;
  onTest: (input: SourceInput) => Promise<ConnectionTestResult>;
}

interface EmailFormState {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  mailbox: string;
}

interface PhoneFormState {
  phoneNumber: string;
  emailSourceId: string;
  matchField: MatchField;
  matchKeyword: string;
}

interface TotpFormState {
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
  secret: string;
  issuer: string;
  account: string;
  note: string;
}

const EMPTY_EMAIL: EmailFormState = {
  host: '',
  port: 993,
  secure: true,
  username: '',
  password: '',
  mailbox: 'INBOX',
};

const EMPTY_PHONE: PhoneFormState = {
  phoneNumber: '',
  emailSourceId: '',
  matchField: 'subject',
  matchKeyword: '',
};

const EMPTY_TOTP: TotpFormState = {
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  secret: '',
  issuer: '',
  account: '',
  note: '',
};

/** Create / edit dialog for every source kind (email, phone forwarding, TOTP). */
export function SourceForm({
  open,
  initial,
  presets,
  emailSources,
  onClose,
  onSubmit,
  onTest,
}: SourceFormProps): JSX.Element {
  const [kind, setKind] = useState<SourceKind>('email');
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [email, setEmail] = useState<EmailFormState>(EMPTY_EMAIL);
  const [phone, setPhone] = useState<PhoneFormState>(EMPTY_PHONE);
  const [totp, setTotp] = useState<TotpFormState>(EMPTY_TOTP);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [scanResult, setScanResult] = useState<TotpScanResult | null>(null);
  const [presetNote, setPresetNote] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isEditing = initial !== null;

  // Re-seed the form whenever the dialog opens for a different source.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setTestResult(null);
    setScanResult(null);
    setPresetNote(null);
    if (initial) {
      setKind(initial.kind);
      setName(initial.name);
      setEnabled(initial.enabled);
      setEmail(
        initial.email
          ? {
              host: initial.email.host,
              port: initial.email.port,
              secure: initial.email.secure,
              username: initial.email.username,
              password: '',
              mailbox: initial.email.mailbox,
            }
          : EMPTY_EMAIL,
      );
      setPhone(
        initial.phone
          ? {
              phoneNumber: initial.phone.phoneNumber,
              emailSourceId: initial.phone.rule.emailSourceId,
              matchField: initial.phone.rule.matchField,
              matchKeyword: initial.phone.rule.matchKeyword,
            }
          : EMPTY_PHONE,
      );
      setTotp(
        initial.totp
          ? {
              algorithm: initial.totp.algorithm,
              digits: initial.totp.digits,
              period: initial.totp.period,
              secret: '',
              issuer: initial.totp.issuer,
              account: initial.totp.account,
              note: initial.totp.note,
            }
          : EMPTY_TOTP,
      );
    } else {
      setKind('email');
      setName('');
      setEnabled(true);
      setEmail(EMPTY_EMAIL);
      setPhone(EMPTY_PHONE);
      setTotp(EMPTY_TOTP);
    }
  }, [open, initial]);

  function buildInput(): SourceInput {
    const input: SourceInput = { kind, name: name.trim(), enabled };
    if (initial) input.id = initial.id;

    if (kind === 'email') {
      input.email = { ...email };
    } else if (kind === 'phone') {
      input.phone = {
        phoneNumber: phone.phoneNumber.trim(),
        rule: {
          emailSourceId: phone.emailSourceId,
          matchField: phone.matchField,
          matchKeyword: phone.matchKeyword.trim(),
        },
      };
    } else {
      input.totp = { ...totp };
    }
    return input;
  }

  function validate(input: SourceInput): string | null {
    if (!input.name) return '请填写来源名称。';
    if (kind === 'email') {
      if (!email.host) return '请填写 IMAP 服务器地址。';
      if (!email.username) return '请填写登录用户名（通常是邮箱地址）。';
      if (!email.password && !initial?.email?.hasPassword) return '请填写邮箱授权码 / 密码。';
    }
    if (kind === 'phone') {
      if (!phone.phoneNumber) return '请填写手机号（含国家区号，例如 +8613800138000）。';
      if (!phone.emailSourceId) return '请选择用于转发短信的邮箱来源。';
      if (!phone.matchKeyword) return '请填写匹配关键词（例如主题中包含「验证码」）。';
    }
    if (kind === 'totp') {
      if (!totp.secret && !initial?.totp?.hasSecret) return '请填写 Base32 密钥。';
    }
    return null;
  }

  async function handleSubmit(): Promise<void> {
    const input = buildInput();
    const validationError = validate(input);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(input);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTest(buildInput());
      setTestResult(result);
    } catch (testError) {
      setTestResult({
        ok: false,
        message: testError instanceof Error ? testError.message : String(testError),
      });
    } finally {
      setTesting(false);
    }
  }

  function applyPreset(preset: SourcePreset): void {
    setEmail((prev) => ({
      ...prev,
      host: preset.host,
      port: preset.port,
      secure: preset.secure,
    }));
    // Preset notes carry provider-specific setup steps (authorisation codes,
    // OAuth-only providers…), so surface them instead of leaving them unused.
    setPresetNote(preset.note);
  }

  /**
   * Decodes a 2FA enrolment QR code — from an image file or straight off the
   * clipboard — and prefills the TOTP fields, so the user only has to confirm
   * and save instead of copying a Base32 secret by hand.
   */
  async function handleScan(from: 'image' | 'clipboard'): Promise<void> {
    setScanning(true);
    setScanResult(null);
    try {
      const result = from === 'image' ? await api.totp.scanImage() : await api.totp.scanClipboard();
      setScanResult(result);
      if (!result.ok || !result.draft) return;

      const { draft } = result;
      setTotp((prev) => ({
        ...prev,
        algorithm: draft.algorithm,
        digits: draft.digits,
        period: draft.period,
        secret: draft.secret,
        issuer: draft.issuer || prev.issuer,
        account: draft.account || prev.account,
      }));

      // Offer a sensible source name when the user has not typed one yet.
      if (!name.trim()) {
        const label = [draft.issuer, draft.account].filter(Boolean).join(' · ');
        if (label) setName(label);
      }
    } catch (scanError) {
      setScanResult({
        ok: false,
        message: scanError instanceof Error ? scanError.message : String(scanError),
      });
    } finally {
      setScanning(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditing ? '编辑来源' : '新增来源'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <TextField
            select
            label="来源类型"
            value={kind}
            disabled={isEditing}
            onChange={(event) => setKind(event.target.value as SourceKind)}
            fullWidth
          >
            <MenuItem value="email">邮箱来源（IMAP 收取转发邮件）</MenuItem>
            <MenuItem value="phone">手机号来源（短信 → 邮箱转发规则）</MenuItem>
            <MenuItem value="totp">TOTP 验证器（手动录入 Base32 密钥）</MenuItem>
          </TextField>

          <TextField
            label="来源名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：我的 QQ 邮箱 / 138****8000 / GitHub 2FA"
            fullWidth
          />

          <FormControlLabel
            control={
              <Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            }
            label="启用该来源"
          />

          <Divider />

          {kind === 'email' ? (
            <Stack spacing={2}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  快捷预设
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                  {presets.map((preset) => (
                    <Chip
                      key={preset.key}
                      label={preset.label}
                      size="small"
                      onClick={() => applyPreset(preset)}
                      variant="outlined"
                    />
                  ))}
                </Box>
                {presetNote ? <Alert severity="info">{presetNote}</Alert> : null}
              </Box>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label="IMAP 服务器"
                  value={email.host}
                  onChange={(event) => setEmail({ ...email, host: event.target.value.trim() })}
                  fullWidth
                />
                <TextField
                  label="端口"
                  type="number"
                  value={email.port}
                  onChange={(event) => setEmail({ ...email, port: Number(event.target.value) || 993 })}
                  sx={{ width: 120 }}
                />
              </Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={email.secure}
                    onChange={(event) => setEmail({ ...email, secure: event.target.checked })}
                  />
                }
                label="使用 SSL/TLS"
              />
              <TextField
                label="用户名 / 邮箱地址"
                value={email.username}
                onChange={(event) => setEmail({ ...email, username: event.target.value.trim() })}
                fullWidth
              />
              <TextField
                label={initial?.email?.hasPassword ? '授权码 / 密码（留空表示不修改）' : '授权码 / 密码'}
                type="password"
                value={email.password}
                onChange={(event) => setEmail({ ...email, password: event.target.value })}
                helperText="网易 163/126、QQ 邮箱必须先开启 IMAP 服务并生成「授权码」，此处填授权码，不是网页登录密码。"
                fullWidth
              />
              <TextField
                label="邮箱文件夹"
                value={email.mailbox}
                onChange={(event) => setEmail({ ...email, mailbox: event.target.value.trim() })}
                helperText="一般填 INBOX；若转发邮件被归入某个文件夹，请填写该文件夹名。"
                fullWidth
              />
              {testResult ? (
                <Alert severity={testResult.ok ? 'success' : 'error'}>{testResult.message}</Alert>
              ) : null}
            </Stack>
          ) : null}

          {kind === 'phone' ? (
            <Stack spacing={2}>
              <Alert severity="info">
                本应用不会也无法直接连接运营商。请在你自己的手机上，把短信/验证码通知转发到某个邮箱，并在此把手机号与该邮箱关联。
              </Alert>
              <TextField
                label="手机号（含国家区号）"
                value={phone.phoneNumber}
                onChange={(event) => setPhone({ ...phone, phoneNumber: event.target.value })}
                placeholder="+8613800138000"
                fullWidth
              />
              <TextField
                select
                label="转发所用的邮箱来源"
                value={phone.emailSourceId}
                onChange={(event) => setPhone({ ...phone, emailSourceId: event.target.value })}
                fullWidth
                helperText="命中该规则的转发邮件会归属到这个手机号。"
              >
                {emailSources.length === 0 ? (
                  <MenuItem value="" disabled>
                    请先添加一个邮箱来源
                  </MenuItem>
                ) : null}
                {emailSources.map((source) => (
                  <MenuItem key={source.id} value={source.id}>
                    {source.name}
                  </MenuItem>
                ))}
              </TextField>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  select
                  label="匹配字段"
                  value={phone.matchField}
                  onChange={(event) => setPhone({ ...phone, matchField: event.target.value as MatchField })}
                  sx={{ width: 180 }}
                >
                  <MenuItem value="subject">邮件主题</MenuItem>
                  <MenuItem value="from">发件人</MenuItem>
                  <MenuItem value="body">正文</MenuItem>
                </TextField>
                <TextField
                  label="匹配关键词"
                  value={phone.matchKeyword}
                  onChange={(event) => setPhone({ ...phone, matchKeyword: event.target.value })}
                  placeholder="例如：验证码 / 106"
                  fullWidth
                />
              </Box>
            </Stack>
          ) : null}

          {kind === 'totp' ? (
            <Stack spacing={2}>
              <Alert severity="info">
                TOTP 密钥仅在本机加密保存，绝不会上传。生成验证码在主进程完成。
              </Alert>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<QrCodeScannerOutlinedIcon />}
                  disabled={scanning}
                  onClick={() => void handleScan('image')}
                >
                  {scanning ? '识别中…' : '扫描二维码图片'}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ContentPasteOutlinedIcon />}
                  disabled={scanning}
                  onClick={() => void handleScan('clipboard')}
                >
                  从剪贴板读取
                </Button>
                <Typography variant="caption" color="text.secondary">
                  支持 Google Authenticator / Authy 等生成的二维码
                </Typography>
              </Box>
              {scanResult ? (
                <Alert severity={scanResult.ok ? 'success' : 'error'}>{scanResult.message}</Alert>
              ) : null}
              <TextField
                label={initial?.totp?.hasSecret ? 'Base32 密钥（留空表示不修改）' : 'Base32 密钥'}
                value={totp.secret}
                onChange={(event) => setTotp({ ...totp, secret: event.target.value.trim() })}
                placeholder="例如：JBSWY3DPEHPK3PXP"
                fullWidth
              />
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label="发行方"
                  value={totp.issuer}
                  onChange={(event) => setTotp({ ...totp, issuer: event.target.value })}
                  fullWidth
                />
                <TextField
                  label="账户"
                  value={totp.account}
                  onChange={(event) => setTotp({ ...totp, account: event.target.value })}
                  fullWidth
                />
              </Box>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  select
                  label="算法"
                  value={totp.algorithm}
                  onChange={(event) => setTotp({ ...totp, algorithm: event.target.value as TotpAlgorithm })}
                  fullWidth
                >
                  <MenuItem value="SHA1">SHA1</MenuItem>
                  <MenuItem value="SHA256">SHA256</MenuItem>
                  <MenuItem value="SHA512">SHA512</MenuItem>
                </TextField>
                <TextField
                  select
                  label="位数"
                  value={totp.digits}
                  onChange={(event) => setTotp({ ...totp, digits: Number(event.target.value) === 8 ? 8 : 6 })}
                  fullWidth
                >
                  <MenuItem value={6}>6 位</MenuItem>
                  <MenuItem value={8}>8 位</MenuItem>
                </TextField>
                <TextField
                  label="周期（秒）"
                  type="number"
                  value={totp.period}
                  onChange={(event) => setTotp({ ...totp, period: Number(event.target.value) || 30 })}
                  fullWidth
                />
              </Box>
              <TextField
                label="备注"
                value={totp.note}
                onChange={(event) => setTotp({ ...totp, note: event.target.value })}
                fullWidth
              />
            </Stack>
          ) : null}

          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        {kind === 'email' ? (
          <Button onClick={() => void handleTest()} disabled={testing} sx={{ mr: 'auto' }}>
            {testing ? '测试中…' : '测试连接'}
          </Button>
        ) : null}
        <Button onClick={onClose} color="inherit">
          取消
        </Button>
        <Button onClick={() => void handleSubmit()} variant="contained" disabled={submitting}>
          {submitting ? '保存中…' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
