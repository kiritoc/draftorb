/**
 * Setup screen — runes section (BL-030b, SPECS §18.5, D-134).
 *
 * Role enablement is `manifest.roles` minus `manifest.minimalRoles`
 * (`loadSetupRoles`), independent of the pick screen's D-126 coverage
 * verdict; thin setup data is a per-champion D-103 insufficient-data state,
 * never a disabled role. The screen picks role, champion and rank, then
 * queries `loadSetupRunes` for the active mode — switching "top players" /
 * "my data" re-queries the source without a restart and each mode shows its
 * data source. The optional Master+ toggle maps to the engine's
 * `evidenceMasterPlusOnly` config (off by default, D-102).
 *
 * Draft-slot context (allies/enemies) is intentionally not entered here
 * yet (D-138 PROPOSED): pages resolve at the broader labeled contexts
 * (damage mix / global for experts, champion level for the profile).
 * BL-031b (#93) adds the summoners and starters sections below this one —
 * keep new setup sections additive under the same shell.
 */

import { useEffect, useMemo, useState } from 'react';

import { DEFAULT_CONFIG } from '@draftorb/engine';
import {
  rankSchema,
  type Champion,
  type ChampionId,
  type DraftInput,
  type Rank,
  type Role,
  type RuneTrees,
  type SetupMode,
  type SetupRuneResult,
} from '@draftorb/shared';

import { championName } from '../champion-name';
import { ChampionPicker } from '../components/ChampionPicker';
import { RoleSelector } from '../components/RoleSelector';
import { SetupRunePages } from '../components/SetupRunePages';
import { ROLE_ORDER } from '../config';
import { loadChampionIconVersion } from '../data/champion-icons';
import {
  loadChampionCatalog,
  loadPickData,
  type ChampionCatalog,
  type PickData,
} from '../data/export-data';
import { buildRuneIconIndex, loadRuneCatalog, type RuneIconInfo } from '../data/runes';
import { loadSetupRoles } from '../data/setup-roles';
import { loadSetupRunes } from '../data/setup-runes';
import type { ProfileLoad } from '../profile/profile-export';
import { strings } from '../strings';

const DEFAULT_RANK: Rank = 'DIAMOND';
const SETUP_MODES: readonly SetupMode[] = ['topPlayers', 'myData'];
const EMPTY_ICONS: ReadonlyMap<number, RuneIconInfo> = new Map();

export interface SetupScreenProps {
  /** Role picked on the pick screen; used as the initial setup role. */
  preferredRole?: Role | null;
  /** Bumped each time the launch data download settles; triggers reloads. */
  dataReadyNonce: number;
  profileLoad: ProfileLoad;
  /** One-line profile status shown under "my data" when no export loaded. */
  profileStatus?: string;
}

