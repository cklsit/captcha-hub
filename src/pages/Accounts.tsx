import { useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import MarkunreadMailboxOutlinedIcon from '@mui/icons-material/MarkunreadMailboxOutlined';
import type {
  AccountInput,
  AccountPreset,
  ConnectionTestResult,
  Folder,
  SafeAccount,
} from '../../shared/types';
import { api } from '../api';
import { AccountForm } from '../components/AccountForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { formatRelative } from '../format';

interface AccountsProps {
  accounts: SafeAccount[];
  presets: AccountPreset[];
  onCreate: (input: AccountInput) => Promise<void>;
  onUpdate: (id: string, input: AccountInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onTest: (input: AccountInput) => Promise<ConnectionTestResult>;
  onTestSmtp: (input: AccountInput) => Promise<ConnectionTestResult>;
}

/** Account management: add / edit / enable / delete, plus per-account sync folders. */
export function Accounts({
  accounts,
  presets,
  onCreate,
  onUpdate,
  onDelete,
  onToggle,
  onTest,
  onTestSmtp,
}: AccountsProps): JSX.Element {
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SafeAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SafeAccount | null>(null);
  const [folderTarget, setFolderTarget] = useState<SafeAccount | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function openCreate(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(account: SafeAccount): void {
    setEditing(account);
    setFormOpen(true);
  }

  async function handleSubmit(input: AccountInput): Promise<void> {
    if (editing) await onUpdate(editing.id, input);
    else await onCreate(input);
  }

  async function openFolders(account: SafeAccount): Promise<void> {
    setFolderTarget(account);
    setBusy(true);
    setFolders([]);
    setSelectedPaths(account.syncFolders);
    try {
      const list = await api.folders.refresh(account.id);
      setFolders(list);
      setSelectedPaths(list.filter((folder) => folder.subscribed).map((folder) => folder.path));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveFolders(): Promise<void> {
    if (!folderTarget) return;
    setBusy(true);
    try {
      await api.folders.setSubscribed(folderTarget.id, selectedPaths);
      toast('同步文件夹已更新', 'success');
      setFolderTarget(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 3, pt: 3, pb: 1.5 }}>
        <Typography variant="h6">账户管理</Typography>
        <Chip size="small" label={`共 ${accounts.length} 个`} />
        <Button variant="contained" size="small" startIcon={<AddIcon />} sx={{ ml: 'auto' }} onClick={openCreate}>
          新增账户
        </Button>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 3, pb: 3 }}>
        {accounts.length === 0 ? (
          <EmptyState
            icon={<MarkunreadMailboxOutlinedIcon />}
            title="还没有任何账户"
            description="添加一个邮箱账户来收发邮件；所有邮件都会入库，验证码会被自动高亮。"
            action={
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
                新增账户
              </Button>
            }
          />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {accounts.map((account) => (
              <Card key={account.id}>
                <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.5 }}>
                  <Box sx={{ color: 'primary.main', display: 'flex' }}>
                    <EmailOutlinedIcon />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="subtitle2" noWrap>
                        {account.name}
                      </Typography>
                      {account.needsReauth ? <Chip size="small" color="warning" label="需重新授权" /> : null}
                      {account.lastSyncStatus === 'error' ? <Chip size="small" color="error" label="同步失败" /> : null}
                    </Box>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {account.emailAddress || '(未填写地址)'} · {account.imap.host}:{account.imap.port}
                      {account.imap.secure ? ' · SSL' : ''}
                      {account.smtp ? ' · 已配置 SMTP' : ' · 未配置 SMTP'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      同步文件夹：{account.syncFolders.join('、') || 'INBOX'}
                      {account.lastSyncAt ? ` · 上次同步：${formatRelative(account.lastSyncAt)}` : ''}
                      {account.lastSyncError ? ` · ${account.lastSyncError}` : ''}
                    </Typography>
                  </Box>
                  <Tooltip title="选择同步文件夹">
                    <IconButton size="small" onClick={() => void openFolders(account)}>
                      <FolderOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={account.enabled ? '停用' : '启用'}>
                    <Switch checked={account.enabled} onChange={(event) => void onToggle(account.id, event.target.checked)} />
                  </Tooltip>
                  <Tooltip title="编辑">
                    <IconButton size="small" onClick={() => openEdit(account)}>
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="删除">
                    <IconButton size="small" color="error" onClick={() => setDeleteTarget(account)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </CardContent>
              </Card>
            ))}
          </Box>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
          合规提示：请只绑定你本人拥有或有权使用的邮箱账户。本应用仅用于管理你自己的邮箱，数据全部保存在本机，不会上传。
        </Typography>
      </Box>

      <AccountForm
        open={formOpen}
        initial={editing}
        presets={presets}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
        onTest={onTest}
        onTestSmtp={onTestSmtp}
      />

      <Dialog open={folderTarget !== null} onClose={() => setFolderTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>选择「{folderTarget?.name}」要同步的文件夹</DialogTitle>
        <DialogContent dividers>
          {busy && folders.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              正在连接邮箱获取文件夹…
            </Typography>
          ) : folders.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              没有获取到文件夹。请先在「编辑」中测试 IMAP 连接。
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {folders.map((folder) => (
                <FormControlLabel
                  key={folder.id}
                  control={
                    <Checkbox
                      checked={selectedPaths.includes(folder.path)}
                      onChange={(event) =>
                        setSelectedPaths((prev) =>
                          event.target.checked
                            ? [...prev, folder.path]
                            : prev.filter((path) => path !== folder.path),
                        )
                      }
                    />
                  }
                  label={`${folder.name}${folder.unreadCount > 0 ? `（未读 ${folder.unreadCount}）` : ''}`}
                />
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setFolderTarget(null)} color="inherit">
            取消
          </Button>
          <Button variant="contained" disabled={busy} onClick={() => void saveFolders()}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除账户？"
        description={`确定要删除「${deleteTarget?.name ?? ''}」吗？该账户下的本地邮件也会一并删除，服务器上的邮件不受影响。`}
        confirmLabel="删除"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) void onDelete(target.id);
        }}
      />
    </Box>
  );
}
