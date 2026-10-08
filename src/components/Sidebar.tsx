import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import LockClockOutlinedIcon from '@mui/icons-material/LockClockOutlined';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import type { ViewKey } from '../types';

interface SidebarProps {
  view: ViewKey;
  unreadCount: number;
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

/** Left navigation rail: 邮件 / 验证器 / 设置. */
export function Sidebar({ view, unreadCount, totpCount, onChange }: SidebarProps): JSX.Element {
  const items: NavItem[] = [
    { key: 'mail', label: '邮件', hint: '收件箱与账户', icon: <MailOutlineIcon />, badge: unreadCount },
    { key: 'authenticator', label: '验证器', hint: `${totpCount} 个密钥`, icon: <LockClockOutlinedIcon /> },
    { key: 'settings', label: '设置', hint: '隐私与偏好', icon: <SettingsOutlinedIcon /> },
  ];

  return (
    <Box
      sx={{
        width: 200,
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ px: 2.5, py: 2.5 }}>
        <Typography variant="h6" sx={{ fontSize: 18 }}>
          邮件中心
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Mail Hub · 本地优先
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
      <Box sx={{ px: 2.5, py: 2 }}>
        <Typography variant="caption" color="text.secondary">
          仅用于管理你本人拥有或有权使用的邮箱账户。邮件与密钥全部保存在本机，不会上传。
        </Typography>
      </Box>
    </Box>
  );
}
