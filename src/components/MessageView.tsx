import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ForwardOutlinedIcon from '@mui/icons-material/ForwardOutlined';
import MarkEmailReadOutlinedIcon from '@mui/icons-material/MarkEmailReadOutlined';
import MarkunreadOutlinedIcon from '@mui/icons-material/MarkunreadOutlined';
import ReplyOutlinedIcon from '@mui/icons-material/ReplyOutlined';
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import type { BodyRenderMode, Folder, MailMessage } from '../../shared/types';
import { AttachmentList } from './AttachmentList';
import { buildIframeSrcDoc } from '../html';
import { formatFullDate } from '../format';

interface MessageViewProps {
  message: MailMessage | null;
  accountName: string;
  folders: Folder[];
  bodyRenderMode: BodyRenderMode;
  allowRemoteImages: boolean;
  downloadingPartId: string | null;
  onToggleExternalImages: (allow: boolean) => void;
  onReply: () => void;
  onForward: () => void;
  onDelete: () => void;
  onToggleSeen: (seen: boolean) => void;
  onMove: (folderId: string) => void;
  onCopy: (value: string) => void;
  onDownloadAttachment: (partId: string) => void;
}

/** Right pane: header, action bar, code highlight, sandboxed body and attachments. */
export function MessageView({
  message,
  accountName,
  folders,
  bodyRenderMode,
  allowRemoteImages,
  downloadingPartId,
  onToggleExternalImages,
  onReply,
  onForward,
  onDelete,
  onToggleSeen,
  onMove,
  onCopy,
  onDownloadAttachment,
}: MessageViewProps): JSX.Element {
  const [moveAnchor, setMoveAnchor] = useState<HTMLElement | null>(null);

  if (!message) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'text.secondary',
          gap: 1,
        }}
      >
        <MailOutlineIcon sx={{ fontSize: 48, opacity: 0.5 }} />
        <Typography variant="body2">选择左侧的一封邮件以阅读</Typography>
      </Box>
    );
  }

  const { envelope } = message;
  const code = envelope.highlight?.code ?? null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <Box sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Typography variant="h6" sx={{ minWidth: 0, flex: 1, wordBreak: 'break-word' }}>
            {envelope.subject || '(无主题)'}
          </Typography>
          {code ? (
            <Chip
              color="primary"
              className="code-font"
              label={code}
              onDelete={() => onCopy(code)}
              deleteIcon={<ContentCopyIcon />}
            />
          ) : null}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {envelope.from || '(未知发件人)'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          收件人：{envelope.to || '（你）'} · {accountName} · {formatFullDate(envelope.receivedAt)}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Button size="small" startIcon={<ReplyOutlinedIcon />} onClick={onReply}>
          回复
        </Button>
        <Button size="small" startIcon={<ForwardOutlinedIcon />} onClick={onForward}>
          转发
        </Button>
        <Tooltip title={envelope.flags.seen ? '标记为未读' : '标记为已读'}>
          <IconButton size="small" onClick={() => onToggleSeen(!envelope.flags.seen)}>
            {envelope.flags.seen ? <MarkunreadOutlinedIcon fontSize="small" /> : <MarkEmailReadOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="移动到…">
          <IconButton size="small" onClick={(event) => setMoveAnchor(event.currentTarget)}>
            <DriveFileMoveOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="删除">
          <IconButton size="small" color="error" onClick={onDelete} sx={{ ml: 'auto' }}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {bodyRenderMode === 'html' ? (
        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Button size="small" onClick={() => onToggleExternalImages(!allowRemoteImages)}>
            {allowRemoteImages ? '隐藏外部图片' : '显示外部图片'}
          </Button>
        </Box>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2, py: 1.5 }}>
        {bodyRenderMode === 'html' && message.bodyHtml ? (
          <Box
            component="iframe"
            title="邮件正文"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={buildIframeSrcDoc(message.bodyHtml, { allowRemoteImages })}
            sx={{ width: '100%', height: '100%', minHeight: 320, border: 0, bgcolor: 'background.paper', borderRadius: 1 }}
          />
        ) : (
          <Typography component="pre" variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
            {message.bodyText || '(无正文)'}
          </Typography>
        )}

        <AttachmentList
          attachments={envelope.attachments}
          downloadingPartId={downloadingPartId}
          onDownload={onDownloadAttachment}
        />
      </Box>

      <Menu anchorEl={moveAnchor} open={Boolean(moveAnchor)} onClose={() => setMoveAnchor(null)}>
        {folders.length === 0 ? (
          <MenuItem disabled>没有可用的文件夹</MenuItem>
        ) : (
          folders.map((folder) => (
            <MenuItem
              key={folder.id}
              onClick={() => {
                setMoveAnchor(null);
                onMove(folder.id);
              }}
            >
              {folder.name}
            </MenuItem>
          ))
        )}
      </Menu>
    </Box>
  );
}
