import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import RefreshIcon from '@mui/icons-material/Refresh';
import SyncIcon from '@mui/icons-material/Sync';
import type {
  AppSettings,
  CaptchaMessage,
  ConnectionTestResult,
  SafeSource,
  SourceInput,
} from '../shared/types';
import { api } from './api';
import { Sidebar } from './components/Sidebar';
import { ToastProvider, useToast } from './components/Toast';
import { DEFAULT_APP_SETTINGS } from './constants';
import { formatRelative } from './format';
import { Authenticator } from './pages/Authenticator';
import { Inbox } from './pages/Inbox';
import { Settings } from './pages/Settings';
import { Sources } from './pages/Sources';
import { buildTheme } from './theme';
import type { ViewKey } from './types';

const HIGHLIGHT_DURATION_MS = 6000;

/** Client-side merge that keeps the inbox sorted and free of duplicates. */
function mergeClient(existing: CaptchaMessage[], incoming: CaptchaMessage[]): CaptchaMessage[] {
  const ids = new Set(existing.map((message) => message.id));
  const added = incoming.filter((message) => !ids.has(message.id));
  if (added.length === 0) return existing;
  return [...added, ...existing].sort((a, b) => b.receivedAt - a.receivedAt);
}

const VIEW_TITLES: Record<ViewKey, string> = {
  inbox: '统一收件箱',
  sources: '来源管理',
  authenticator: '验证器',
  settings: '设置',
};

interface ShellProps {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  reloadSettings: () => Promise<void>;
}

