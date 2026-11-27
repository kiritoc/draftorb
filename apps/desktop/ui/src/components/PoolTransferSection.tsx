/**
 * Pool transfer controls (SPECS §2.1/§19.3): JSON backup (export to a
 * read-only textarea, validated import) and the manual repo-file
 * import/export actions. All state lives in the parent; this is wiring.
 */

import { useState, type ReactElement } from 'react';

import type { PoolConfig } from '@draftorb/shared';
import { strings } from '../strings';
import type { PoolEditorMessage } from '../pool/pool-editor-state';
import { serializePoolConfig } from '../pool/pool-model';
import { PoolMessage } from './PoolMessage';

export interface PoolTransferSectionProps {
  pool: PoolConfig;
  /** True when the working copy differs from the stored pool: repo export is refused. */
  dirty: boolean;
  repoFolder?: string;
  /** Status feedback for the transfer actions, rendered next to the buttons that produced it. */
  message: PoolEditorMessage | null;
  /** Validates and adopts pasted JSON; returns false when invalid. */
  onApplyJson: (text: string) => boolean;
  onRepoImport: () => void;
  onRepoExport: () => void;
}

/** JSON backup and repo-file import/export controls for the pool editor. */
export function PoolTransferSection({
  pool,
  dirty,
  repoFolder,
  message,
  onApplyJson,
  onRepoImport,
  onRepoExport,
}: PoolTransferSectionProps): ReactElement {
  const [showJsonExport, setShowJsonExport] = useState(false);
  const [jsonImport, setJsonImport] = useState('');

  const secondaryButton =
    'rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700';

  return (
    <div className="mb-4 space-y-3">
      {repoFolder !== undefined ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onRepoImport} className={secondaryButton}>
            {strings.poolRepoImport}
          </button>
          <button
            type="button"
            onClick={onRepoExport}
            title={dirty ? strings.poolDirtyExport : undefined}
            className={secondaryButton}
          >
            {strings.poolRepoExport}
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">{strings.poolRepoNeedFolder}</p>
      )}

      {message !== null && <PoolMessage message={message} />}

      <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <summary className="cursor-pointer text-sm font-semibold text-slate-600 dark:text-slate-300">
          {strings.poolJsonTitle}
        </summary>
        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={() => setShowJsonExport((current) => !current)}
            className={secondaryButton}
          >
            {strings.poolJsonExport}
          </button>
          {showJsonExport && (
            <textarea
              readOnly
              value={serializePoolConfig(pool)}
              rows={8}
              aria-label={strings.poolJsonTitle}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            />
          )}
          <textarea
            value={jsonImport}
            onChange={(event) => setJsonImport(event.target.value)}
            rows={4}
            placeholder={strings.poolJsonPlaceholder}
            aria-label={strings.poolJsonImport}
            className="w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
          />
          <button
            type="button"
            onClick={() => {
              if (onApplyJson(jsonImport)) setJsonImport('');
            }}
            disabled={jsonImport.trim() === ''}
            className={`${secondaryButton} disabled:pointer-events-none disabled:opacity-50`}
          >
            {strings.poolJsonApply}
          </button>
        </div>
      </details>
    </div>
  );
}
