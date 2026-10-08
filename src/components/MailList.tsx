import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import SearchIcon from '@mui/icons-material/Search';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import type { Envelope, MessageFilter } from '../../shared/types';
import { MailListItem } from './MailListItem';
import { EmptyState } from './EmptyState';

interface MailListProps {
  envelopes: Envelope[];
  accountsById: Record<string, string>;
  foldersById: Record<string, string>;
  selectedId: string | null;
  loading: boolean;
  syncing: boolean;
  highlightIds: Set<string>;
  filter: MessageFilter;
  onFilterChange: (patch: Partial<MessageFilter>) => void;
  onSelect: (envelope: Envelope) => void;
  onCopy: (value: string) => void;
  onMarkAllRead: () => void;
}

type QuickFilter = 'all' | 'unread' | 'attachments' | 'captcha';

/** Middle pane: search box + quick filters + the scrolling mail list. */
export function MailList({
  envelopes,
  accountsById,
  foldersById,
  selectedId,
  loading,
  syncing,
  highlightIds,
  filter,
  onFilterChange,
  onSelect,
  onCopy,
  onMarkAllRead,
}: MailListProps): JSX.Element {
  const [search, setSearch] = useState(filter.search ?? '');

  // Debounce the search box so typing does not fire a query per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((filter.search ?? '') !== search) onFilterChange({ search });
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const quick: QuickFilter =
    filter.captchaOnly ? 'captcha' : filter.hasAttachments ? 'attachments' : filter.unreadOnly ? 'unread' : 'all';

  function applyQuick(next: QuickFilter): void {
    onFilterChange({
      unreadOnly: next === 'unread',
      hasAttachments: next === 'attachments',
      captchaOnly: next === 'captcha',
    });
  }

  const unreadCount = envelopes.filter((envelope) => !envelope.flags.seen).length;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', borderRight: 1, borderColor: 'divider' }}>
      <Box sx={{ px: 1.5, pt: 1.5, pb: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="搜索发件人 / 主题 / 摘要"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
          <Chip size="small" label={`共 ${envelopes.length}`} />
          {unreadCount > 0 ? <Chip size="small" color="primary" label={`未读 ${unreadCount}`} /> : null}
          <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
            {(
              [
                ['all', '全部'],
                ['unread', '未读'],
                ['attachments', '有附件'],
                ['captcha', '验证码'],
              ] as Array<[QuickFilter, string]>
            ).map(([key, label]) => (
              <Button
                key={key}
                size="small"
                variant={quick === key ? 'contained' : 'outlined'}
                onClick={() => applyQuick(key)}
                sx={{ minWidth: 0, px: 1 }}
              >
                {label}
              </Button>
            ))}
          </Box>
        </Box>
      </Box>

      {loading || syncing ? <LinearProgress /> : null}

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {!loading && envelopes.length === 0 ? (
          <EmptyState
            icon={<InboxOutlinedIcon />}
            title="这里还没有邮件"
            description="添加一个邮箱账户并同步后，收到的邮件会显示在这里。"
          />
        ) : (
          envelopes.map((envelope) => (
            <MailListItem
              key={envelope.id}
              envelope={envelope}
              accountName={accountsById[envelope.accountId] ?? '账户'}
              folderName={foldersById[envelope.folderId] ?? ''}
              selected={envelope.id === selectedId}
              highlighted={highlightIds.has(envelope.id)}
              onSelect={onSelect}
              onCopy={onCopy}
            />
          ))
        )}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 1, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">
          仅本地保存，不会上传
        </Typography>
        <Button
          size="small"
          startIcon={<DoneAllIcon />}
          sx={{ ml: 'auto' }}
          disabled={envelopes.length === 0}
          onClick={onMarkAllRead}
        >
          全部已读
        </Button>
      </Box>
    </Box>
  );
}
