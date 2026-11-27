/**
 * Styled feedback line for the pool editor (B-081). Rendered next to the
 * action that produced the message: under the add form, inside the transfer
 * section or above the footer buttons, per `message.scope`.
 */

import type { ReactElement } from 'react';

import type { PoolEditorMessage } from '../pool/pool-editor-state';

/** One feedback line; `kind` picks the alert/status role and the colors. */
export function PoolMessage({
  message,
  className = '',
}: {
  message: PoolEditorMessage;
  className?: string;
}): ReactElement {
  return (
    <p
      role={message.kind === 'error' ? 'alert' : 'status'}
      className={`rounded border px-3 py-2 text-sm ${
        message.kind === 'error'
          ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-900/30 dark:text-red-300'
          : 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-900/30 dark:text-indigo-300'
      } ${className}`}
    >
      {message.text}
    </p>
  );
}
