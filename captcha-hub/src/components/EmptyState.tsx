import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

/** Shared empty / placeholder state used across pages. */
export function EmptyState({ icon, title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 1.5,
        py: 8,
        px: 3,
        color: 'text.secondary',
      }}
    >
      {icon ? <Box sx={{ opacity: 0.5, '& svg': { fontSize: 56 } }}>{icon}</Box> : null}
      <Typography variant="h6" color="text.primary">
        {title}
      </Typography>
      {description ? (
        <Typography variant="body2" sx={{ maxWidth: 460 }}>
          {description}
        </Typography>
      ) : null}
      {action}
    </Box>
  );
}
