import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import LockClockOutlinedIcon from '@mui/icons-material/LockClockOutlined';
import MarkunreadMailboxOutlinedIcon from '@mui/icons-material/MarkunreadMailboxOutlined';
import PhoneIphoneOutlinedIcon from '@mui/icons-material/PhoneIphoneOutlined';
import type {
  ConnectionTestResult,
  SafeSource,
  SourceInput,
  SourceKind,
  SourcePreset,
} from '../../shared/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { SourceForm } from '../components/SourceForm';
import { KIND_META } from '../constants';
import { formatRelative } from '../format';

interface SourcesProps {
  sources: SafeSource[];
  presets: SourcePreset[];
  onCreate: (input: SourceInput) => Promise<void>;
  onUpdate: (id: string, input: SourceInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onTest: (input: SourceInput) => Promise<ConnectionTestResult>;
}

const KIND_ORDER: SourceKind[] = ['email', 'phone', 'totp'];

function summaryFor(source: SafeSource): string {
  if (source.kind === 'email' && source.email) {
    return `${source.email.username || '(未填写用户名)'} · ${source.email.host}:${source.email.port}${source.email.secure ? ' · SSL' : ''}`;
  }
  if (source.kind === 'phone' && source.phone) {
    return `${source.phone.phoneNumber} · 按「${source.phone.rule.matchField}」匹配「${source.phone.rule.matchKeyword}」`;
  }
  if (source.kind === 'totp' && source.totp) {
    return `${source.totp.issuer || '(无发行方)'} · ${source.totp.account || '(无账户)'} · ${source.totp.algorithm} / ${source.totp.digits} 位 / ${source.totp.period}s`;
  }
  return '';
}

/** Source management: add / edit / enable / test / delete every kind of source. */
export function Sources({
  sources,
  presets,
  onCreate,
  onUpdate,
  onDelete,
  onToggle,
  onTest,
}: SourcesProps): JSX.Element {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SafeSource | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SafeSource | null>(null);

  const emailSources = sources.filter((source) => source.kind === 'email');

  function openCreate(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(source: SafeSource): void {
    setEditing(source);
    setFormOpen(true);
  }

  async function handleSubmit(input: SourceInput): Promise<void> {
    if (editing) {
      await onUpdate(editing.id, input);
    } else {
      await onCreate(input);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 3, pt: 3, pb: 1.5 }}>
        <Typography variant="h6">来源管理</Typography>
        <Chip size="small" label={`共 ${sources.length} 个`} />
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          sx={{ ml: 'auto' }}
          onClick={openCreate}
        >
          新增来源
        </Button>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 3, pb: 3 }}>
        {sources.length === 0 ? (
          <EmptyState
            icon={<MarkunreadMailboxOutlinedIcon />}
            title="还没有任何来源"
            description="添加一个邮箱来源来接收短信转发邮件，或添加 TOTP 验证器来管理两步验证。"
            action={
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
                新增来源
              </Button>
            }
          />
        ) : (
          KIND_ORDER.map((kind) => {
            const group = sources.filter((source) => source.kind === kind);
            if (group.length === 0) return null;
            return (
              <Box key={kind} sx={{ mt: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  {KIND_META[kind].label}（{group.length}）
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {group.map((source) => (
                    <Card key={source.id}>
                      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.5 }}>
                        <Box sx={{ color: KIND_META[source.kind].color, display: 'flex' }}>
                          {source.kind === 'email' ? (
                            <EmailOutlinedIcon />
                          ) : source.kind === 'phone' ? (
                            <PhoneIphoneOutlinedIcon />
                          ) : (
                            <LockClockOutlinedIcon />
                          )}
                        </Box>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="subtitle2" noWrap>
                              {source.name}
                            </Typography>
                            {source.lastSyncStatus === 'error' ? (
                              <Chip size="small" color="error" label="同步失败" />
                            ) : null}
                          </Box>
                          <Typography variant="caption" color="text.secondary" noWrap component="div">
                            {summaryFor(source)}
                          </Typography>
                          {source.kind === 'email' && source.lastSyncAt ? (
                            <Typography variant="caption" color="text.secondary" component="div">
                              上次同步：{formatRelative(source.lastSyncAt)}
                              {source.lastSyncError ? ` · ${source.lastSyncError}` : ''}
                            </Typography>
                          ) : null}
                        </Box>
                        <Tooltip title={source.enabled ? '停用' : '启用'}>
                          <Switch
                            checked={source.enabled}
                            onChange={(event) => void onToggle(source.id, event.target.checked)}
                          />
                        </Tooltip>
                        <Tooltip title="编辑">
                          <IconButton size="small" onClick={() => openEdit(source)}>
                            <EditOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="删除">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setDeleteTarget(source)}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              </Box>
            );
          })
        )}

        <Divider sx={{ my: 3 }} />
        <Typography variant="caption" color="text.secondary">
          合规提示：请只绑定你本人拥有或有权使用的手机号 / 邮箱，并确保能完成所有权回验。本应用仅用于管理你自己的验证码来源，不提供任何代收、代持或转卖号码的能力。
        </Typography>
      </Box>

      <SourceForm
        open={formOpen}
        initial={editing}
        presets={presets}
        emailSources={emailSources}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
        onTest={onTest}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除来源？"
        description={`确定要删除「${deleteTarget?.name ?? ''}」吗？该来源关联的验证码记录也会一并删除。`}
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
