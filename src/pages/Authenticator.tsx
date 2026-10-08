import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import LockClockOutlinedIcon from '@mui/icons-material/LockClockOutlined';
import type { SafeTotpEntry, TotpDisplay, TotpEntryInput, TotpExportItem } from '../../shared/types';
import { api } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { TotpCard } from '../components/TotpCard';
import { TotpForm } from '../components/TotpForm';
import { useToast } from '../components/Toast';

interface AuthenticatorProps {
  onCopy: (text: string) => void;
  onChanged: () => void;
}

const REFRESH_INTERVAL_MS = 1000;

/** Rebuilds an editable entry from a live display (secrets stay in main). */
function entryFromDisplay(display: TotpDisplay): SafeTotpEntry {
  return {
    id: display.id,
    name: display.name,
    enabled: display.enabled,
    createdAt: 0,
    updatedAt: 0,
    totp: {
      algorithm: 'SHA1',
      digits: 6,
      period: display.period,
      issuer: display.issuer,
      account: display.account,
      note: '',
      hasSecret: true,
    },
  };
}

/** Live TOTP authenticator. Codes are generated in the main process each tick. */
export function Authenticator({ onCopy, onChanged }: AuthenticatorProps): JSX.Element {
  const toast = useToast();
  const [displays, setDisplays] = useState<TotpDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SafeTotpEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SafeTotpEntry | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const list = await api.totp.list();
      setDisplays(list);
    } catch {
      /* transient; retried on the next tick */
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function handleCreateOrUpdate(input: TotpEntryInput): Promise<void> {
    if (editing) await api.totp.update(editing.id, input);
    else await api.totp.create(input);
    toast(editing ? '验证器已更新' : '验证器已添加', 'success');
    onChanged();
    await refresh();
  }

  async function handleDelete(): Promise<void> {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    try {
      await api.totp.remove(target.id);
      toast('验证器已删除', 'success');
      onChanged();
      await refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function handleExport(includeSecrets: boolean): Promise<void> {
    setBusy(true);
    try {
      const items = await api.totp.export(includeSecrets);
      if (items.length === 0) {
        toast('没有可导出的验证器', 'info');
        return;
      }
      const result = await api.system.saveTextFile('mail-hub-totp.json', JSON.stringify(items, null, 2));
      if (result.saved) toast('验证器已导出', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
      setExportConfirmOpen(false);
    }
  }

  async function handleImport(): Promise<void> {
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setImportError('JSON 解析失败，请检查粘贴内容。');
      return;
    }
    if (!Array.isArray(parsed)) {
      setImportError('导入内容应为数组格式。');
      return;
    }
    setBusy(true);
    try {
      const created = await api.totp.import(parsed as TotpExportItem[]);
      toast(`已导入 ${created.length} 个验证器`, 'success');
      setImportOpen(false);
      setImportText('');
      onChanged();
      await refresh();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function openCreate(): void {
    setEditing(null);
    setFormOpen(true);
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 3, pt: 3, pb: 1.5 }}>
        <Typography variant="h6">验证器</Typography>
        <Chip size="small" label={`${displays.length} 个`} />
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
          <Button size="small" startIcon={<AddIcon />} onClick={openCreate}>
            添加验证器
          </Button>
          <Button
            size="small"
            startIcon={<FileUploadOutlinedIcon />}
            onClick={() => {
              setImportText('');
              setImportError(null);
              setImportOpen(true);
            }}
          >
            导入
          </Button>
          <Button
            size="small"
            startIcon={<FileDownloadOutlinedIcon />}
            disabled={busy}
            onClick={() => setExportConfirmOpen(true)}
          >
            导出
          </Button>
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 3, pb: 3 }}>
        {!loading && displays.length === 0 ? (
          <EmptyState
            icon={<LockClockOutlinedIcon />}
            title="还没有 TOTP 验证器"
            description="点击「添加验证器」，填入已有的 Base32 密钥或扫描二维码，即可看到实时验证码。"
            action={
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
                去添加
              </Button>
            }
          />
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 1.5,
              pt: 1,
            }}
          >
            {displays.map((display) => (
              <TotpCard
                key={display.id}
                data={display}
                onCopy={onCopy}
                onEdit={() => {
                  setEditing(entryFromDisplay(display));
                  setFormOpen(true);
                }}
                onDelete={() => setDeleteTarget(entryFromDisplay(display))}
              />
            ))}
          </Box>
        )}
      </Box>

      <TotpForm open={formOpen} initial={editing} onClose={() => setFormOpen(false)} onSubmit={handleCreateOrUpdate} />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除验证器？"
        description={`确定要删除「${deleteTarget?.name ?? ''}」吗？该操作不可撤销。`}
        confirmLabel="删除"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />

      <ConfirmDialog
        open={exportConfirmOpen}
        title="导出验证器（包含密钥）？"
        description={'导出的文件会包含 TOTP 明文密钥，请妥善保管，不要上传到任何不安全的位置。\n确认继续导出吗？'}
        confirmLabel="确认导出"
        danger
        onCancel={() => setExportConfirmOpen(false)}
        onConfirm={() => void handleExport(true)}
      />

      <Dialog open={importOpen} onClose={() => setImportOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>导入验证器</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              粘贴由本应用导出的 JSON 数组（每项包含 name / issuer / account / algorithm / digits /
              period / secret）。
            </Typography>
            <TextField
              multiline
              minRows={8}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder='[{"name":"GitHub","issuer":"GitHub","account":"me","algorithm":"SHA1","digits":6,"period":30,"secret":"JBSWY3DPEHPK3PXP"}]'
              fullWidth
              InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12 } }}
            />
            {importError ? <Alert severity="error">{importError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setImportOpen(false)} color="inherit">
            取消
          </Button>
          <Button variant="contained" onClick={() => void handleImport()} disabled={busy || !importText.trim()}>
            {busy ? '导入中…' : '导入'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