function AppShell({ settings, onUpdateSettings, reloadSettings }: ShellProps): JSX.Element {
  const toast = useToast();
  const [view, setView] = useState<ViewKey>('inbox');
  const [sources, setSources] = useState<SafeSource[]>([]);
  const [messages, setMessages] = useState<CaptchaMessage[]>([]);
  const [presets, setPresets] = useState<Awaited<ReturnType<typeof api.sources.presets>>>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(() => new Set());
  const highlightTimers = useRef<Map<string, number>>(new Map());

  const pushHighlights = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setHighlightIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    ids.forEach((id) => {
      const existing = highlightTimers.current.get(id);
      if (existing) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        setHighlightIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        highlightTimers.current.delete(id);
      }, HIGHLIGHT_DURATION_MS);
      highlightTimers.current.set(id, timer);
    });
  }, []);

  const loadMessages = useCallback(async () => {
    const list = await api.messages.list();
    setMessages(list);
  }, []);

  const loadSources = useCallback(async () => {
    const list = await api.sources.list();
    setSources(list);
  }, []);

  const reloadAll = useCallback(async () => {
    await Promise.all([loadSources(), loadMessages()]);
  }, [loadMessages, loadSources]);

  // Initial load + IPC subscriptions.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [sourceList, messageList, presetList, status] = await Promise.all([
          api.sources.list(),
          api.messages.list(),
          api.sources.presets(),
          api.sync.status(),
        ]);
        if (cancelled) return;
        setSources(sourceList);
        setMessages(messageList);
        setPresets(presetList);
        setSyncing(status.syncing);
        if (status.lastRun) setLastSyncAt(status.lastRun.finishedAt);
      } catch (error) {
        if (!cancelled) {
          setBootError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const offNew = api.on.newMessages((incoming) => {
      setMessages((prev) => mergeClient(prev, incoming));
      pushHighlights(incoming.map((message) => message.id));
    });
    const offSync = api.on.syncState((state) => {
      setSyncing(state.syncing);
      if (!state.syncing && state.lastRun) {
        setLastSyncAt(state.lastRun.finishedAt);
      }
    });

    return () => {
      cancelled = true;
      offNew();
      offSync();
    };
  }, [pushHighlights]);

  const handleCopy = useCallback(
    (text: string) => {
      api.system.copy(text);
      toast(`已复制：${text}`, 'success');
    },
    [toast],
  );

  const handleSyncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await api.sync.now();
      await loadMessages();
      setLastSyncAt(result.finishedAt);
      await loadSources();
      toast(result.totalAdded > 0 ? `同步完成，新增 ${result.totalAdded} 条验证码` : '同步完成，暂无新验证码', 'info');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setSyncing(false);
    }
  }, [loadMessages, loadSources, toast]);

  const handleToggleRead = useCallback((id: string, read: boolean) => {
    setMessages((prev) => prev.map((message) => (message.id === id ? { ...message, read } : message)));
    void api.messages.markRead(id, read);
  }, []);

  const handleDeleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((message) => message.id !== id));
    void api.messages.remove(id);
  }, []);

  const handleClearMessages = useCallback(async () => {
    await api.messages.clear();
    setMessages([]);
    toast('已清空验证码记录', 'success');
  }, [toast]);

  const handleMarkAllRead = useCallback(async () => {
    await api.messages.markAllRead();
    setMessages((prev) => prev.map((message) => ({ ...message, read: true })));
  }, []);

  const handleCreateSource = useCallback(
    async (input: SourceInput) => {
      await api.sources.create(input);
      await loadSources();
      toast('来源已添加', 'success');
    },
    [loadSources, toast],
  );

  const handleUpdateSource = useCallback(
    async (id: string, input: SourceInput) => {
      await api.sources.update(id, input);
      await loadSources();
      toast('来源已更新', 'success');
    },
    [loadSources, toast],
  );

  const handleDeleteSource = useCallback(
    async (id: string) => {
      await api.sources.remove(id);
      await Promise.all([loadSources(), loadMessages()]);
      toast('来源已删除', 'success');
    },
    [loadMessages, loadSources, toast],
  );

  const handleToggleSource = useCallback(
    async (id: string, enabled: boolean) => {
      await api.sources.toggle(id, enabled);
      await loadSources();
    },
    [loadSources],
  );

  const handleTestSource = useCallback(
    (input: SourceInput): Promise<ConnectionTestResult> => api.sources.test(input),
    [],
  );

  const refreshEverything = useCallback(async () => {
    await Promise.all([reloadSettings(), reloadAll()]);
  }, [reloadAll, reloadSettings]);

  const totpCount = sources.filter((source) => source.kind === 'totp').length;
  const unreadCount = messages.filter((message) => !message.read).length;

  const content = useMemo(() => {
    switch (view) {
      case 'sources':
        return (
          <Sources
            sources={sources}
            presets={presets}
            onCreate={handleCreateSource}
            onUpdate={handleUpdateSource}
            onDelete={handleDeleteSource}
            onToggle={handleToggleSource}
            onTest={handleTestSource}
          />
        );
      case 'authenticator':
        return (
          <Authenticator
            onCopy={handleCopy}
            onChanged={() => void loadSources()}
            onGoSources={() => setView('sources')}
          />
        );
      case 'settings':
        return (
          <Settings
            settings={settings}
            appVersion={api.system.appVersion}
            platform={api.system.platform}
            onUpdate={onUpdateSettings}
            onRefresh={() => void refreshEverything()}
          />
        );
      default:
        return (
          <Inbox
            messages={messages}
            sources={sources}
            highlightIds={highlightIds}
            loading={loading}
            pinRecent={settings.pinRecent}
            onToggleRead={handleToggleRead}
            onDelete={handleDeleteMessage}
            onClear={() => void handleClearMessages()}
            onMarkAllRead={() => void handleMarkAllRead()}
            onCopy={handleCopy}
          />
        );
    }
  }, [
    view,
    sources,
    presets,
    messages,
    highlightIds,
    loading,
    settings,
    handleCreateSource,
    handleUpdateSource,
    handleDeleteSource,
    handleToggleSource,
    handleTestSource,
    handleCopy,
    handleDeleteMessage,
    handleClearMessages,
    handleMarkAllRead,
    handleToggleRead,
    loadSources,
    onUpdateSettings,
    refreshEverything,
  ]);

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        view={view}
        unreadCount={unreadCount}
        sourceCount={sources.length}
        totpCount={totpCount}
        onChange={setView}
      />
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 3,
            py: 1.5,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Typography variant="subtitle1">{VIEW_TITLES[view]}</Typography>
          {syncing ? (
            <Chip size="small" color="primary" label="同步中…" variant="outlined" />
          ) : lastSyncAt ? (
            <Typography variant="caption" color="text.secondary">
              上次同步：{formatRelative(lastSyncAt)}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary">
              尚未同步
            </Typography>
          )}
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => void reloadAll()}
            >
              刷新
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={syncing}
              startIcon={
                syncing ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <SyncIcon
                    sx={{
                      animation: syncing ? 'hub-spin 1s linear infinite' : 'none',
                      '@keyframes hub-spin': {
                        from: { transform: 'rotate(0deg)' },
                        to: { transform: 'rotate(360deg)' },
                      },
                    }}
                  />
                )
              }
              onClick={() => void handleSyncNow()}
            >
              立即同步
            </Button>
          </Box>
        </Box>

        {bootError ? (
          <Alert severity="error" sx={{ mx: 3, mt: 2 }}>
            初始化失败：{bootError}
          </Alert>
        ) : null}

        <Box sx={{ flex: 1, minHeight: 0 }}>{content}</Box>
      </Box>
    </Box>
  );
}

/** Root component: owns theme + settings, then mounts the application shell. */
export default function App(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

  useEffect(() => {
    void (async () => {
      try {
        setSettings(await api.settings.get());
      } catch {
        /* keep defaults if settings cannot be read */
      }
    })();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  const theme = useMemo(() => buildTheme(settings.theme), [settings.theme]);

  const handleUpdateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const updated = await api.settings.update(patch);
    setSettings(updated);
  }, []);

  const reloadSettings = useCallback(async () => {
    try {
      setSettings(await api.settings.get());
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ToastProvider>
        <AppShell
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          reloadSettings={reloadSettings}
        />
      </ToastProvider>
    </ThemeProvider>
  );
}
