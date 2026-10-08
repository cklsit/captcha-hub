import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import type { TotpDisplay } from '../../shared/types';

interface TotpCardProps {
  data: TotpDisplay;
  onCopy: (text: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

const RING_SIZE = 44;
const RING_THICKNESS = 4;

/**
 * Countdown ring.
 *
 * A determinate `CircularProgress` paints only the progress arc, so at 70% of
 * the period it renders as a broken circle rather than a reading of "how much
 * time is left". Stacking a value-100 ring underneath supplies the missing
 * track, which is what makes it legible as a countdown.
 */
function CountdownRing({
  value,
  isExpiringSoon,
}: {
  value: number;
  isExpiringSoon: boolean;
}): JSX.Element {
  return (
    <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <CircularProgress
        variant="determinate"
        value={100}
        size={RING_SIZE}
        thickness={RING_THICKNESS}
        sx={{ color: 'action.disabledBackground', position: 'absolute', top: 0, left: 0 }}
      />
      <CircularProgress
        variant="determinate"
        value={value}
        size={RING_SIZE}
        thickness={RING_THICKNESS}
        color={isExpiringSoon ? 'error' : 'primary'}
      />
    </Box>
  );
}

/** Live TOTP card: shows the current code with a circular countdown ring. */
export function TotpCard({ data, onCopy, onEdit, onDelete }: TotpCardProps): JSX.Element {
  const ringValue = Math.round(data.progress * 100);
  const isExpiringSoon = data.remaining <= 5;

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle1" noWrap>
              {data.issuer || data.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {data.account || data.name}
            </Typography>
          </Box>
          <CountdownRing value={ringValue} isExpiringSoon={isExpiringSoon} />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography className="code-font" sx={{ fontSize: 28, fontWeight: 700, lineHeight: 1.2 }}>
            {data.code}
          </Typography>
          <Tooltip title="复制验证码">
            <IconButton
              size="small"
              color="primary"
              onClick={() => onCopy(data.code)}
              aria-label="复制验证码"
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {/*
          The actions live in the footer instead of floating over the card: the
          old absolutely-positioned overlay sat at exactly the same top-right
          corner as the countdown ring, so the two drew on top of each other.
        */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 'auto' }}>
          <Typography variant="caption" color={isExpiringSoon ? 'error.main' : 'text.secondary'}>
            {data.remaining} 秒后刷新 · 周期 {data.period}s
          </Typography>
          <Box sx={{ ml: 'auto', display: 'flex', gap: 0.25 }}>
            {onEdit ? (
              <Tooltip title="编辑">
                <IconButton size="small" onClick={onEdit} aria-label="编辑验证器">
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            {onDelete ? (
              <Tooltip title="删除">
                <IconButton size="small" color="error" onClick={onDelete} aria-label="删除验证器">
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
