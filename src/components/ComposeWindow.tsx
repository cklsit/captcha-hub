import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import type { ComposePayload, SafeAccount } from '../../shared/types';
import { api } from '../api';
import { useToast } from './Toast';

interface ComposeWindowProps {
  open: boolean;
  initial: ComposePayload | null;
  accounts: SafeAccount[];
  onClose: () => void;
  onSent: () => void;
}

interface FormState {
  accountId: string;
  to: string;
  cc: string;
  subject: string;
  bodyText: string;
  attachments: string[];
}

const EMPTY: FormState = {
  accountId: '',
  to: '',
  cc: '',
  subject: '',
  bodyText: '',
  attachments: [],
};

/** Compose modal: new / reply / forward, with send and save-draft. */
export function ComposeWindow({
  open,
  initial,
  accounts,
  onClose,
  onSent,
}: ComposeWindowProps): JSX.Element {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [draftId, setDraftId] = useState<string | undefined>(undefined);
  const [inReplyTo, setInReplyTo] = useState('');
  const [mode, setMode] = useState<ComposePayload['mode']>('new');
  const [attachInput, setAttachInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const enabled = accounts.filter((account) => account.enabled);
    setError(null);
    setAttachInput('');
    if (initial) {
      setForm({
        accountId: initial.accountId,
        to: initial.to,
        cc: initial.cc,
        subject: initial.subject,
        bodyText: initial.bodyText,
        attachments: initial.attachments,
      });
      setDraftId(initial.draftId);
      setInReplyTo(initial.inReplyTo);
      setMode(initial.mode);
    } else {
      setForm({ ...EMPTY, accountId: enabled[0]?.id ?? '' });
      setDraftId(undefined);
      setInReplyTo('');
      setMode('new');
    }
  }, [open, initial, accounts]);

  function buildPayload(): ComposePayload {
    return {
      accountId: form.accountId,
      to: form.to,
      cc: form.cc,
      subject: form.subject,
      bodyText: form.bodyText,
      bodyHtml: '',
      attachments: form.attachments,
      inReplyTo,
      mode,
      draftId,
    };
  }

  async function handleSend(): Promise<void> {
    if (!form.accountId) {
      setError('请选择发件账户。');
      return;
    }
    if (!form.to.trim()) {
      setError('请填写收件人。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.compose.send(buildPayload());
      if (result.ok) {
        toast('已发送', 'success');
        onSent();
        onClose();
      } else if (result.needsReauth) {
        setError(result.message);
        toast(result.message, 'error');
      } else {
        setError(result.message);
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDraft(): Promise<void> {
    if (!form.accountId) {
      setError('请先选择发件账户再存草稿。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const draft = await api.compose.saveDraft(buildPayload());
      setDraftId(draft.id);
      toast('已存为草稿', 'success');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  }

  function addAttachment(): void {
    const value = attachInput.trim();
    if (!value) return;
    setForm((prev) => ({ ...prev, attachments: [...prev.attachments, value] }));
    setAttachInput('');
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
        {mode === 'reply' ? '回复' : mode === 'forward' ? '转发' : '写邮件'}
        <Box sx={{ ml: 'auto' }}>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            label="发件账户"
            value={form.accountId}
            onChange={(event) => setForm({ ...form, accountId: event.target.value })}
            fullWidth
          >
            {accounts.map((account) => (
              <MenuItem key={account.id} value={account.id}>
                {account.name}（{account.emailAddress || '未填地址'}）
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="收件人"
            value={form.to}
            onChange={(event) => setForm({ ...form, to: event.target.value })}
            placeholder="someone@example.com；多个用逗号分隔"
            fullWidth
          />
          <TextField
            label="抄送"
            value={form.cc}
            onChange={(event) => setForm({ ...form, cc: event.target.value })}
            fullWidth
          />
          <TextField
            label="主题"
            value={form.subject}
            onChange={(event) => setForm({ ...form, subject: event.target.value })}
            fullWidth
          />
          <TextField
            label="正文"
            value={form.bodyText}
            onChange={(event) => setForm({ ...form, bodyText: event.target.value })}
            multiline
            minRows={8}
            fullWidth
          />
          <Box>
            <Typography variant="caption" color="text.secondary">
              附件（填写本地文件路径后回车添加）
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
              <TextField
                size="small"
                value={attachInput}
                onChange={(event) => setAttachInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addAttachment();
                  }
                }}
                placeholder="C:\\path\\to\\file.pdf"
                fullWidth
              />
              <Button size="small" startIcon={<AddIcon />} onClick={addAttachment}>
                添加
              </Button>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
              {form.attachments.map((filePath) => (
                <Chip
                  key={filePath}
                  size="small"
                  label={filePath}
                  onDelete={() =>
                    setForm((prev) => ({
                      ...prev,
                      attachments: prev.attachments.filter((entry) => entry !== filePath),
                    }))
                  }
                />
              ))}
            </Box>
          </Box>
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={() => void handleSaveDraft()} disabled={busy} sx={{ mr: 'auto' }}>
          存为草稿
        </Button>
        <Button onClick={onClose} color="inherit">
          放弃
        </Button>
        <Button onClick={() => void handleSend()} variant="contained" disabled={busy}>
          {busy ? '发送中…' : '发送'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
