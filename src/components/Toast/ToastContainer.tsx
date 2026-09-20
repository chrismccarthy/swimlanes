import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import styles from './Toast.module.css';

export function ToastContainer() {
  const toasts = useAppStore(s => s.toasts);
  const dismissToast = useAppStore(s => s.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const latest = toasts[toasts.length - 1];
    const timer = setTimeout(() => dismissToast(latest.id), 4000);
    return () => clearTimeout(timer);
  }, [toasts, dismissToast]);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className={styles.container} data-print="hide">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`${styles.toast} ${toast.type === 'error' ? styles.error : styles.info}`}
          onClick={() => dismissToast(toast.id)}
        >
          {toast.message}
          {toast.action && (
            // The click bubbles to the toast, which dismisses it — an action
            // always ends the toast it was offered on.
            <button
              type="button"
              className={styles.action}
              data-testid="toast-action"
              onClick={toast.action.onClick}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}
