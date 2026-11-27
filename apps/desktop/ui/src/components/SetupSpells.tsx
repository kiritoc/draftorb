/**
 * Setup summoner-spell result view (BL-031b, SPECS §18.5, D-102/D-103/D-134).
 *
 * Presentational only: renders a normalized `SetupSpellsResult` — the data
 * source and applied evidence rule, the labeled D-103 broader-statistic
 * fallback when the mode's data is too thin, and the top spell pairs. Every
 * figure carries its sample size (and distinct-player count for expert
 * figures); insufficient picks show "Not enough data", never a bare rate.
 * Each pick also names the statistic behind it ("Based on …") and the pair
 * resolves to spell names through the static id map (unknown ids fall back
 * to a labeled `Spell <id>`).
 */

import type { SetupSpellPick, SetupSpellsResult } from '@draftorb/shared';

import { dataSourceLabel, pageSourceLabel, pickStatsText } from '../setup/format';
import { summonerSpellPairLabel } from '../setup/summoner-spells';
import { strings } from '../strings';
import { BroaderStatisticBlock, setupEvidenceText } from './SetupEvidence';

export interface SetupSpellsProps {
  result: SetupSpellsResult;
  championName: string;
  /** Display name of the result role (`strings.roleNames[result.myRole]`). */
  roleName: string;
  /** Profile label for the myData source line; ignored for topPlayers. */
  profileLabel?: string;
}

function SpellPickCard({ pick, rank }: { pick: SetupSpellPick; rank: number }) {
  return (
    <li className="rounded-lg border border-slate-300 p-4 dark:border-slate-600">
      <div className="flex items-center gap-2">
        <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          #{rank}
        </span>
        <p className="text-sm font-medium">
          {summonerSpellPairLabel([pick.spell1Id, pick.spell2Id])}
        </p>
      </div>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{pickStatsText(pick)}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {strings.setupSourcePrefix}: {pageSourceLabel(pick.source, pick.sourceLevel)}
      </p>
    </li>
  );
}

export function SetupSpells({ result, championName, roleName, profileLabel }: SetupSpellsProps) {
  return (
    <section aria-label={strings.setupSpellsTitle(championName)} className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {strings.setupSpellsTitle(championName)}
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
        scope={strings.setupBroaderScopeSpells}
      />
      {result.picks.length > 0 ? (
        <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {result.picks.map((pick, index) => (
            <SpellPickCard key={`${pick.spell1Id}-${pick.spell2Id}`} pick={pick} rank={index + 1} />
          ))}
        </ol>
      ) : (
        !result.dataAvailable &&
        result.broaderStatistic === null && (
          <p className="text-sm text-slate-600 dark:text-slate-300">{strings.setupNoSpells}</p>
        )
      )}
    </section>
  );
}
