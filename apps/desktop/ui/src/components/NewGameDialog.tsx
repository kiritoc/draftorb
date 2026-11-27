/**
 * "New game" confirmation dialog (BL-055, SPECS §10).
 *
 * Lightweight modal using the same native `<dialog>` pattern as the pool
 * editor: initial focus, inert background, Esc and backdrop click cancel.
 * Confirming resets every per-game field on the Pick and Setup screens;
 * the pool, settings and profile are never touched.
 */

import { useEffect, useRef, type MouseEvent, type ReactElement, type SyntheticEvent } from 'react';

import { strings } from '../strings';

export interface NewGameDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function NewGameDialog({
  open,
  onCancel,
  onConfirm,
}: NewGameDialogProps): ReactElement | null {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Native modal: initial focus, inert background, Esc; focus returns to the opener.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected === true) opener.focus();
    };
  }, [open]);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    // Esc: keep React as the source of truth for open state.
    event.preventDefault();
    onCancel();
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    // Clicks on ::backdrop target the dialog element itself.
    if (event.target === event.currentTarget) onCancel();
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-label={strings.newGameDialogLabel}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
      className="m-auto w-full max-w-md rounded-xl border border-slate-300 bg-transparent p-0 backdrop:bg-slate-900/50 backdrop:backdrop-blur-sm dark:border-slate-600"
    >
      <div className="bg-white p-6 dark:bg-slate-800">
        <h2 className="mb-3 text-lg font-bold text-indigo-700 dark:text-indigo-300">
          {strings.newGameDialogLabel}
        </h2>
        <p className="mb-5 text-base text-slate-700 dark:text-slate-200">
          {strings.newGameConfirmText}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {strings.newGameCancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            {strings.newGameConfirm}
          </button>
        </div>
      </div>
    </dialog>
  );
}
