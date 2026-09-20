import { useDialogStore } from '../../store/useDialogStore';
import { ConfirmDialog } from './ConfirmDialog';
import { PromptDialog } from './PromptDialog';

/**
 * Mounted once in `App.tsx`. Renders whichever dialog `useDialog()` (or the
 * `useDialogStore` actions directly) most recently requested — at most one
 * confirm and one prompt can be pending at a time.
 */
export function DialogHost() {
  const confirmRequest = useDialogStore(s => s.confirmRequest);
  const promptRequest = useDialogStore(s => s.promptRequest);
  const resolveConfirm = useDialogStore(s => s.resolveConfirm);
  const resolvePrompt = useDialogStore(s => s.resolvePrompt);

  return (
    <>
      {confirmRequest && (
        <ConfirmDialog
          title={confirmRequest.title}
          message={confirmRequest.message}
          confirmLabel={confirmRequest.confirmLabel}
          danger={confirmRequest.danger}
          onConfirm={() => resolveConfirm(true)}
          onCancel={() => resolveConfirm(false)}
        />
      )}
      {promptRequest && (
        <PromptDialog
          title={promptRequest.title}
          label={promptRequest.label}
          placeholder={promptRequest.placeholder}
          initialValue={promptRequest.initialValue}
          confirmLabel={promptRequest.confirmLabel}
          validate={promptRequest.validate}
          onSubmit={value => resolvePrompt(value)}
          onCancel={() => resolvePrompt(null)}
        />
      )}
    </>
  );
}
