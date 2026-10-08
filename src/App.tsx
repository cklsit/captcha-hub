import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import SyncIcon from '@mui/icons-material/Sync';
import type {
  AccountInput,
  AccountPreset,
  AppSettings,
  ComposePayload,
  ConnectionTestResult,
  Draft,
  Envelope,
  Folder,
  MailMessage,
  MessageFilter,
  SafeAccount,
} from '../shared/types';
import { api } from './api';
import { draftToComposePayload } from './compose-prefill';
import { mergeSearchResults } from './search-merge';
import { Accounts } from './pages/Accounts';
import { Authenticator } from './pages/Authenticator';
import { Mail } from './pages/Mail';
import { Settings } from './pages/Settings';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Sidebar } from './components/Sidebar';
import { ToastProvider, useToast } from './components/Toast';
import { DEFAULT_APP_SETTINGS } from './constants';
import { formatRelative } from './format';
import { buildTheme } from './theme';
import { DRAFTS_FOLDER, type MailSelection, type ViewKey } from './types';

const HIGHLIGHT_DURATION_MS = 6000;

/** Upper bound on body-text search hits fetched from the on-demand scanner. */
const SEARCH_BODY_LIMIT = 500;

const VIEW_TITLES: Record<ViewKey, string> = {
  mail: '邮件',
  authenticator: '验证器',
  settings: '设置',
};

const EMPTY_SELECTION: MailSelection = { accountId: 'all', folderId: 'all' };

/** Merges the current account/folder selection with the quick-filter state. */
function buildFilter(selection: MailSelection, filter: MessageFilter): MessageFilter {
  return { ...filter, accountId: selection.accountId, folderId: selection.folderId };
}

interface ShellProps {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  reloadSettings: () => Promise<void>;
}

