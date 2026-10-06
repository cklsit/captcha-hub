import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';

/** Lightweight toast system (no extra dependency) providing copy feedback etc. */

export type ToastSeverity = 'success' | 'error' | 'info' | 'warning';
export type PushToast = (message: string, severity?: ToastSeverity) => void;

const ToastContext = createContext<PushToast>(() => undefined);

interface ToastItem {
  id: number;
  message: string;
  severity: ToastSeverity;
}

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback<PushToast>((message, severity = 'success') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-3), { id, message, severity }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 2800);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {items.map((item, index) => (
        <Snackbar
          key={item.id}
          open
          autoHideDuration={2600}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          style={{ bottom: 20 + index * 62 }}
          onClose={() => setItems((prev) => prev.filter((entry) => entry.id !== item.id))}
        >
          <Alert
            severity={item.severity}
            variant="filled"
            elevation={4}
            onClose={() => setItems((prev) => prev.filter((entry) => entry.id !== item.id))}
          >
            {item.message}
          </Alert>
        </Snackbar>
      ))}
    </ToastContext.Provider>
  );
}

export function useToast(): PushToast {
  return useContext(ToastContext);
}
