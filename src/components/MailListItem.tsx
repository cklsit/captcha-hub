import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined';
import MarkunreadMailboxOutlinedIcon from '@mui/icons-material/MarkunreadMailboxOutlined';
import type { Envelope } from '../../shared/types';
import { CodeHighlight } from './CodeHighlight';
import { formatListTime } from '../format';

interface MailListItemProps {
  envelope: Envelope;
  accountName: string;
  folderName: string;
  selected: boolean;
  /** Newly-arrived highlight pulse. */
  highlighted: boolean;
  /** True when this row only matched because of a body-text search hit. */
  bodyMatch: boolean;
  onSelect: (envelope: Envelope) => void;
  onCopy: (value: string) => void;
}

/** One row in the mail list: unread dot, sender, subject (code highlighted), snippet, time, marks. */
export function MailListItem({
  envelope,
  accountName,
  folderName,
  selected,
  highlighted,
  bodyMatch,
  onSelect,
  onCopy,
}: MailListItemProps): JSX.Element {
  const unread = !envelope.flags.seen;

  return (
    <Box
      onClick={() => onSelect(envelope)}
      className={highlighted ? 'animate-highlight-pulse' : undefined}
      sx={{
        px: 1.5,
        py: 1.25,
        cursor: 'pointer',
        borderLeft: '3px solid',
        borderLeftColor: selected ? 'primary.main' : 'transparent',
        bgcolor: selected ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: 'action.hover' },
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {unread ? (
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }} />
        ) : (
          <Box sx={{ width: 8, height: 8, flexShrink: 0 }} />
        )}
        <Typography
          variant="body2"
          noWrap
          sx={{ fontWeight: unread ? 700 : 500, minWidth: 0, flex: 1 }}
        >
          {envelope.from || '(未知发件人)'}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {formatListTime(envelope.receivedAt)}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, pl: 1.5 }}>
        <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1, fontWeight: unread ? 600 : 400 }}>
          <CodeHighlight text={envelope.subject || '(无主题)'} token={envelope.highlight?.code ?? null} onCopy={onCopy} />
        </Typography>
        {envelope.hasAttachments ? (
          <Tooltip title="含附件">
            <AttachFileOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
          </Tooltip>
        ) : null}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 1.5, mt: 0.25 }}>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, flex: 1 }}>
          {envelope.snippet || '(无内容)'}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 1.5, mt: 0.5 }}>
        <Chip size="small" variant="outlined" label={accountName} sx={{ height: 18, fontSize: 10 }} />
        {folderName ? (
          <Chip size="small" variant="outlined" label={folderName} sx={{ height: 18, fontSize: 10 }} />
        ) : null}
        {bodyMatch ? <Chip size="small" label="正文匹配" sx={{ height: 18, fontSize: 10 }} /> : null}
        {envelope.highlight ? (
          <Chip
            size="small"
            color="primary"
            icon={<MarkunreadMailboxOutlinedIcon sx={{ fontSize: 12 }} />}
            label={envelope.highlight.code}
            className="code-font"
            sx={{ height: 18, fontSize: 10 }}
          />
        ) : null}
      </Box>
    </Box>
  );
}
