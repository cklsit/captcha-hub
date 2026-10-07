import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { TotpDisplay } from '../../shared/types';

interface TotpCardProps {
  data: TotpDisplay;
  onCopy: (text: string) => void;
}

/** Live TOTP card: shows the current code with a circular countdown ring. */
export function TotpCard({ data, onCopy }: TotpCardProps): JSX.Element {
  const ringValue = Math.round(data.progress * 100);
  const isExpiringSoon = data.remaining <= 5;

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle1" noWrap>
              {data.issuer || data.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {data.account || data.name}
            </Typography>
          </Box>
          <CircularProgress
            variant="determinate"
            value={ringValue}
            size={40}
            thickness={4}
            color={isExpiringSoon ? 'error' : 'primary'}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography className="code-font" sx={{ fontSize: 28, fontWeight: 700, lineHeight: 1.2 }}>
            {data.code}
          </Typography>
          <Tooltip title="复制验证码">
            <IconButton size="small" color="primary" onClick={() => onCopy(data.code)}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        <Typography variant="caption" color={isExpiringSoon ? 'error.main' : 'text.secondary'}>
          {data.remaining} 秒后刷新 · 周期 {data.period}s
        </Typography>
      </CardContent>
    </Card>
  );
}
