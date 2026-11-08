/**
 * @draftorb/web — Rune page panel (T-041, SPECS §8.1).
 *
 * Shows the engine's `RuneRecommendationResult` for the picked champion:
 * the top pages with style/keystone/perk icons resolved through the static
 * `runes.json` catalog, shrunk win rate always paired with its effective
 * sample size (never a bare percentage), the low-data badge, and the
 * `statShardsVsDamageMix` adaptation hint. Icons degrade silently — an
 * unresolvable id simply renders no image.
 */

import { useState } from 'react';

import type { RunePagePick, RuneRecommendationResult } from '@draftorb/shared';
import { runeIconUrl, type RuneIconInfo } from '../data/runes.js';
import { strings } from '../strings.js';

export interface RunesPanelProps {
  result: RuneRecommendationResult;
  championName: string;
  icons: ReadonlyMap<number, RuneIconInfo>;
  /** Resolved Data Dragon version for the CDN, or null when unavailable. */
  iconVersion: string | null;
}

function RuneIcon({ info, iconVersion }: { info: RuneIconInfo; iconVersion: string | null }) {
  const [failed, setFailed] = useState(false);
  const url = runeIconUrl(iconVersion, info.icon);
  if (url === null || failed) {
    return (
      <span
        className="flex items-center justify-center w-7 h-7 rounded bg-gray-700 text-[10px] font-bold text-gray-300"
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
      className="w-7 h-7 rounded object-cover"
    />
  );
}

/** Ordered, deduplicated icon ids of a page (style, keystone, perks, shards). */
function pageIconIds(page: RunePagePick): number[] {
  const ids = [
    page.primaryStyleId,
    page.subStyleId,
    page.keystoneId,
    ...page.selectedPerkIds,
    ...(page.statShardIds ?? []),
  ];
  return [...new Set(ids)];
}

function RunePageCard({
  page,
  icons,
  iconVersion,
}: {
  page: RunePagePick;
  icons: ReadonlyMap<number, RuneIconInfo>;
  iconVersion: string | null;
}) {
  const resolved = pageIconIds(page)
    .map((id) => icons.get(id))
    .filter((info): info is RuneIconInfo => info !== undefined);
  return (
    <li className="p-3 rounded bg-gray-800/60 border border-gray-700/60">
      <div className="flex items-center gap-1.5 flex-wrap">
        {resolved.map((info) => (
          <RuneIcon key={info.id} info={info} iconVersion={iconVersion} />
        ))}
      </div>
      <p className="mt-2 text-sm text-gray-200">
        {strings.runeStats(
          Math.round(page.winRate * 1000) / 10,
          Math.round(page.nEff),
          Math.round(page.pickShare * 1000) / 10,
        )}
      </p>
      {page.lowData && (
        <span className="mt-1 inline-block px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded bg-amber-900/40 text-amber-300 border border-amber-700/40">
          {strings.lowData}
        </span>
      )}
    </li>
  );
}

export function RunesPanel({ result, championName, icons, iconVersion }: RunesPanelProps) {
  return (
    <section
      aria-label={strings.runesTitle(championName)}
      className="mb-6 p-4 rounded bg-gray-800/30 border border-gray-800"
    >
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
        {strings.runesTitle(championName)}
      </h2>
      {!result.dataAvailable ? (
        <p className="text-sm text-gray-400">{strings.runesUnavailable}</p>
      ) : (
        <>
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {result.pages.map((page) => (
              <RunePageCard
                key={`${page.primaryStyleId}-${page.subStyleId}-${page.keystoneId}`}
                page={page}
                icons={icons}
                iconVersion={iconVersion}
              />
            ))}
          </ul>
          {result.adaptationHints.map((hint) => {
            const shardIcons = hint.statShardIds
              .map((id) => icons.get(id))
              .filter((info): info is RuneIconInfo => info !== undefined);
            return (
              <p key={hint.code} className="mt-3 text-sm text-indigo-300/90">
                {strings.runeHintVsDamageMix(hint.damageMix)}
                {shardIcons.length > 0 && (
                  <span className="inline-flex items-center gap-1 ml-2 align-middle">
                    {shardIcons.map((info) => (
                      <RuneIcon key={info.id} info={info} iconVersion={iconVersion} />
                    ))}
                  </span>
                )}
              </p>
            );
          })}
        </>
      )}
    </section>
  );
}
