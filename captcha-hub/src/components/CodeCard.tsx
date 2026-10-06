import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DraftsOutlinedIcon from '@mui/icons-material/DraftsOutlined';
import MarkEmailReadOutlinedIcon from '@mui/icons-material/MarkEmailReadOutlined';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import PhoneIphoneOutlinedIcon from '@mui/icons-material/PhoneIphoneOutlined';
import LockClockOutlinedIcon from '@mui/icons-material/LockClockOutlined';
import type { CaptchaMessage, SourceKind } from '../../shared/types';
import { KIND_META } from '../constants';
import { formatClock, formatCountdown, formatRelative } from '../format';

interface CodeCardProps {
  message: CaptchaMessage;
  highlighted: boolean;
  onToggleRead: (id: string, read: boolean) => void;
  onDelete: (id: string) => void;
  onCopy: (text: string) => void;
}

function KindIcon({ kind }: { kind: SourceKind }): JSX.Element {
  if (kind === 'phone') return <PhoneIphoneOutlinedIcon fontSize="small" />;
  if (kind === 'totp') return <LockClockOutlinedIcon fontSize="small" />;
  return <EmailOutlinedIcon fontSize="small" />;
}

/** Single verification-code card in the unified inbox timeline. */
export function CodeCard({
  message,
  highlighted,
  onToggleRead,
  onDelete,
  onCopy,
}: CodeCardProps): JSX.Element {
  const meta = KIND_META[message.sourceKind];
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!message.expiresAtHint) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [message.expiresAtHint]);

  const remainingSeconds = message.expiresAtHint
    ? Math.max(0, Math.round((message.expiresAtHint - now) / 1000))
    : null;
  const confidencePercent = Math.round(message.confidence * 100);

  return (
    <Card
      className={highlighted ? 'animate-highlight-pulse' : 'animate-slide-in'}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderLeft: `4px solid ${meta.color}`,
        opacity: message.read ? 0.72 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Chip
            size="small"
            icon={<KindIcon kind={message.sourceKind} />}
            label={message.sourceName}
            sx={{ bgcolor: `${meta.color}22`, color: meta.color, fontWeight: 600 }}
          />
          {!message.read ? (
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main' }} />
          ) : null}
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            {formatRelative(message.receivedAt)} · {formatClock(message.receivedAt)}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography className="code-font" sx={{ fontSize: 30, fontWeight: 700, lineHeight: 1.2 }}>
            {message.code}
          </Typography>
          <Tooltip title="复制验证码">
            <IconButton size="small" color="primary" onClick={() => onCopy(message.code)}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {message.matchedKeyword ? (
            <Chip
              size="small"
              variant="outlined"
              label={`命中：${message.matchedKeyword}`}
              sx={{ ml: 0.5 }}
            />
          ) : null}
        </Box>

        <Typography variant="subtitle2" sx={{ mt: 1 }} noWrap>
          {message.subject}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {message.from}
        </Typography>

        {message.summary ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mt: 1,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {message.summary}
          </Typography>
        ) : null}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.5 }}>
          <Tooltip title={`提取置信度 ${confidencePercent}%`}>
            <Box sx={{ width: 90 }}>
              <LinearProgress
                variant="determinate"
                value={confidencePercent}
                color={confidencePercent >= 70 ? 'success' : 'warning'}
                sx={{ height: 6, borderRadius: 3 }}
              />
            </Box>
          </Tooltip>
          <Typography variant="caption" color="text.secondary">
            置信度 {confidencePercent}%
          </Typography>
          {remainingSeconds !== null ? (
            <Typography
              variant="caption"
              color={remainingSeconds > 0 ? 'warning.main' : 'error.main'}
            >
              {remainingSeconds > 0 ? `有效期约剩 ${formatCountdown(remainingSeconds)}` : '有效期可能已过'}
            </Typography>
          ) : null}

          <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
            <Tooltip title={message.read ? '标记为未读' : '标记为已读'}>
              <IconButton
                size="small"
                onClick={() => onToggleRead(message.id, !message.read)}
              >
                {message.read ? <DraftsOutlinedIcon fontSize="small" /> : <MarkEmailReadOutlinedIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Tooltip title="删除">
              <IconButton size="small" color="error" onClick={() => onDelete(message.id)}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
