import { create } from 'zustand';

/**
 * In-app replacements for `window.confirm` / `window.prompt`.
 *
 * The app is also published as a claude.ai artifact inside a sandboxed
 * iframe, where those native dialogs are blocked (they resolve to
 * `false`/`null` silently). This store drives `DialogHost`, which renders a
 * real modal instead, and gives callers the same await-and-get-a-result
 * shape the native APIs had.
 */

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Label for the primary action button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Styles the primary button as a destructive action. */
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  /** Label shown above the text input. */
  label: string;
  placeholder?: string;
  initialValue?: string;
  /** Label for the primary action button. Defaults to "OK". */
  confirmLabel?: string;
  /** Returns a validation message to block submission, or undefined when valid. */
  validate?: (value: string) => string | undefined;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (result: boolean) => void;
}

interface PromptRequest extends PromptOptions {
  resolve: (result: string | null) => void;
}

interface DialogState {
  confirmRequest: ConfirmRequest | null;
  promptRequest: PromptRequest | null;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  resolveConfirm: (result: boolean) => void;
  resolvePrompt: (result: string | null) => void;
}

export const useDialogStore = create<DialogState>()((set, get) => ({
  confirmRequest: null,
  promptRequest: null,

  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      // Only one dialog is shown at a time; a new confirm request replaces
      // (and implicitly cancels) any pending one.
      get().confirmRequest?.resolve(false);
      set({ confirmRequest: { ...options, resolve } });
    }),

  prompt: (options) =>
    new Promise<string | null>((resolve) => {
      get().promptRequest?.resolve(null);
      set({ promptRequest: { ...options, resolve } });
    }),

  resolveConfirm: (result) => {
    get().confirmRequest?.resolve(result);
    set({ confirmRequest: null });
  },

  resolvePrompt: (result) => {
    get().promptRequest?.resolve(result);
    set({ promptRequest: null });
  },
}));

/** Imperative dialog API for callers to await, e.g. `const ok = await confirm(...)`. */
export function useDialog() {
  const confirm = useDialogStore(s => s.confirm);
  const prompt = useDialogStore(s => s.prompt);
  return { confirm, prompt };
}
