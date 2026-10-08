import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import ContentPasteOutlinedIcon from '@mui/icons-material/ContentPasteOutlined';
import type { SafeTotpEntry, TotpAlgorithm, TotpEntryInput, TotpSecret } from '../../shared/types';
import { api } from '../api';
import { useToast } from './Toast';

interface TotpFormProps {
  open: boolean;
  initial: SafeTotpEntry | null;
  onClose: () => void;
  onSubmit: (input: TotpEntryInput) => Promise<void>;
}

interface FormState {
  name: string;
  enabled: boolean;
  issuer: string;
  account: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
  note: string;
}

const EMPTY: FormState = {
  name: '',
  enabled: true,
  issuer: '',
  account: '',
  secret: '',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  note: '',
};

/** Create / edit dialog for a TOTP authenticator entry (manual entry or QR scan). */
export function TotpForm({ open, initial, onClose, onSubmit }: TotpFormProps): JSX.Element {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isEditing = initial !== null;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setScanMessage(null);
    if (initial) {
      setForm({
        name: initial.name,
        enabled: initial.enabled,
        issuer: initial.totp.issuer,
        account: initial.totp.account,
        // The secret never reaches the renderer; leave blank to keep it as-is.
        secret: '',
        algorithm: initial.totp.algorithm,
        digits: initial.totp.digits,
        period: initial.totp.period,
        note: initial.totp.note,
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, initial]);

  function buildInput(): TotpEntryInput {
    const totp: Partial<TotpSecret> = {
      issuer: form.issuer.trim(),
      account: form.account.trim(),
      algorithm: form.algorithm,
      digits: form.digits,
      period: form.period,
      note: form.note,
    };
    if (form.secret.trim()) totp.secret = form.secret.trim().replace(/\s+/g, '').toUpperCase();
    const input: TotpEntryInput = {
      name: form.name.trim() || form.issuer.trim() || '未命名验证器',
      enabled: form.enabled,
      totp,
    };
    if (initial) input.id = initial.id;
    return input;
  }

  function validate(): string | null {
    if (!form.name.trim() && !form.issuer.trim()) return '请填写名称或发行方。';
    const hasStoredSecret = initial?.totp.hasSecret ?? false;
    if (!form.secret.trim() && !hasStoredSecret) {
      return '请填写 Base32 密钥，或用二维码扫描自动填入。';
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

  async function handleScan(kind: 'image' | 'clipboard'): Promise<void> {
    setBusy(true);
    setError(null);
    setScanMessage(null);
    try {
      const result = kind === 'image' ? await api.totp.scanImage() : await api.totp.scanClipboard();
      setScanMessage(result.message);
      if (result.ok && result.draft) {
        setForm((prev) => ({
          ...prev,
          issuer: result.draft?.issuer || prev.issuer,
          account: result.draft?.account || prev.account,
          name: prev.name || result.draft?.issuer || result.draft?.account || '',
          secret: result.draft?.secret || prev.secret,
          algorithm: result.draft?.algorithm ?? prev.algorithm,
          digits: result.draft?.digits ?? prev.digits,
          period: result.draft?.period ?? prev.period,
        }));
        toast('已从二维码读取配置', 'success');
      }
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditing ? '编辑验证器' : '新增验证器'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              startIcon={<ImageOutlinedIcon />}
              disabled={busy}
              onClick={() => void handleScan('image')}
            >
              从图片识别二维码
            </Button>
            <Button
              variant="outlined"
              startIcon={<ContentPasteOutlinedIcon />}
              disabled={busy}
              onClick={() => void handleScan('clipboard')}
            >
              从剪贴板识别
            </Button>
          </Box>
          {scanMessage ? <Alert severity="info">{scanMessage}</Alert> : null}

          <TextField
            label="名称"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="例如：GitHub"
            fullWidth
          />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="发行方 Issuer"
              value={form.issuer}
              onChange={(event) => setForm({ ...form, issuer: event.target.value })}
              fullWidth
            />
            <TextField
              label="账户 Account"
              value={form.account}
              onChange={(event) => setForm({ ...form, account: event.target.value })}
              placeholder="you@example.com"
              fullWidth
            />
          </Box>
          <TextField
            label={initial?.totp.hasSecret ? 'Base32 密钥（留空表示不修改）' : 'Base32 密钥'}
            value={form.secret}
            onChange={(event) => setForm({ ...form, secret: event.target.value })}
            placeholder="JBSWY3DPEHPK3PXP"
            InputProps={{ sx: { fontFamily: 'monospace' } }}
            fullWidth
          />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              select
              label="算法"
              value={form.algorithm}
              onChange={(event) => setForm({ ...form, algorithm: event.target.value as TotpAlgorithm })}
              fullWidth
            >
              <MenuItem value="SHA1">SHA1（默认）</MenuItem>
              <MenuItem value="SHA256">SHA256</MenuItem>
              <MenuItem value="SHA512">SHA512</MenuItem>
            </TextField>
            <TextField
              select
              label="位数"
              value={form.digits}
              onChange={(event) => setForm({ ...form, digits: Number(event.target.value) === 8 ? 8 : 6 })}
              fullWidth
            >
              <MenuItem value={6}>6 位</MenuItem>
              <MenuItem value={8}>8 位</MenuItem>
            </TextField>
            <TextField
              label="周期（秒）"
              type="number"
              value={form.period}
              onChange={(event) => setForm({ ...form, period: Number(event.target.value) || 30 })}
              fullWidth
            />
          </Box>
          <TextField
            label="备注"
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
            multiline
            minRows={2}
            fullWidth
          />
          <FormControlLabel
            control={<Switch checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />}
            label="启用（在验证器中显示验证码）"
          />
          <Typography variant="caption" color="text.secondary">
            密钥仅在本机加密保存，验证码在主进程生成，界面永远接触不到明文密钥。
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
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
