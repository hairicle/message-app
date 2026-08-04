'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type ConfirmTone = 'danger' | 'primary';

export interface ConfirmOptions {
  title: string;
  /** Supports rich content so the consequence can be emphasised, e.g. <b>This cannot be undone.</b> */
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  // Focus starts on Cancel — for a destructive prompt the safe option should be the one a
  // stray Enter/Space lands on.
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    cancelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  const isDanger = tone === 'danger';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
      onClick={() => !busy && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={description ? 'confirm-dialog-description' : undefined}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}
      >
        <h2
          id="confirm-dialog-title"
          className="text-[16px] font-bold text-center leading-snug"
          style={{ color: 'var(--text)' }}
        >
          {title}
        </h2>

        {description && (
          <p
            id="confirm-dialog-description"
            className="text-[13px] text-center mt-2 leading-relaxed"
            style={{ color: 'var(--text-dim)' }}
          >
            {description}
          </p>
        )}

        <div className="flex gap-2.5 mt-6">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 font-mono font-semibold text-[13px] py-2.5 rounded-lg transition-colors disabled:opacity-50"
            style={{ background: 'var(--panel-alt)', color: 'var(--text)', border: '1px solid var(--border)' }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className="flex-1 font-mono font-semibold text-[13px] py-2.5 rounded-lg transition-all disabled:opacity-60"
            style={{
              background: isDanger ? 'var(--danger)' : 'var(--accent)',
              color: '#fff',
              border: `1px solid ${isDanger ? 'var(--danger)' : 'var(--accent)'}`,
            }}
            onMouseEnter={(e) => { if (!busy) (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(0.92)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = 'none'; }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Promise-based confirmation, so a native `window.confirm` call site converts almost verbatim:
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ title: 'Delete this message?' }))) return;
 *   // ...and render {confirmDialog} once in the component's JSX
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    setState(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setState(null);
  }, []);

  const confirmDialog = (
    <ConfirmDialog
      open={state !== null}
      title={state?.title ?? ''}
      description={state?.description}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      tone={state?.tone}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, confirmDialog };
}
