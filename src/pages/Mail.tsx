import Box from '@mui/material/Box';
import type {
  BodyRenderMode,
  ComposePayload,
  Envelope,
  Folder,
  MailMessage,
  MessageFilter,
  SafeAccount,
} from '../../shared/types';
import type { MailSelection } from '../types';
import { AccountNav } from '../components/AccountNav';
import { ComposeWindow } from '../components/ComposeWindow';
import { MailList } from '../components/MailList';
import { MessageView } from '../components/MessageView';

interface MailProps {
  accounts: SafeAccount[];
  foldersByAccount: Record<string, Folder[]>;
  envelopes: Envelope[];
  accountsById: Record<string, string>;
  foldersById: Record<string, string>;
  selection: MailSelection;
  selectedMessage: MailMessage | null;
  /** Folders belonging to the account that owns the selected message. */
  messageFolders: Folder[];
  loading: boolean;
  syncing: boolean;
  highlightIds: Set<string>;
  filter: MessageFilter;
  bodyRenderMode: BodyRenderMode;
  allowRemoteImages: boolean;
  downloadingPartId: string | null;
  composeOpen: boolean;
  composeInitial: ComposePayload | null;
  onSelectAll: () => void;
  onSelectAccount: (accountId: string) => void;
  onSelectFolder: (accountId: string, folderId: string) => void;
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
    envelopes,
    accountsById,
    foldersById,
    selection,
    selectedMessage,
    messageFolders,
    loading,
    syncing,
    highlightIds,
    filter,
    bodyRenderMode,
    allowRemoteImages,
    downloadingPartId,
    composeOpen,
    composeInitial,
    onSelectAll,
    onSelectAccount,
    onSelectFolder,
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
          selection={selection}
          onSelectAll={onSelectAll}
          onSelectAccount={onSelectAccount}
          onSelectFolder={onSelectFolder}
          onManage={onManageAccounts}
        />
      </Box>

      <Box sx={{ width: 380, flexShrink: 0, height: '100%', minWidth: 0 }}>
        <MailList
          envelopes={envelopes}
          accountsById={accountsById}
          foldersById={foldersById}
          selectedId={selectedMessage?.envelope.id ?? null}
          loading={loading}
          syncing={syncing}
          highlightIds={highlightIds}
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

      <ComposeWindow
        open={composeOpen}
        initial={composeInitial}
        accounts={accounts}
        onClose={onComposeClose}
        onSent={onComposeSent}
      />
    </Box>
  );
}
