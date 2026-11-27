/**
 * Setup rune result view (BL-030b, SPECS §18.5, D-102/D-103/D-134).
 *
 * Presentational only: renders a normalized `SetupRuneResult` — the data
 * source and applied evidence rule, the labeled D-103 broader-statistic
 * fallback when the mode's data is too thin, and the top rune pages. Every
 * figure carries its sample size (and distinct-player count for expert
 * figures); insufficient pages show "Not enough data", never a bare rate.
 * Each page also names the statistic behind it ("Based on …"), which is the
 * adaptation hint until per-rune personalization ships (GOALS "Later").
 *
 * Rune names/icons resolve through the static `runes.json` catalog; an
 * unresolvable id simply renders no image, and stat shards are never in the
 * catalog.
 */

import { useState } from 'react';

import type { SetupRunePage, SetupRuneResult } from '@draftorb/shared';

import type { RuneIconInfo } from '../data/runes';
import { runeIconUrl } from '../data/runes';
import { dataSourceLabel, pageSourceLabel, pageStatsText } from '../setup/format';
import { strings } from '../strings';
import { BroaderStatisticBlock, setupEvidenceText } from './SetupEvidence';

export interface SetupRunePagesProps {
  result: SetupRuneResult;
  championName: string;
  /** Display name of the result role (`strings.roleNames[result.myRole]`). */
  roleName: string;
  /** Profile label for the myData source line; ignored for topPlayers. */
  profileLabel?: string;
  icons: ReadonlyMap<number, RuneIconInfo>;
  /** Resolved Data Dragon version for CDN icons; null falls back to initials. */
  iconVersion: string | null;
}

function RuneIcon({ info, iconVersion }: { info: RuneIconInfo; iconVersion: string | null }) {
  const [failed, setFailed] = useState(false);
  const url = runeIconUrl(iconVersion, info.icon);
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

/** Ordered, deduplicated icon ids of a page (styles, keystone, perks, shards). */
function pageIconIds(page: SetupRunePage): number[] {
  return [
    ...new Set([
      page.primaryStyleId,
      page.subStyleId,
      page.keystoneId,
      ...page.perkIds,
      ...page.statShardIds,
    ]),
  ];
}

/** "Keystone · Primary / Secondary" from the catalog; '' when nothing resolves. */
function pageTitle(page: SetupRunePage, icons: ReadonlyMap<number, RuneIconInfo>): string {
  const name = (id: number): string | undefined => icons.get(id)?.name;
  const styles = [name(page.primaryStyleId), name(page.subStyleId)]
    .filter((n): n is string => n !== undefined)
    .join(' / ');
  const parts = [name(page.keystoneId), styles].filter(
    (n): n is string => n !== undefined && n !== '',
  );
  return parts.join(' · ');
}

function RunePageCard({
  page,
  rank,
  icons,
  iconVersion,
}: {
  page: SetupRunePage;
  rank: number;
  icons: ReadonlyMap<number, RuneIconInfo>;
  iconVersion: string | null;
}) {
  const resolved = pageIconIds(page)
    .map((id) => icons.get(id))
    .filter((info): info is RuneIconInfo => info !== undefined);
  const title = pageTitle(page, icons);
  return (
    <li className="rounded-lg border border-slate-300 p-4 dark:border-slate-600">
      <div className="flex items-center gap-2">
        <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          #{rank}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {resolved.map((info) => (
            <RuneIcon key={info.id} info={info} iconVersion={iconVersion} />
          ))}
        </div>
      </div>
      {title !== '' && <p className="mt-2 text-sm font-medium">{title}</p>}
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{pageStatsText(page)}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {strings.setupSourcePrefix}: {pageSourceLabel(page.source, page.sourceLevel)}
      </p>
    </li>
  );
}

export function SetupRunePages({
  result,
  championName,
  roleName,
  profileLabel,
  icons,
  iconVersion,
}: SetupRunePagesProps) {
  return (
    <section aria-label={strings.setupRunesTitle(championName)} className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {strings.setupRunesTitle(championName)}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {strings.setupDataSource(dataSourceLabel(result.dataSource, profileLabel))}
        </p>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {setupEvidenceText(result.evidence)}
      </p>
      <BroaderStatisticBlock
        stat={result.broaderStatistic}
        championName={championName}
        roleName={roleName}
        scope={strings.setupBroaderScopeRunes}
      />
      {result.pages.length > 0 ? (
        <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {result.pages.map((page, index) => (
            <RunePageCard
              key={`${page.primaryStyleId}-${page.subStyleId}-${page.keystoneId}`}
              page={page}
              rank={index + 1}
              icons={icons}
              iconVersion={iconVersion}
            />
          ))}
        </ol>
      ) : (
        !result.dataAvailable &&
        result.broaderStatistic === null && (
          <p className="text-sm text-slate-600 dark:text-slate-300">{strings.setupNoPages}</p>
        )
      )}
    </section>
  );
}
