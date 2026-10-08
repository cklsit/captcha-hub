import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

interface CodeHighlightProps {
  text: string;
  /** The token to highlight (a verification code), if any. */
  token?: string | null;
  /** Called when the inline copy button is pressed. */
  onCopy?: (value: string) => void;
}

/**
 * Renders `text` with the verification-code token highlighted and an inline
 * one-click copy affordance — the surviving piece of the old "code card"
 * experience, now living inside the mail list and reader.
 */
export function CodeHighlight({ text, token, onCopy }: CodeHighlightProps): JSX.Element {
  if (!token || !text.includes(token)) return <>{text}</>;

  const segments = text.split(token);
  return (
    <>
      {segments.map((segment, index) => (
        <span key={index}>
          {segment}
          {index < segments.length - 1 ? (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', ml: 0.25 }}>
              <Chip
                size="small"
                color="primary"
                label={token}
                className="code-font"
                sx={{ height: 20, fontWeight: 700 }}
              />
              {onCopy ? (
                <Tooltip title="复制验证码">
                  <IconButton
                    size="small"
                    sx={{ ml: 0.25 }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCopy(token);
                    }}
                  >
                    <ContentCopyIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Box>
          ) : null}
        </span>
      ))}
    </>
  );
}
