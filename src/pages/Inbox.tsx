import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import type { CaptchaMessage, SafeSource, SourceKind } from '../../shared/types';
import { CodeCard } from '../components/CodeCard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { RECENT_WINDOW_MS } from '../constants';

type KindFilter = SourceKind | 'all';
type WindowFilter = 'all' | '5m' | '1h' | 'today';

interface InboxProps {
  messages: CaptchaMessage[];
  sources: SafeSource[];
  highlightIds: Set<string>;
  loading: boolean;
  pinRecent: boolean;
  onToggleRead: (id: string, read: boolean) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onMarkAllRead: () => void;
  onCopy: (text: string) => void;
}

function windowStart(filter: WindowFilter, now: number): number {
  switch (filter) {
    case '5m':
      return now - 5 * 60 * 1000;
    case '1h':
      return now - 60 * 60 * 1000;
    case 'today': {
      const date = new Date(now);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }
    default:
      return 0;
  }
}

/** The unified inbox: one timeline for every source, with filters and search. */
export function Inbox({
  messages,
  sources,
  highlightIds,
  loading,
  pinRecent,
  onToggleRead,
  onDelete,
  onClear,
  onMarkAllRead,
  onCopy,
}: InboxProps): JSX.Element {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [sourceId, setSourceId] = useState<string>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [windowFilter, setWindowFilter] = useState<WindowFilter>('all');
  const [now, setNow] = useState(() => Date.now());
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    const minTime = windowStart(windowFilter, now);
    const query = search.trim().toLowerCase();
    return messages.filter((message) => {
      if (kind !== 'all' && message.sourceKind !== kind) return false;
      if (sourceId !== 'all' && message.sourceId !== sourceId) return false;
      if (unreadOnly && message.read) return false;
      if (message.receivedAt < minTime) return false;
      if (query) {
        const haystack = `${message.code} ${message.subject} ${message.from} ${message.summary} ${message.sourceName}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [messages, kind, sourceId, unreadOnly, windowFilter, search, now]);

  const ordered = useMemo(() => {
    if (!pinRecent) return filtered;
    const recentCutoff = now - RECENT_WINDOW_MS;
    const recent = filtered.filter((message) => message.receivedAt >= recentCutoff);
    const rest = filtered.filter((message) => message.receivedAt < recentCutoff);
    return [...recent, ...rest];
  }, [filtered, pinRecent, now]);

  const unreadCount = messages.filter((message) => !message.read).length;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Stack spacing={1.5} sx={{ px: 3, pt: 3, pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6">统一收件箱</Typography>
          <Chip size="small" label={`共 ${messages.length} 条`} />
          {unreadCount > 0 ? <Chip size="small" color="primary" label={`未读 ${unreadCount}`} /> : null}
          <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
            <Button
              size="small"
              startIcon={<DoneAllIcon />}
              onClick={onMarkAllRead}
              disabled={unreadCount === 0}
            >
              全部已读
            </Button>
            <Button
              size="small"
              color="error"
              startIcon={<ClearAllIcon />}
              onClick={() => setConfirmClear(true)}
              disabled={messages.length === 0}
            >
              清空
            </Button>
          </Box>
        </Box>

        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
          <TextField
            size="small"
            placeholder="搜索验证码 / 关键词 / 发件人"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ minWidth: 260, flex: 1 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <TextField
            select
            size="small"
            label="类型"
            value={kind}
            onChange={(event) => setKind(event.target.value as KindFilter)}
            sx={{ width: 130 }}
          >
            <MenuItem value="all">全部</MenuItem>
            <MenuItem value="email">邮箱</MenuItem>
            <MenuItem value="phone">手机号</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="来源"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            sx={{ width: 180 }}
          >
            <MenuItem value="all">全部来源</MenuItem>
            {sources.map((source) => (
              <MenuItem key={source.id} value={source.id}>
                {source.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="时间"
            value={windowFilter}
            onChange={(event) => setWindowFilter(event.target.value as WindowFilter)}
            sx={{ width: 130 }}
          >
            <MenuItem value="all">全部时间</MenuItem>
            <MenuItem value="5m">最近 5 分钟</MenuItem>
            <MenuItem value="1h">最近 1 小时</MenuItem>
            <MenuItem value="today">今天</MenuItem>
          </TextField>
          <Tooltip title="只看未读">
            <Button
              size="small"
              variant={unreadOnly ? 'contained' : 'outlined'}
              onClick={() => setUnreadOnly((value) => !value)}
            >
              只看未读
            </Button>
          </Tooltip>
        </Stack>
      </Stack>

      {loading ? <LinearProgress sx={{ mx: 3 }} /> : null}

      <Box sx={{ flex: 1, overflowY: 'auto', px: 3, pb: 3 }}>
        {!loading && ordered.length === 0 ? (
          <EmptyState
            icon={<InboxOutlinedIcon />}
            title={messages.length === 0 ? '还没有收到任何验证码' : '没有符合筛选条件的验证码'}
            description={
              messages.length === 0
                ? '先在“来源管理”里添加一个邮箱来源（用于接收短信转发邮件），或添加 TOTP 验证器。到达的验证码会自动出现在这里。'
                : '尝试调整搜索关键词或筛选条件。'
            }
          />
        ) : (
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {ordered.map((message) => (
              <CodeCard
                key={message.id}
                message={message}
                highlighted={highlightIds.has(message.id)}
                onToggleRead={onToggleRead}
                onDelete={onDelete}
                onCopy={onCopy}
              />
            ))}
          </Stack>
        )}
      </Box>

      <ConfirmDialog
        open={confirmClear}
        title="清空全部验证码记录？"
        description="此操作会删除本机保存的所有验证码消息记录，且不可撤销。来源配置不会被删除。"
        confirmLabel="清空"
        danger
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          onClear();
        }}
      />
    </Box>
  );
}
