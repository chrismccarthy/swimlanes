import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError, getDiagnostics } from '../../lib/errorReporter';
import { useAppStore } from '../../store/useAppStore';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
  /** 'full' (default) fills the viewport; 'inline' is a smaller in-place card with just Try again. */
  variant?: 'full' | 'inline';
  /** Called before the boundary resets its own state — e.g. to clear whatever tripped the crash. */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ componentStack: errorInfo.componentStack ?? null });
    reportError(error, { componentStack: errorInfo.componentStack });
  }

  private handleTryAgain = (): void => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null, componentStack: null });
  };

  private handleReload = (): void => {
    location.reload();
  };

  private handleCopyDiagnostics = (): void => {
    const diagnostics = getDiagnostics(this.state.error, this.state.componentStack ?? undefined);
    const json = JSON.stringify(diagnostics, null, 2);
    // In the sandboxed artifact iframe, `navigator.clipboard` can be missing
    // or throw outright rather than just rejecting, so guard the access too.
    try {
      navigator.clipboard
        ?.writeText(json)
        ?.catch(() => useAppStore.getState().addToast('Copy failed', 'error'));
    } catch {
      useAppStore.getState().addToast('Copy failed', 'error');
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const inline = this.props.variant === 'inline';
    const message = this.state.error?.message || 'Unknown error';

    return (
      <div className={inline ? styles.inlineWrap : styles.fullWrap} role="alert">
        <div className={`${styles.card} ${inline ? styles.cardInline : ''}`}>
          <p className={styles.heading}>Something went wrong</p>
          <p className={styles.explanation}>
            This part of Swimlanes hit a problem and couldn&apos;t keep rendering.
          </p>
          <pre className={styles.errorBox}>{message}</pre>
          <div className={styles.actions}>
            <button className={styles.primaryBtn} onClick={this.handleTryAgain}>
              Try again
            </button>
            {!inline && (
              <>
                <button className={styles.secondaryBtn} onClick={this.handleReload}>
                  Reload
                </button>
                <button className={styles.secondaryBtn} onClick={this.handleCopyDiagnostics}>
                  Copy diagnostics
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
}
