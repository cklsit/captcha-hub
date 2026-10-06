import { createTheme, type Theme } from '@mui/material/styles';
import type { ThemeMode } from '../shared/types';

/** Builds the MUI theme for the requested color mode. */
export function buildTheme(mode: ThemeMode): Theme {
  const isDark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary: { main: '#5b8cff' },
      secondary: { main: '#a78bfa' },
      success: { main: '#34d399' },
      warning: { main: '#fbbf24' },
      error: { main: '#f87171' },
      background: {
        default: isDark ? '#0f1115' : '#f4f5fa',
        paper: isDark ? '#161a22' : '#ffffff',
      },
      divider: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(15,23,42,0.10)',
      text: {
        primary: isDark ? '#e6ebf5' : '#0f172a',
        secondary: isDark ? '#93a1b8' : '#526077',
      },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily:
        "'Segoe UI', 'Microsoft YaHei', system-ui, -apple-system, BlinkMacSystemFont, Roboto, sans-serif",
      h6: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${isDark ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.08)'}`,
          },
        },
      },
      MuiTooltip: {
        defaultProps: { arrow: true },
      },
    },
  });
}
