import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import type { AttachmentMeta } from '../../shared/types';
import { formatBytes } from '../format';

interface AttachmentListProps {
  attachments: AttachmentMeta[];
  /** `partId` currently being downloaded, to disable its button. */
  downloadingPartId: string | null;
  onDownload: (partId: string) => void;
}

/** Attachment list in the reading pane; bytes are fetched on demand. */
export function AttachmentList({
  attachments,
  downloadingPartId,
  onDownload,
}: AttachmentListProps): JSX.Element | null {
  if (attachments.length === 0) return null;

  return (
    <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        附件（{attachments.length}）
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {attachments.map((attachment) => (
          <Box
            key={attachment.partId}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}
          >
            <InsertDriveFileOutlinedIcon fontSize="small" color="action" />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" noWrap>
                {attachment.filename}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatBytes(attachment.size)} · {attachment.contentType}
              </Typography>
            </Box>
            <Button
              size="small"
              disabled={downloadingPartId === attachment.partId}
              onClick={() => onDownload(attachment.partId)}
            >
              {downloadingPartId === attachment.partId ? '下载中…' : '下载'}
            </Button>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
