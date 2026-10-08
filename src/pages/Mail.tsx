import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';
import type {
  BodyRenderMode,
  ComposePayload,
  Draft,
  Envelope,
  Folder,
  MailMessage,
  MessageFilter,
  SafeAccount,
} from '../../shared/types';
import type { MailSelection } from '../types';
import { AccountNav } from '../components/AccountNav';
import { ComposeWindow } from '../components/ComposeWindow';
import { DraftList } from '../components/DraftList';
import { MailList } from '../components/MailList';
import { MessageView } from '../components/MessageView';

interface MailProps {
  accounts: SafeAccount[];
  foldersByAccount: Record<string, Folder[]>;
  /** Number of locally-saved drafts per account id. */
  draftCounts: Record<string, number>;
  envelopes: Envelope[];
  accountsById: Record<string, string>;
  foldersById: Record<string, string>;
  selection: MailSelection;
  selectedMessage: MailMessage | null;
  /** Folders belonging to the account that owns the selected message. */
  messageFolders: Folder[];
  /** True when the drafts box is open instead of a server folder. */
  draftsMode: boolean;
  drafts: Draft[];
  draftAccountName?: string;
  loading: boolean;
  syncing: boolean;
  highlightIds: Set<string>;
  bodyMatchIds: Set<string>;
  filter: MessageFilter;
  bodyRenderMode: BodyRenderMode;
  allowRemoteImages: boolean;
  downloadingPartId: string | null;
  composeOpen: boolean;
  composeInitial: ComposePayload | null;
  onSelectAll: () => void;
  onSelectAccount: (accountId: string) => void;
  onSelectFolder: (accountId: string, folderId: string) => void;
  onSelectDrafts: (accountId: string) => void;
  onManageAccounts: () => void;
  onFilterChange: (patch: Partial<MessageFilter>) => void;
  onSelectEnvelope: (envelope: Envelope) => void;
  onCopy: (value: string) => void;
  onMarkAllRead: () => void;
  onReply: () => void;
  onForward: () => void;
  onDeleteSelected: () => void;
  onToggleSeen: (seen: boolean) => void;
  onMove: (folderId: string) => void;
  onDownloadAttachment: (partId: string) => void;
  onToggleExternalImages: (allow: boolean) => void;
  onOpenDraft: (draft: Draft) => void;
  onDeleteDraft: (draft: Draft) => void;
  /** Fired after a draft is persisted so the drafts box can refresh. */
  onDraftSaved: (draft: Draft) => void;
  onComposeClose: () => void;
  onComposeSent: () => void;
}

/**
 * The three-column mail workspace: account/folder tree | list | reading pane,
 * plus the compose modal. Purely presentational — all state lives in `App` so
 * that the sidebar badges and event subscriptions stay in one place.
 */
export function Mail(props: MailProps): JSX.Element {
  const {
    accounts,
    foldersByAccount,
    draftCounts,
    envelopes,
    accountsById,
    foldersById,
    selection,
    selectedMessage,
    messageFolders,
    draftsMode,
    drafts,
    draftAccountName,
    loading,
    syncing,
    highlightIds,
    bodyMatchIds,
    filter,
    bodyRenderMode,
    allowRemoteImages,
    downloadingPartId,
    composeOpen,
    composeInitial,
    onSelectAll,
    onSelectAccount,
    onSelectFolder,
    onSelectDrafts,
    onManageAccounts,
    onFilterChange,
    onSelectEnvelope,
    onCopy,
    onMarkAllRead,
    onReply,
    onForward,
    onDeleteSelected,
    onToggleSeen,
    onMove,
    onDownloadAttachment,
    onToggleExternalImages,
    onOpenDraft,
    onDeleteDraft,
    onDraftSaved,
    onComposeClose,
    onComposeSent,
  } = props;

  const selectedAccountName = selectedMessage
    ? accountsById[selectedMessage.envelope.accountId] ?? '账户'
    : '';

  return (
    <Box sx={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <Box
        sx={{
          width: 264,
          flexShrink: 0,
          height: '100%',
          overflowY: 'auto',
          borderRight: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <AccountNav
          accounts={accounts}
          foldersByAccount={foldersByAccount}
          draftCounts={draftCounts}
          selection={selection}
          onSelectAll={onSelectAll}
          onSelectAccount={onSelectAccount}
          onSelectFolder={onSelectFolder}
          onSelectDrafts={onSelectDrafts}
          onManage={onManageAccounts}
        />
      </Box>

      {draftsMode ? (
        <>
          <Box sx={{ width: 380, flexShrink: 0, height: '100%', minWidth: 0 }}>
            <DraftList
              drafts={drafts}
              accountName={draftAccountName}
              loading={loading}
              onOpen={onOpenDraft}
              onDelete={onDeleteDraft}
            />
          </Box>
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              color: 'text.secondary',
            }}
          >
            <EditNoteOutlinedIcon sx={{ fontSize: 48, opacity: 0.5 }} />
            <Typography variant="body2">点击左侧草稿继续编辑，或点击右上角「写邮件」新建一封</Typography>
          </Box>
        </>
      ) : (
        <>
          <Box sx={{ width: 380, flexShrink: 0, height: '100%', minWidth: 0 }}>
            <MailList
              envelopes={envelopes}
              accountsById={accountsById}
              foldersById={foldersById}
              selectedId={selectedMessage?.envelope.id ?? null}
              loading={loading}
              syncing={syncing}
              highlightIds={highlightIds}
              bodyMatchIds={bodyMatchIds}
              filter={filter}
              onFilterChange={onFilterChange}
              onSelect={onSelectEnvelope}
              onCopy={onCopy}
              onMarkAllRead={onMarkAllRead}
            />
          </Box>

          <Box sx={{ flex: 1, minWidth: 0, height: '100%' }}>
            <MessageView
              message={selectedMessage}
              accountName={selectedAccountName}
              folders={messageFolders}
              bodyRenderMode={bodyRenderMode}
              allowRemoteImages={allowRemoteImages}
              downloadingPartId={downloadingPartId}
              onToggleExternalImages={onToggleExternalImages}
              onReply={onReply}
              onForward={onForward}
              onDelete={onDeleteSelected}
              onToggleSeen={onToggleSeen}
              onMove={onMove}
              onCopy={onCopy}
              onDownloadAttachment={onDownloadAttachment}
            />
          </Box>
        </>
      )}

      <ComposeWindow
        open={composeOpen}
        initial={composeInitial}
        accounts={accounts}
        onClose={onComposeClose}
        onSent={onComposeSent}
        onDraftSaved={onDraftSaved}
      />
    </Box>
  );
}
