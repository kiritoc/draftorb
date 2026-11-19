import { strings } from '../strings';
import type { PoolSyncStatus } from '../pool/pool-sync';

export function PoolSyncBanner({ status }: { status: PoolSyncStatus }) {
  if (status.kind === 'differs') {
    return (
      <p
        role="alert"
        className="bg-amber-100 px-6 py-3 text-base font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
      >
        {strings.poolDiffers}
      </p>
    );
  }
  if (status.kind === 'invalid') {
    return (
      <p
        role="status"
        className="bg-amber-50 px-6 py-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100"
      >
        {status.notice}
      </p>
    );
  }
  return null;
}
