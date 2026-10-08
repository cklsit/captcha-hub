import { useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import type { AppSettings, BackupBundle } from '../../shared/types';
import { api } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { POLL_INTERVAL_OPTIONS } from '../constants';

interface SettingsProps {
  settings: AppSettings;
  appVersion: string;
  platform: string;
  onUpdate: (patch: Partial<AppSettings>) => Promise<void>;
  onRefresh: () => void;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="subtitle1">{title}</Typography>
        {description ? (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
            {description}
          </Typography>
        ) : null}
        <Box sx={{ mt: 1.5 }}>{children}</Box>
      </CardContent>
    </Card>
  );
}

/** Application settings, data management and compliance information. */
export function Settings({ settings, appVersion, platform, onUpdate, onRefresh }: SettingsProps): JSX.Element {
  const toast = useToast();
  const [clearConfirm, setClearConfirm] = useState(false);
  const [exportSecretConfirm, setExportSecretConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleExport(includeSecrets: boolean): Promise<void> {
    setBusy(true);
    try {
      const bundle = await api.settings.export(includeSecrets);
      const result = await api.system.saveTextFile('mail-hub-backup.json', JSON.stringify(bundle, null, 2));
      if (result.saved) toast('备份已导出', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
      setExportSecretConfirm(false);
    }
  }

  async function handleImport(): Promise<void> {
    setBusy(true);
    try {
      const opened = await api.system.openTextFile();
      if (opened.canceled || !opened.content) return;
      const bundle = JSON.parse(opened.content) as BackupBundle;
      await api.settings.import(bundle);
      toast('备份已导入', 'success');
      onRefresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleClearAll(): Promise<void> {
    setBusy(true);
    try {
      await api.settings.clearAll();
      toast('已清空全部数据', 'success');
      onRefresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
      setClearConfirm(false);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ px: 3, pt: 3, pb: 1.5 }}>
        <Typography variant="h6">设置</Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 3, pb: 3 }}>
        <Section title="外观">
          <FormControlLabel
            control={
              <Switch
                checked={settings.theme === 'dark'}
                onChange={(event) => void onUpdate({ theme: event.target.checked ? 'dark' : 'light' })}
              />
            }
            label={settings.theme === 'dark' ? '深色主题' : '浅色主题'}
          />
        </Section>

        <Section title="同步" description="应用会按此间隔自动连接邮箱，增量收取所有订阅文件夹中的新邮件。">
          <TextField
            select
            size="small"
            label="同步间隔"
            value={settings.pollIntervalSec}
            onChange={(event) => void onUpdate({ pollIntervalSec: Number(event.target.value) })}
            sx={{ width: 200 }}
          >
            {POLL_INTERVAL_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            sx={{ display: 'block', mt: 1 }}
            control={
              <Switch
                checked={settings.pinRecent}
                onChange={(event) => void onUpdate({ pinRecent: event.target.checked })}
              />
            }
            label="将最近 5 分钟的新邮件高亮置顶"
          />
        </Section>

        <Section title="阅读体验" description="邮件正文默认在沙箱中渲染，可执行脚本一律被剥离。">
          <FormControlLabel
            control={
              <Switch
                checked={settings.bodyRenderMode === 'html'}
                onChange={(event) =>
                  void onUpdate({ bodyRenderMode: event.target.checked ? 'html' : 'text' })
                }
              />
            }
            label={settings.bodyRenderMode === 'html' ? '以 HTML 渲染正文' : '以纯文本渲染正文'}
          />
          <FormControlLabel
            sx={{ display: 'block' }}
            control={
              <Switch
                checked={settings.allowRemoteImages}
                onChange={(event) => void onUpdate({ allowRemoteImages: event.target.checked })}
              />
            }
            label="默认加载外部图片（可能被发件人用于追踪）"
          />
          <TextField
            label="附件默认保存目录"
            size="small"
            fullWidth
            sx={{ mt: 1 }}
            value={settings.attachmentDir}
            onChange={(event) => void onUpdate({ attachmentDir: event.target.value })}
            placeholder="留空则每次下载时都询问保存位置"
            helperText="下载附件时会话框的默认目录，不会自动保存任何文件。"
          />
        </Section>

        <Section title="系统">
          <FormControlLabel
            control={
              <Switch
                checked={settings.launchOnStartup}
                onChange={(event) => void onUpdate({ launchOnStartup: event.target.checked })}
              />
            }
            label="开机自动启动"
          />
        </Section>

        <Section title="数据管理" description="账户与邮件索引保存在本机；导出文件可能包含敏感密钥，请妥善保管。">
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
            <Button
              variant="outlined"
              startIcon={<FileDownloadOutlinedIcon />}
              disabled={busy}
              onClick={() => void handleExport(false)}
            >
              导出备份（不含密钥）
            </Button>
            <Button
              variant="outlined"
              color="warning"
              startIcon={<FileDownloadOutlinedIcon />}
              disabled={busy}
              onClick={() => setExportSecretConfirm(true)}
            >
              导出备份（含 TOTP 密钥）
            </Button>
            <Button
              variant="outlined"
              startIcon={<FileUploadOutlinedIcon />}
              disabled={busy}
              onClick={() => void handleImport()}
            >
              导入备份
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteForeverOutlinedIcon />}
              disabled={busy}
              onClick={() => setClearConfirm(true)}
            >
              清空全部数据
            </Button>
          </Stack>
        </Section>

        <Section title="隐私与合规">
          <Alert severity="info" icon={false} sx={{ mb: 1.5 }}>
            本应用仅用于管理<strong>你本人拥有或有权使用</strong>的邮箱账户。
          </Alert>
          <Typography variant="body2" color="text.secondary" component="div">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>账户配置、邮件索引与正文全部保存在本机，不会上传到任何服务器。</li>
              <li>IMAP / SMTP 密码、OAuth 令牌与 TOTP 密钥均加密后落盘；界面不会回显任何明文密钥。</li>
              <li>OAuth 访问令牌仅驻留在主进程，渲染界面永远接触不到令牌本身。</li>
              <li>邮件正文在沙箱 iframe 中渲染，脚本、内联事件与外链均被净化；远程图片默认拦截。</li>
              <li>请不要用它来代收或转卖他人邮箱的验证码——那属于违规行为，本应用不提供该能力。</li>
            </ul>
          </Typography>
        </Section>

        <Section title="关于">
          <Typography variant="body2" color="text.secondary">
            Mail Hub · 邮件中心
          </Typography>
          <Divider sx={{ my: 1 }} />
          <Typography variant="body2" color="text.secondary">
            版本：{appVersion}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            运行平台：{platform}
          </Typography>
        </Section>
      </Box>

      <ConfirmDialog
        open={clearConfirm}
        title="清空全部数据？"
        description="这会删除所有账户、邮件索引、草稿、TOTP 密钥与设置，且不可撤销。建议先导出备份。"
        confirmLabel="清空全部"
        danger
        onCancel={() => setClearConfirm(false)}
        onConfirm={() => void handleClearAll()}
      />

      <ConfirmDialog
        open={exportSecretConfirm}
        title="导出包含 TOTP 密钥的备份？"
        description="导出的文件会包含明文 TOTP 密钥，请勿上传到不安全的位置。确认继续吗？"
        confirmLabel="确认导出"
        danger
        onCancel={() => setExportSecretConfirm(false)}
        onConfirm={() => void handleExport(true)}
      />
    </Box>
  );
}
