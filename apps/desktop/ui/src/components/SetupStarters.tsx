/**
 * Setup starter-items result view (BL-031b, SPECS §18.5, D-102/D-103/D-134,
 * D-086 bundle half).
 *
 * Presentational only: renders a normalized `SetupStartersResult` — the
 * data source and applied evidence rule, the labeled D-103
 * broader-statistic fallback when the mode's data is too thin, and the top
 * starter bundles (`starterBundleKey` "itemId:count" sets within
 * `starterWindowSeconds`). Every figure carries its sample size (and
 * distinct-player count for expert figures); insufficient picks show "Not
 * enough data", never a bare rate. Item names/icons resolve through the
 * cached `<patch>/items.json` catalog; unresolvable ids render a labeled
 * fallback. In "my data" mode the section states honestly when the profile
 * has no recorded starter-window bundles for the champion (pre-v3 exports
 * or games synced before BL-059).
 */

import { useState } from 'react';

import type { SetupStarterPick, SetupStartersResult } from '@draftorb/shared';

import type { ItemIconInfo } from '../data/items';
import { itemIconUrl } from '../data/items';
import {
  dataSourceLabel,
  pickStatsText,
  starterItemsLabel,
  starterSourceLabel,
} from '../setup/format';
import { strings } from '../strings';
import { BroaderStatisticBlock, setupEvidenceText } from './SetupEvidence';

export interface SetupStartersProps {
  result: SetupStartersResult;
  championName: string;
  /** Display name of the result role (`strings.roleNames[result.myRole]`). */
  roleName: string;
  /** Profile label for the myData source line; ignored for topPlayers. */
  profileLabel?: string;
  /** Item catalog index (id -> name + icon); empty renders id fallbacks. */
  items: ReadonlyMap<number, ItemIconInfo>;
  /** Resolved Data Dragon version for CDN icons; null falls back to initials. */
  iconVersion: string | null;
}

function ItemIcon({ info, iconVersion }: { info: ItemIconInfo; iconVersion: string | null }) {
  const [failed, setFailed] = useState(false);
  const url = itemIconUrl(iconVersion, info.icon);
  if (url === null || failed) {
    return (
      <span
        className="flex h-7 w-7 items-center justify-center rounded bg-slate-200 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300"
        title={info.name}
      >
        {info.name.charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={info.name}
      title={info.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-7 w-7 rounded object-cover"
    />
  );
}

function StarterPickCard({
  pick,
  rank,
  items,
  iconVersion,
}: {
  pick: SetupStarterPick;
  rank: number;
  items: ReadonlyMap<number, ItemIconInfo>;
  iconVersion: string | null;
}) {
  return (
    <li className="rounded-lg border border-slate-300 p-4 dark:border-slate-600">
      <div className="flex items-center gap-2">
        <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          #{rank}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {pick.items.map((item) => {
            const info = items.get(item.itemId);
            return info === undefined ? null : (
              <ItemIcon key={item.itemId} info={info} iconVersion={iconVersion} />
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-sm font-medium">{starterItemsLabel(pick.items, items)}</p>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{pickStatsText(pick)}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {strings.setupSourcePrefix}: {starterSourceLabel(pick.source, pick.sourceLevel)}
      </p>
    </li>
  );
}

export function SetupStarters({
  result,
  championName,
  roleName,
  profileLabel,
  items,
  iconVersion,
}: SetupStartersProps) {
  return (
    <section aria-label={strings.setupStartersTitle(championName)} className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {strings.setupStartersTitle(championName)}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {strings.setupDataSource(dataSourceLabel(result.dataSource, profileLabel))}
        </p>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {setupEvidenceText(result.evidence)}
      </p>
      {result.mode === 'myData' && result.picks.length === 0 && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {strings.setupStartersNoProfileData}
        </p>
      )}
      <BroaderStatisticBlock
        stat={result.broaderStatistic}
        championName={championName}
        roleName={roleName}
        scope={strings.setupBroaderScopeStarters}
      />
      {result.picks.length > 0 ? (
        <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {result.picks.map((pick, index) => (
            <StarterPickCard
              key={pick.items.map((item) => `${item.itemId}:${item.count}`).join(',')}
              pick={pick}
              rank={index + 1}
              items={items}
              iconVersion={iconVersion}
            />
          ))}
        </ol>
      ) : (
        !result.dataAvailable &&
        result.broaderStatistic === null && (
          <p className="text-sm text-slate-600 dark:text-slate-300">{strings.setupNoStarters}</p>
        )
      )}
    </section>
  );
}
