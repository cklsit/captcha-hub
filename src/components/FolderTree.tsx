import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DraftsOutlinedIcon from '@mui/icons-material/DraftsOutlined';
import type { Folder } from '../../shared/types';

interface FolderTreeProps {
  folders: Folder[];
  /** Currently selected folder *path* for this account, or null. */
  selectedFolderId: string | null;
  onSelect: (folderId: string) => void;
}

function iconFor(folder: Folder): JSX.Element {
  const special = folder.specialUse.toLowerCase();
  const name = folder.name.toLowerCase();
  if (special.includes('sent') || name.includes('sent') || name.includes('已发送')) return <SendOutlinedIcon fontSize="small" />;
  if (special.includes('trash') || name.includes('trash') || name.includes('垃圾') || name.includes('删除')) return <DeleteOutlineIcon fontSize="small" />;
  if (special.includes('draft') || name.includes('draft') || name.includes('草稿')) return <DraftsOutlinedIcon fontSize="small" />;
  if (special.includes('inbox') || name === 'inbox' || name.includes('收件')) return <InboxOutlinedIcon fontSize="small" />;
  return <FolderOutlinedIcon fontSize="small" />;
}

/** The folder tree for a single account, with unread badges. */
export function FolderTree({ folders, selectedFolderId, onSelect }: FolderTreeProps): JSX.Element {
  if (folders.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ pl: 4, py: 0.5, display: 'block' }}>
        同步后显示文件夹
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {folders.map((folder) => {
        const selected = selectedFolderId === folder.path;
        return (
          <Box
            key={folder.id}
            onClick={() => onSelect(folder.path)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              pl: 4,
              pr: 2,
              py: 0.5,
              cursor: 'pointer',
              borderRadius: 1,
              bgcolor: selected ? 'action.selected' : 'transparent',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Box sx={{ color: selected ? 'primary.main' : 'text.secondary', display: 'flex' }}>
              {iconFor(folder)}
            </Box>
            <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1, fontWeight: selected ? 600 : 400 }}>
              {folder.name}
            </Typography>
            {folder.unreadCount > 0 ? (
              <Badge badgeContent={folder.unreadCount} color="primary" max={99} sx={{ mr: 0.5 }}>
                <Box sx={{ width: 4 }} />
              </Badge>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
