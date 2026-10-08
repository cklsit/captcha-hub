import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';
import type { Draft } from '../../shared/types';
import { EmptyState } from './EmptyState';
import { formatRelative } from '../format';

interface DraftListProps {
  drafts: Draft[];
  accountName?: string;
  loading: boolean;
  onOpen: (draft: Draft) => void;
  onDelete: (draft: Draft) => void;
}

/** Middle pane for the drafts box: list of saved drafts with open/delete. */
export function DraftList({ drafts, accountName, loading, onOpen, onDelete }: DraftListProps): JSX.Element {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', borderRight: 1, borderColor: 'divider' }}>
      <Box sx={{ px: 1.5, pt: 1.5, pb: 1 }}>
        <Typography variant="subtitle2">草稿箱</Typography>
        <Typography variant="caption" color="text.secondary">
          {accountName ? `${accountName} · ` : ''}
          {drafts.length} 封草稿（仅保存在本机）
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {!loading && drafts.length === 0 ? (
          <EmptyState
            icon={<EditNoteOutlinedIcon />}
            title="没有草稿"
            description="写邮件时点击「存为草稿」，之后可以在这里继续编辑。"
          />
        ) : (
          drafts.map((draft) => (
            <Box
              key={draft.id}
              onClick={() => onOpen(draft)}
              sx={{
                px: 1.5,
                py: 1.25,
                cursor: 'pointer',
                borderBottom: 1,
                borderColor: 'divider',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1, fontWeight: 600 }}>
                  {draft.subject || '(无主题)'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {formatRelative(draft.updatedAt)}
                </Typography>
                <Tooltip title="删除草稿">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(draft);
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                收件人：{draft.to || '(未填写)'}
              </Typography>
              {draft.attachments.length > 0 ? (
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  含 {draft.attachments.length} 个附件
                </Typography>
              ) : null}
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
