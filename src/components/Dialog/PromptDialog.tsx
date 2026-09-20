import { useEffect, useRef, useState, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from './useFocusTrap';
import styles from './Dialog.module.css';

export interface PromptDialogProps {
  title: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | undefined;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** A `window.prompt` replacement that works inside the sandboxed artifact iframe. */
export function PromptDialog({
  title,
  label,
  placeholder,
  initialValue = '',
  confirmLabel = 'OK',
  validate,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const errorId = useId();

  useFocusTrap(modalRef, true);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    const validationError = validate?.(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    onSubmit(trimmed);
  }, [value, validate, onSubmit]);

  const handleOverlayKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    },
    [onCancel]
  );

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return createPortal(
    <div className={styles.overlay} onClick={onCancel} onKeyDown={handleOverlayKeyDown}>
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
      >
        <h2 id={titleId} className={styles.heading}>{title}</h2>
        <label className={styles.label}>
          {label}
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            value={value}
            placeholder={placeholder}
            onChange={e => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={handleInputKeyDown}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </label>
        {error && (
          <span id={errorId} className={styles.error}>
            {error}
          </span>
        )}
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.primaryBtn} onClick={handleSubmit}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
