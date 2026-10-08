import { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DraftsOutlinedIcon from '@mui/icons-material/DraftsOutlined';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import type { Folder, SafeAccount } from '../../shared/types';
import { DRAFTS_FOLDER, type MailSelection } from '../types';
import { FolderTree } from './FolderTree';

interface AccountNavProps {
  accounts: SafeAccount[];
  foldersByAccount: Record<string, Folder[]>;
  /** Number of locally-saved drafts per account id. */
  draftCounts: Record<string, number>;
  selection: MailSelection;
  onSelectAll: () => void;
  onSelectFolder: (accountId: string, folderId: string) => void;
  onSelectAccount: (accountId: string) => void;
  onSelectDrafts: (accountId: string) => void;
  onManage: () => void;
}

/** Sidebar account + folder tree for the mail view. */
export function AccountNav({
  accounts,
  foldersByAccount,
  draftCounts,
  selection,
  onSelectAll,
  onSelectFolder,
  onSelectAccount,
  onSelectDrafts,
  onManage,
}: AccountNavProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function toggle(accountId: string): void {
    setCollapsed((prev) => ({ ...prev, [accountId]: !prev[accountId] }));
  }

  function unreadFor(accountId: string): number {
    return (foldersByAccount[accountId] ?? []).reduce((sum, folder) => sum + folder.unreadCount, 0);
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', px: 1, pb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          账户与文件夹
        </Typography>
        <Tooltip title="管理账户">
          <IconButton size="small" onClick={onManage}>
            <SettingsOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="新增账户">
          <IconButton size="small" onClick={onManage}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box
        onClick={onSelectAll}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: 1,
          pr: 2,
          py: 0.75,
          cursor: 'pointer',
          borderRadius: 1,
          bgcolor: selection.accountId === 'all' ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <MailOutlineIcon fontSize="small" color={selection.accountId === 'all' ? 'primary' : 'action'} />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          全部邮件
        </Typography>
      </Box>

      {accounts.length === 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1, py: 1 }}>
          还没有账户。点击右上角的 + 添加一个邮箱账户。
        </Typography>
      ) : (
        accounts.map((account) => {
          const folders = foldersByAccount[account.id] ?? [];
          const isCollapsed = collapsed[account.id] ?? false;
          const unread = unreadFor(account.id);
          const active = selection.accountId === account.id;

          return (
            <Box key={account.id} sx={{ mt: 0.5 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  pl: 0.5,
                  pr: 1,
                  py: 0.5,
                  cursor: 'pointer',
                  borderRadius: 1,
                  bgcolor: active ? 'action.hover' : 'transparent',
                }}
                onClick={() => {
                  onSelectAccount(account.id);
                  toggle(account.id);
                }}
              >
                <IconButton size="small" onClick={(event) => { event.stopPropagation(); toggle(account.id); }}>
                  {isCollapsed ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
                </IconButton>
                <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1, fontWeight: active ? 600 : 500 }}>
                  {account.name}
                </Typography>
                {!account.enabled ? <Chip size="small" label="停用" sx={{ height: 16, fontSize: 10 }} /> : null}
                {unread > 0 ? <Chip size="small" color="primary" label={unread} sx={{ height: 16, fontSize: 10 }} /> : null}
              </Box>

              <Collapse in={!isCollapsed} timeout="auto" unmountOnExit>
                {(() => {
                  const draftsActive = active && selection.folderId === DRAFTS_FOLDER;
                  const draftCount = draftCounts[account.id] ?? 0;
                  return (
                    <Box
                      onClick={() => onSelectDrafts(account.id)}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        pl: 4,
                        pr: 2,
                        py: 0.5,
                        cursor: 'pointer',
                        borderRadius: 1,
                        bgcolor: draftsActive ? 'action.selected' : 'transparent',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <Box sx={{ color: draftsActive ? 'primary.main' : 'text.secondary', display: 'flex' }}>
                        <DraftsOutlinedIcon fontSize="small" />
                      </Box>
                      <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1, fontWeight: draftsActive ? 600 : 400 }}>
                        草稿箱
                      </Typography>
                      {draftCount > 0 ? (
                        <Chip size="small" variant="outlined" label={draftCount} sx={{ height: 16, fontSize: 10 }} />
                      ) : null}
                    </Box>
                  );
                })()}
                <FolderTree
                  folders={folders}
                  selectedFolderId={active && selection.folderId !== 'all' && selection.folderId !== DRAFTS_FOLDER ? selection.folderId : null}
                  onSelect={(folderId) => onSelectFolder(account.id, folderId)}
                />
              </Collapse>
            </Box>
          );
        })
      )}
    </Box>
  );
}