function AppShell({ settings, onUpdateSettings, reloadSettings }: ShellProps): JSX.Element {
  const toast = useToast();
  const [view, setView] = useState<ViewKey>('mail');
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [accounts, setAccounts] = useState<SafeAccount[]>([]);
  const [presets, setPresets] = useState<AccountPreset[]>([]);
  const [foldersByAccount, setFoldersByAccount] = useState<Record<string, Folder[]>>({});
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftCounts, setDraftCounts] = useState<Record<string, number>>({});
  const [bodyMatchIds, setBodyMatchIds] = useState<Set<string>>(() => new Set());
  const [selection, setSelection] = useState<MailSelection>(EMPTY_SELECTION);
  const [filter, setFilter] = useState<MessageFilter>({});
  const [selectedMessage, setSelectedMessage] = useState<MailMessage | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Envelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [totpCount, setTotpCount] = useState(0);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(() => new Set());
  const [downloadingPartId, setDownloadingPartId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeInitial, setComposeInitial] = useState<ComposePayload | null>(null);
  const highlightTimers = useRef<Map<string, number>>(new Map());

  /* -------------------------------------------------------------- highlights */

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

  /* ------------------------------------------------------------------ loaders */

  const loadAccounts = useCallback(async () => {
    setAccounts(await api.accounts.list());
  }, []);

  const loadFolders = useCallback(async () => {
    const list = await api.folders.list();
    const grouped: Record<string, Folder[]> = {};
    for (const folder of list) {
      (grouped[folder.accountId] ??= []).push(folder);
    }
    setFoldersByAccount(grouped);
  }, []);

  const loadEnvelopes = useCallback(async () => {
    if (selection.folderId === DRAFTS_FOLDER) return;
    setLoading(true);
    try {
      const meta = await api.messages.list(buildFilter(selection, filter));
      setEnvelopes(meta);

      const term = (filter.search ?? '').trim();
      if (!term) {
        setBodyMatchIds(new Set());
        return;
      }

      // Progressive search: metadata hits are already on screen; now ask the
      // on-demand body scanner, scoped to the CURRENT view so its result cap
      // cannot be eaten by other folders, then merge the two stages with a
      // pure, unit-tested helper.
      const viewFilter = buildFilter(selection, { ...filter, search: undefined });
      const bodyHitIds = await api.messages.searchBodies(term, viewFilter, SEARCH_BODY_LIMIT);
      if (bodyHitIds.length === 0) {
        setBodyMatchIds(new Set());
        return;
      }
      const candidates = await api.messages.list(viewFilter);
      const merged = mergeSearchResults(meta, bodyHitIds, candidates, SEARCH_BODY_LIMIT);
      setBodyMatchIds(merged.bodyMatchIds);
      setEnvelopes(merged.envelopes);
    } finally {
      setLoading(false);
    }
  }, [selection, filter]);

  const loadDrafts = useCallback(async () => {
    const all = await api.compose.listDrafts();
    setDrafts(all);
    const counts: Record<string, number> = {};
    for (const draft of all) counts[draft.accountId] = (counts[draft.accountId] ?? 0) + 1;
    setDraftCounts(counts);
  }, []);

  const refreshTotpCount = useCallback(async () => {
    try {
      setTotpCount((await api.totp.list()).length);
    } catch {
      /* count is cosmetic */
    }
  }, []);

  /* ------------------------------------------------------------- subscriptions */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [accountList, presetList, folderList, status] = await Promise.all([
          api.accounts.list(),
          api.accounts.presets(),
          api.folders.list(),
          api.sync.status(),
        ]);
        if (cancelled) return;
        setAccounts(accountList);
        setPresets(presetList);
        const grouped: Record<string, Folder[]> = {};
        for (const folder of folderList) (grouped[folder.accountId] ??= []).push(folder);
        setFoldersByAccount(grouped);
        setSyncing(status.syncing);
        if (status.lastRun) setLastSyncAt(status.lastRun.finishedAt);
      } catch (error) {
        if (!cancelled) setBootError(error instanceof Error ? error.message : String(error));
      }
    })();
    void refreshTotpCount();
    void loadDrafts();

    return () => {
      cancelled = true;
    };
  }, [refreshTotpCount, loadDrafts]);

  useEffect(() => {
    void loadEnvelopes();
  }, [loadEnvelopes]);

  useEffect(() => {
    if (selection.folderId === DRAFTS_FOLDER) void loadDrafts();
  }, [selection, loadDrafts]);

  useEffect(() => {
    const offNew = api.on.newMessages((incoming) => {
      pushHighlights(incoming.map((envelope) => envelope.id));
      void loadFolders();
      void loadEnvelopes();
    });
    const offSync = api.on.syncState((state) => {
      setSyncing(state.syncing);
      if (!state.syncing && state.lastRun) setLastSyncAt(state.lastRun.finishedAt);
    });
    const offFolders = api.on.foldersChanged(() => {
      void loadFolders();
    });

    return () => {
      offNew();
      offSync();
      offFolders();
    };
  }, [loadEnvelopes, loadFolders, pushHighlights]);

  /* ---------------------------------------------------------------- selection */

  const handleSelectAll = useCallback(() => {
    setSelection({ accountId: 'all', folderId: 'all' });
    setSelectedMessage(null);
  }, []);

  const handleSelectAccount = useCallback((accountId: string) => {
    setSelection({ accountId, folderId: 'all' });
    setSelectedMessage(null);
  }, []);

  const handleSelectFolder = useCallback((accountId: string, folderId: string) => {
    setSelection({ accountId, folderId });
    setSelectedMessage(null);
  }, []);

  const handleSelectDrafts = useCallback((accountId: string) => {
    setSelection({ accountId, folderId: DRAFTS_FOLDER });
    setSelectedMessage(null);
    setLoading(false);
  }, []);

  /* ---------------------------------------------------------------- messages */

  const handleSelectEnvelope = useCallback(
    (envelope: Envelope) => {
      void (async () => {
        try {
          const message = await api.messages.get(envelope.id);
          setSelectedMessage(message);
          if (message && !envelope.flags.seen) {
            await api.messages.setFlags(envelope.id, { seen: true });
            setEnvelopes((prev) =>
              prev.map((item) => (item.id === envelope.id ? { ...item, flags: { ...item.flags, seen: true } } : item)),
            );
            setSelectedMessage((prev) =>
              prev ? { ...prev, envelope: { ...prev.envelope, flags: { ...prev.envelope.flags, seen: true } } } : prev,
            );
            void loadFolders();
          }
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), 'error');
        }
      })();
    },
    [loadFolders, toast],
  );

  const handleToggleSeen = useCallback(
    (seen: boolean) => {
      const current = selectedMessage;
      if (!current) return;
      const id = current.envelope.id;
      void (async () => {
        try {
          await api.messages.setFlags(id, { seen });
          setEnvelopes((prev) =>
            prev.map((item) => (item.id === id ? { ...item, flags: { ...item.flags, seen } } : item)),
          );
          setSelectedMessage((prev) => (prev ? { ...prev, envelope: { ...prev.envelope, flags: { ...prev.envelope.flags, seen } } } : prev));
          void loadFolders();
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), 'error');
        }
      })();
    },
    [selectedMessage, loadFolders, toast],
  );

  const handleMove = useCallback(
    (folderId: string) => {
      const current = selectedMessage;
      if (!current) return;
      const id = current.envelope.id;
      void (async () => {
        try {
          await api.messages.move(id, folderId);
          setEnvelopes((prev) => prev.filter((item) => item.id !== id));
          setSelectedMessage(null);
          await loadFolders();
          toast('已移动', 'success');
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), 'error');
        }
      })();
    },
    [selectedMessage, loadFolders, toast],
  );

  const confirmDelete = useCallback(() => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    void (async () => {
      try {
        await api.messages.remove(target.id);
        setEnvelopes((prev) => prev.filter((item) => item.id !== target.id));
        setSelectedMessage((prev) => (prev && prev.envelope.id === target.id ? null : prev));
        await loadFolders();
        toast('已删除', 'success');
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), 'error');
      }
    })();
  }, [pendingDelete, loadFolders, toast]);

  const handleMarkAllRead = useCallback(() => {
    void (async () => {
      try {
        await api.messages.markAllRead(buildFilter(selection, filter));
        setEnvelopes((prev) => prev.map((item) => ({ ...item, flags: { ...item.flags, seen: true } })));
        void loadFolders();
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), 'error');
      }
    })();
  }, [selection, filter, loadFolders, toast]);

  const handleDownloadAttachment = useCallback(
    (partId: string) => {
      const current = selectedMessage;
      if (!current) return;
      const id = current.envelope.id;
      setDownloadingPartId(partId);
      void (async () => {
        try {
          const result = await api.attachments.download(id, partId);
          if (result.saved) toast(`已保存到：${result.path ?? ''}`, 'success');
          else toast(result.error ?? '附件下载失败', 'error');
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), 'error');
        } finally {
          setDownloadingPartId(null);
        }
      })();
    },
    [selectedMessage, toast],
  );

  /* ----------------------------------------------------------------- compose */

  const openCompose = useCallback((prefill: ComposePayload | null) => {
    setComposeInitial(prefill);
    setComposeOpen(true);
  }, []);

  const handleOpenDraft = useCallback(
    (draft: Draft) => {
      openCompose(draftToComposePayload(draft));
    },
    [openCompose],
  );

  const handleDeleteDraft = useCallback(
    (draft: Draft) => {
      void (async () => {
        try {
          await api.compose.removeDraft(draft.id);
          await loadDrafts();
          toast('草稿已删除', 'success');
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), 'error');
        }
      })();
    },
    [loadDrafts, toast],
  );

  const handleDraftSaved = useCallback(() => {
    void loadDrafts();
  }, [loadDrafts]);

  const handleReply = useCallback(() => {
    const current = selectedMessage;
    if (!current) return;
    void (async () => {
      const prefill = await api.compose.replyPrefill(current.envelope.id);
      if (prefill) openCompose(prefill);
      else toast('无法创建回复草稿。', 'error');
    })();
  }, [selectedMessage, openCompose, toast]);

  const handleForward = useCallback(() => {
    const current = selectedMessage;
    if (!current) return;
    void (async () => {
      const prefill = await api.compose.forwardPrefill(current.envelope.id);
      if (prefill) openCompose(prefill);
      else toast('无法创建转发草稿。', 'error');
    })();
  }, [selectedMessage, openCompose, toast]);

  const handleComposeSent = useCallback(() => {
    void loadEnvelopes();
    void loadFolders();
    void loadAccounts();
    void loadDrafts();
  }, [loadEnvelopes, loadFolders, loadAccounts, loadDrafts]);

  /* ------------------------------------------------------------------ sync */

  const handleSyncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await api.sync.now();
      await Promise.all([loadAccounts(), loadFolders(), loadEnvelopes()]);
      setLastSyncAt(result.finishedAt);
      toast(result.totalAdded > 0 ? `同步完成，新增 ${result.totalAdded} 封邮件` : '同步完成，暂无新邮件', 'info');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setSyncing(false);
    }
  }, [loadAccounts, loadFolders, loadEnvelopes, toast]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([loadAccounts(), loadFolders(), loadEnvelopes(), loadDrafts(), reloadSettings()]);
  }, [loadAccounts, loadFolders, loadEnvelopes, loadDrafts, reloadSettings]);

  /* --------------------------------------------------------------- accounts CRUD */

  const handleCreateAccount = useCallback(
    async (input: AccountInput) => {
      await api.accounts.create(input);
      await Promise.all([loadAccounts(), loadFolders()]);
      toast('账户已添加，正在后台同步…', 'success');
    },
    [loadAccounts, loadFolders, toast],
  );

  const handleUpdateAccount = useCallback(
    async (id: string, input: AccountInput) => {
      await api.accounts.update(id, input);
      await Promise.all([loadAccounts(), loadFolders()]);
      toast('账户已更新', 'success');
    },
    [loadAccounts, loadFolders, toast],
  );

  const handleDeleteAccount = useCallback(
    async (id: string) => {
      await api.accounts.remove(id);
      await Promise.all([loadAccounts(), loadFolders(), loadEnvelopes()]);
      setSelection((prev) => (prev.accountId === id ? EMPTY_SELECTION : prev));
      setSelectedMessage((prev) => (prev && prev.envelope.accountId === id ? null : prev));
      toast('账户已删除', 'success');
    },
    [loadAccounts, loadFolders, loadEnvelopes, toast],
  );

  const handleToggleAccount = useCallback(
    async (id: string, enabled: boolean) => {
      await api.accounts.toggle(id, enabled);
      await loadAccounts();
    },
    [loadAccounts],
  );

  const handleTestAccount = useCallback(
    (input: AccountInput): Promise<ConnectionTestResult> => api.accounts.test(input),
    [],
  );

  const handleTestSmtp = useCallback(
    (input: AccountInput): Promise<ConnectionTestResult> => api.accounts.testSmtp(input),
    [],
  );

  /* ------------------------------------------------------------------- copy */

  const handleCopy = useCallback(
    (text: string) => {
      api.system.copy(text);
      toast(`已复制：${text}`, 'success');
    },
    [toast],
  );

  /* ---------------------------------------------------------------- derived */

  const accountsById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const account of accounts) map[account.id] = account.name;
    return map;
  }, [accounts]);

  const foldersById = useMemo(() => {
    const map: Record<string, string> = {};
    // Envelope.folderId holds the folder *path* (e.g. "INBOX"), so key by path.
    for (const folders of Object.values(foldersByAccount)) {
      for (const folder of folders) map[folder.path] = folder.name;
    }
    return map;
  }, [foldersByAccount]);

  const messageFolders = useMemo(
    () => (selectedMessage ? foldersByAccount[selectedMessage.envelope.accountId] ?? [] : []),
    [selectedMessage, foldersByAccount],
  );

  const draftsMode = selection.folderId === DRAFTS_FOLDER;
  const draftAccountName = selection.accountId !== 'all' ? accountsById[selection.accountId] : undefined;
  const visibleDrafts = useMemo(
    () =>
      selection.accountId === 'all'
        ? drafts
        : drafts.filter((draft) => draft.accountId === selection.accountId),
    [drafts, selection.accountId],
  );

  const unreadCount = useMemo(
    () =>
      Object.values(foldersByAccount)
        .flat()
        .reduce((sum, folder) => sum + folder.unreadCount, 0),
    [foldersByAccount],
  );

  const showMigrationBanner = settings.migrationNotice.trim().length > 0;

  /* ----------------------------------------------------------------- render */

  const changeView = useCallback(
    (next: ViewKey) => {
      setView(next);
      if (next !== 'mail') setAccountsOpen(false);
      if (next === 'authenticator') void refreshTotpCount();
    },
    [refreshTotpCount],
  );

  const mailContent =
    view === 'mail' ? (
      accountsOpen ? (
        <Accounts
          accounts={accounts}
          presets={presets}
          onCreate={handleCreateAccount}
          onUpdate={handleUpdateAccount}
          onDelete={handleDeleteAccount}
          onToggle={handleToggleAccount}
          onTest={handleTestAccount}
          onTestSmtp={handleTestSmtp}
        />
      ) : (
        <Mail
          accounts={accounts}
          foldersByAccount={foldersByAccount}
          draftCounts={draftCounts}
          envelopes={envelopes}
          accountsById={accountsById}
          foldersById={foldersById}
          selection={selection}
          selectedMessage={selectedMessage}
          messageFolders={messageFolders}
          draftsMode={draftsMode}
          drafts={visibleDrafts}
          draftAccountName={draftAccountName}
          loading={loading}
          syncing={syncing}
          highlightIds={highlightIds}
          bodyMatchIds={bodyMatchIds}
          filter={filter}
          bodyRenderMode={settings.bodyRenderMode}
          allowRemoteImages={settings.allowRemoteImages}
          downloadingPartId={downloadingPartId}
          composeOpen={composeOpen}
          composeInitial={composeInitial}
          onSelectAll={handleSelectAll}
          onSelectAccount={handleSelectAccount}
          onSelectFolder={handleSelectFolder}
          onSelectDrafts={handleSelectDrafts}
          onManageAccounts={() => setAccountsOpen(true)}
          onFilterChange={(patch) => setFilter((prev) => ({ ...prev, ...patch }))}
          onSelectEnvelope={handleSelectEnvelope}
          onCopy={handleCopy}
          onMarkAllRead={handleMarkAllRead}
          onReply={handleReply}
          onForward={handleForward}
          onDeleteSelected={() => setPendingDelete(selectedMessage?.envelope ?? null)}
          onToggleSeen={handleToggleSeen}
          onMove={handleMove}
          onDownloadAttachment={handleDownloadAttachment}
          onToggleExternalImages={(allow) => void onUpdateSettings({ allowRemoteImages: allow })}
          onOpenDraft={handleOpenDraft}
          onDeleteDraft={handleDeleteDraft}
          onDraftSaved={handleDraftSaved}
          onComposeClose={() => setComposeOpen(false)}
          onComposeSent={handleComposeSent}
        />
      )
    ) : null;

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar view={view} unreadCount={unreadCount} totpCount={totpCount} onChange={changeView} />

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2.5,
            py: 1.25,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          {accountsOpen ? (
            <Button size="small" onClick={() => setAccountsOpen(false)}>
              返回邮件
            </Button>
          ) : null}
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
            <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={() => void handleRefresh()}>
              刷新
            </Button>
            {view === 'mail' && !accountsOpen ? (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<EditNoteOutlinedIcon />}
                  onClick={() => openCompose(null)}
                >
                  写邮件
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
              </>
            ) : null}
          </Box>
        </Box>

        {showMigrationBanner ? (
          <Alert
            severity="info"
            sx={{ borderRadius: 0 }}
            action={
              <Button
                color="inherit"
                size="small"
                startIcon={<CloseIcon fontSize="small" />}
                onClick={() => void onUpdateSettings({ migrationNotice: '' })}
              >
                知道了
              </Button>
            }
          >
            {settings.migrationNotice}
          </Alert>
        ) : null}

        {bootError ? (
          <Alert severity="error" sx={{ mx: 3, mt: 2 }}>
            初始化失败：{bootError}
          </Alert>
        ) : null}

        <Box sx={{ flex: 1, minHeight: 0 }}>
          {mailContent}
          {view === 'authenticator' ? (
            <Authenticator onCopy={handleCopy} onChanged={() => void refreshTotpCount()} />
          ) : null}
          {view === 'settings' ? (
            <Settings
              settings={settings}
              appVersion={api.system.appVersion}
              platform={api.system.platform}
              onUpdate={onUpdateSettings}
              onRefresh={() => void handleRefresh()}
            />
          ) : null}
        </Box>
      </Box>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这封邮件？"
        description={`确定要删除「${pendingDelete?.subject ?? ''}」吗？服务器上的邮件也会一并删除。`}
        confirmLabel="删除"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
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
        <AppShell settings={settings} onUpdateSettings={handleUpdateSettings} reloadSettings={reloadSettings} />
      </ToastProvider>
    </ThemeProvider>
  );
}
