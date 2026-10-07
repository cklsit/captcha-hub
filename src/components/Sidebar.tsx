import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import InboxIcon from '@mui/icons-material/Inbox';
import MarkunreadMailboxOutlinedIcon from '@mui/icons-material/MarkunreadMailboxOutlined';
import LockClockOutlinedIcon from '@mui/icons-material/LockClockOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import type { ViewKey } from '../types';

interface SidebarProps {
  view: ViewKey;
  unreadCount: number;
  sourceCount: number;
  totpCount: number;
  onChange: (view: ViewKey) => void;
}

interface NavItem {
  key: ViewKey;
  label: string;
  hint: string;
  icon: JSX.Element;
  badge?: number;
}

/** Left navigation rail. */
export function Sidebar({
  view,
  unreadCount,
  sourceCount,
  totpCount,
  onChange,
}: SidebarProps): JSX.Element {
  const items: NavItem[] = [
    { key: 'inbox', label: '统一收件箱', hint: '所有验证码时间线', icon: <InboxIcon />, badge: unreadCount },
    { key: 'sources', label: '来源管理', hint: `${sourceCount} 个来源`, icon: <MarkunreadMailboxOutlinedIcon /> },
    { key: 'authenticator', label: '验证器', hint: `${totpCount} 个密钥`, icon: <LockClockOutlinedIcon /> },
    { key: 'settings', label: '设置', hint: '隐私与偏好', icon: <SettingsOutlinedIcon /> },
  ];

  return (
    <Box
      sx={{
        width: 244,
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ px: 3, py: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ShieldOutlinedIcon color="primary" />
          <Typography variant="h6" sx={{ fontSize: 18 }}>
            验证码收件箱
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Captcha Hub · 本地优先
        </Typography>
      </Box>
      <Divider />
      <List sx={{ px: 1.5, py: 1.5, flex: 1 }}>
        {items.map((item) => (
          <ListItemButton
            key={item.key}
            selected={view === item.key}
            onClick={() => onChange(item.key)}
            sx={{ borderRadius: 2, mb: 0.5 }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>
              {item.badge && item.badge > 0 ? (
                <Badge badgeContent={item.badge} color="primary" max={99}>
                  {item.icon}
                </Badge>
              ) : (
                item.icon
              )}
            </ListItemIcon>
            <ListItemText
              primary={item.label}
              secondary={item.hint}
              primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }}
              secondaryTypographyProps={{ fontSize: 11 }}
            />
          </ListItemButton>
        ))}
      </List>
      <Divider />
      <Box sx={{ px: 3, py: 2 }}>
        <Typography variant="caption" color="text.secondary">
          仅用于管理你本人拥有或有权使用的验证码来源。数据全部保存在本机，不会上传。
        </Typography>
      </Box>
    </Box>
  );
}