export function SetupScreen({
  preferredRole = null,
  dataReadyNonce,
  profileLoad,
  profileStatus,
}: SetupScreenProps) {
  // undefined = verdict pending, null = no cached release, [] = no full role.
  const [setupRoles, setSetupRoles] = useState<readonly Role[] | null | undefined>(undefined);
  const [role, setRole] = useState<Role>(preferredRole ?? 'SUPPORT');
  const [championId, setChampionId] = useState<ChampionId | null>(null);
  const [rank, setRank] = useState<Rank>(DEFAULT_RANK);
  const [mode, setMode] = useState<SetupMode>('topPlayers');
  const [masterPlus, setMasterPlus] = useState(false);
  const [pickData, setPickData] = useState<PickData | null>(null);
  const [catalog, setCatalog] = useState<ChampionCatalog | null>(null);
  const [iconVersion, setIconVersion] = useState<string | null>(null);
  const [runeTrees, setRuneTrees] = useState<RuneTrees | null>(null);
  const [result, setResult] = useState<SetupRuneResult | null>(null);
  const [queryPending, setQueryPending] = useState(false);
  const [noData, setNoData] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // D-134: setup roles come from the manifest, not the D-126 coverage verdict.
  useEffect(() => {
    let cancelled = false;
    void loadSetupRoles()
      .then((roles) => {
        if (!cancelled) setSetupRoles(roles);
      })
      .catch(() => {
        if (!cancelled) setSetupRoles(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dataReadyNonce]);

  // Keep the selection while it is enabled; otherwise fall back to the first
  // enabled role in ROLE_ORDER (setupRoles already follows manifest order).
  useEffect(() => {
    if (setupRoles === undefined || setupRoles === null || setupRoles.length === 0) return;
    if (!setupRoles.includes(role)) {
      setRole(ROLE_ORDER.find((r) => setupRoles.includes(r)) ?? setupRoles[0] ?? role);
    }
  }, [setupRoles, role]);

  // Role-scoped recommendation data (baselines, roleProb, tags) for the
  // engine query; null means "no cached release".
  useEffect(() => {
    let cancelled = false;
    setPickData(null);
    setResult(null);
    setNoData(false);
    setLoadError(null);
    void loadPickData(role)
      .then((loaded) => {
        if (cancelled) return;
        if (loaded === null) {
          setNoData(true);
          return;
        }
        setPickData(loaded);
        void loadChampionIconVersion(loaded.patch)
          .then((version) => {
            if (!cancelled) setIconVersion(version);
          })
          .catch(() => {});
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [role, dataReadyNonce]);

  // Champion catalog for the picker: role-independent, prefer it over
  // pickData.champions so a stale role dataset cannot mask a newer catalog.
  useEffect(() => {
    let cancelled = false;
    void loadChampionCatalog()
      .then((loaded) => {
        if (cancelled || loaded === null) return;
        setCatalog(loaded);
        void loadChampionIconVersion(loaded.patch)
          .then((version) => {
            if (!cancelled) setIconVersion(version);
          })
          .catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dataReadyNonce]);

  // Rune name/icon catalog (`<patch>/runes.json`): display-only, so a
  // missing or corrupt catalog degrades to id-only pages instead of
  // failing the rune query (unlike the fail-closed manifest files).
  const dataPatch = pickData?.patch ?? catalog?.patch;
  useEffect(() => {
    if (dataPatch === undefined) return;
    let cancelled = false;
    void loadRuneCatalog(dataPatch)
      .then((trees) => {
        if (!cancelled) setRuneTrees(trees);
      })
      .catch(() => {
        if (!cancelled) setRuneTrees(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dataPatch]);

  const champions: Champion[] = useMemo(
    () => catalog?.champions ?? pickData?.champions ?? [],
    [pickData, catalog],
  );
  const runeIcons = useMemo(
    () => (runeTrees === null ? EMPTY_ICONS : buildRuneIconIndex(runeTrees)),
    [runeTrees],
  );

  // The setup screen enters no draft slots yet (D-138): allies/enemies stay
  // empty so lane/matchup contexts simply do not match and pages resolve at
  // the broader labeled levels.
  const draft: DraftInput = useMemo(
    () => ({
      userRank: rank,
      userRole: role,
      allies: [],
      enemies: [],
      blindPick: false,
    }),
    [rank, role],
  );

  const profile = useMemo(
    () => (profileLoad.kind === 'loaded' ? profileLoad.profile : undefined),
    [profileLoad],
  );
  const profileLabel = profile?.label;

  // Optional Master+ toggle (D-102): maps to the engine's evidence config.
  const runeConfig = useMemo(
    () => ({ ...DEFAULT_CONFIG, evidenceMasterPlusOnly: masterPlus }),
    [masterPlus],
  );

  // Mode switch re-queries the chosen source: `loadSetupRunes` re-reads the
  // rune export only for topPlayers and re-aggregates the profile for
  // myData, with no restart and no hidden state (D-134).
  useEffect(() => {
    if (championId === null || pickData === null) {
      setResult(null);
      setQueryPending(false);
      return;
    }
    let cancelled = false;
    setQueryPending(true);
    void loadSetupRunes({
      mode,
      championId,
      draft,
      pickData,
      ...(profile !== undefined ? { profile } : {}),
      config: runeConfig,
    })
      .then((loaded) => {
        if (cancelled) return;
        setResult(loaded);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResult(null);
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setQueryPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, championId, draft, pickData, profile, runeConfig]);

  if (setupRoles !== undefined && setupRoles !== null && setupRoles.length === 0) {
    return <p className="text-slate-600 dark:text-slate-300">{strings.setupNoSetupRoles}</p>;
  }

  const selectedName = championId === null ? null : championName(champions, championId);

  return (
    <div className="space-y-6">
      <RoleSelector selected={role} enabledRoles={setupRoles ?? undefined} onSelect={setRole} />

      {noData ? (
        <p className="text-slate-600 dark:text-slate-300">{strings.pickNoData}</p>
      ) : loadError !== null && pickData === null ? (
        <p className="text-red-600 dark:text-red-400">{strings.loadFailed(loadError)}</p>
      ) : pickData === null ? (
        <p className="text-slate-500 dark:text-slate-400">{strings.loading}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-full max-w-md">
              <span
                id="setup-champion-label"
                className="mb-1 block text-sm text-slate-600 dark:text-slate-300"
              >
                {strings.setupChampionLabel}
              </span>
              <ChampionPicker
                value={championId}
                onChange={setChampionId}
                champions={champions}
                labelledBy="setup-champion-label"
                searchLabel={strings.setupChampionLabel}
                iconVersion={iconVersion}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              {strings.rankLabel}
              <select
                value={rank}
                onChange={(event) => setRank(event.target.value as Rank)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                {rankSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div role="group" aria-label={strings.setupModeLabel} className="flex gap-2">
              {SETUP_MODES.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  onClick={() => setMode(option)}
                  className={`rounded-lg border px-4 py-2 text-base ${
                    mode === option
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700'
                  }`}
                >
                  {option === 'topPlayers' ? strings.setupModeTopPlayers : strings.setupModeMyData}
                </button>
              ))}
            </div>
            <label
              className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"
              title={strings.setupMasterPlusHint}
            >
              <input
                type="checkbox"
                checked={masterPlus}
                onChange={(event) => setMasterPlus(event.target.checked)}
                className="h-4 w-4"
              />
              {strings.setupMasterPlus}
            </label>
          </div>

          {mode === 'myData' && profileLoad.kind !== 'loaded' && profileStatus !== undefined && (
            <p className="text-sm text-slate-500 dark:text-slate-400">{profileStatus}</p>
          )}

          {championId === null ? (
            <p className="text-slate-600 dark:text-slate-300">{strings.setupPickChampion}</p>
          ) : queryPending ? (
            <p className="text-slate-500 dark:text-slate-400">{strings.loading}</p>
          ) : loadError !== null ? (
            <p className="text-red-600 dark:text-red-400">{strings.loadFailed(loadError)}</p>
          ) : result !== null ? (
            <SetupRunePages
              result={result}
              championName={selectedName ?? strings.championFallback(championId)}
              roleName={strings.roleNames[result.myRole]}
              {...(profileLabel !== undefined ? { profileLabel } : {})}
              icons={runeIcons}
              iconVersion={iconVersion}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
