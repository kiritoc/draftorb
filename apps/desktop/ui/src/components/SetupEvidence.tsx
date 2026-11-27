/**
 * Shared setup-section chrome (BL-030b/BL-031b, SPECS §18.5, D-102/D-103).
 *
 * The applied evidence rule line and the labeled D-103 broader-statistic
 * fallback are identical for the rune, summoner and starter sections, so
 * they live here once: every setup result reports the same `SetupEvidence`
 * block and the same `SetupBroaderStatistic` shape.
 */

import type { SetupBroaderStatistic, SetupEvidence } from '@draftorb/shared';

import { broaderStatsText } from '../setup/format';
import { strings } from '../strings';

/** One-line description of the evidence rule applied to a setup result. */
export function setupEvidenceText(evidence: SetupEvidence): string {
  const base =
    evidence.kind === 'expert'
      ? strings.setupEvidenceExpert(evidence.minDistinctPlayers, evidence.playerWeightCap)
      : strings.setupEvidenceProfile(evidence.minSetupGames);
  return evidence.kind === 'expert' && evidence.masterPlusOnly
    ? `${base} · ${strings.setupMasterPlusTag}`
    : base;
}

/**
 * The labeled D-103 broader-statistic fallback block; renders nothing when
 * the mode's primary data was sufficient (`stat === null`).
 */
export function BroaderStatisticBlock({
  stat,
  championName,
  roleName,
  scope,
}: {
  stat: SetupBroaderStatistic | null;
  championName: string;
  roleName: string;
  /** What the champion win rate spans, e.g. "all rune pages" (D-103 label). */
  scope: string;
}) {
  if (stat === null) return null;
  const label =
    stat.kind === 'championRoleWinRate'
      ? strings.setupBroaderChampionRole(championName, roleName, scope)
      : strings.setupBroaderProfileChampion(championName);
  return (
    <div
      role="note"
      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-900/20"
    >
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
        {strings.setupBroaderTitle}
      </p>
      <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-100/90">
        {label}: {broaderStatsText(stat)}
      </p>
    </div>
  );
}
