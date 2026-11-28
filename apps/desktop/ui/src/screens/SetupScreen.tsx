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
 * BL-058 (D-138 follow-up): the pick screen hands off its locked champion
 * and draft slots (`draftHandoff` prop), so rune/summoner/starter pages can
 * resolve at the narrower lane/matchup levels — still labeled per D-103.
 * Without a handoff the slots stay empty and pages resolve at the broader
 * labeled contexts (damage mix / global for experts, champion level for
 * the profile). BL-031b (#93) added the summoner-spells and starter-items
 * sections below the runes one — they share the same mode switch and
 * Master+ toggle and query their own mode-switched loaders
 * (`loadSetupSpells`, `loadSetupStarters`) on the same inputs.
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
  type SetupSpellsResult,
  type SetupStartersResult,
} from '@draftorb/shared';

import { championName } from '../champion-name';
import { setupDraftInput, type DraftHandoff } from '../draft-handoff';
import { ChampionPicker } from '../components/ChampionPicker';
import { RoleSelector } from '../components/RoleSelector';
import { SetupRunePages } from '../components/SetupRunePages';
import { SetupSpells } from '../components/SetupSpells';
import { SetupStarters } from '../components/SetupStarters';
import { ROLE_ORDER } from '../config';
import { loadChampionIconVersion } from '../data/champion-icons';
import {
  loadChampionCatalog,
  loadPickData,
  type ChampionCatalog,
  type PickData,
} from '../data/export-data';
import { buildItemIndex, loadItemCatalog, type ItemIconInfo } from '../data/items';
import { buildRuneIconIndex, loadRuneCatalog, type RuneIconInfo } from '../data/runes';
import { loadSetupRoles } from '../data/setup-roles';
import { loadSetupRunes } from '../data/setup-runes';
import { loadSetupSpells } from '../data/setup-spells';
import { loadSetupStarters } from '../data/setup-starters';
import type { ProfileLoad } from '../profile/profile-export';
import { strings } from '../strings';

const DEFAULT_RANK: Rank = 'DIAMOND';
const SETUP_MODES: readonly SetupMode[] = ['topPlayers', 'myData'];
const EMPTY_ICONS: ReadonlyMap<number, RuneIconInfo> = new Map();
const EMPTY_ITEMS: ReadonlyMap<number, ItemIconInfo> = new Map();

export interface SetupScreenProps {
  /** Role picked on the pick screen; used as the initial setup role. */
  preferredRole?: Role | null;
  /**
   * BL-058: locked champion and draft slots reported by the pick screen.
   * Prefills the champion/rank and feeds the draft context of the setup
   * queries; absent or empty means no draft context (pre-BL-058 behavior).
   */
  draftHandoff?: DraftHandoff;
  /** Bumped each time the launch data download settles; triggers reloads. */
  dataReadyNonce: number;
  profileLoad: ProfileLoad;
  /** One-line profile status shown under "my data" when no export loaded. */
  profileStatus?: string;
}

export function SetupScreen({
  preferredRole = null,
  draftHandoff,
  dataReadyNonce,
  profileLoad,
  profileStatus,
}: SetupScreenProps) {
  // undefined = verdict pending, null = no cached release, [] = no full role.
  const [setupRoles, setSetupRoles] = useState<readonly Role[] | null | undefined>(undefined);
  const [role, setRole] = useState<Role>(preferredRole ?? 'SUPPORT');
  // BL-058: the pick screen's locked champion and rank prefill the setup
  // selection; the sync effects below re-apply them whenever the handoff
  // changes (including the empty report after a new-game remount).
  const handoffChampionId = draftHandoff?.championId ?? null;
  const handoffRank = draftHandoff?.draft.userRank;
  const [championId, setChampionId] = useState<ChampionId | null>(handoffChampionId);
  const [rank, setRank] = useState<Rank>(handoffRank ?? DEFAULT_RANK);
  const [mode, setMode] = useState<SetupMode>('topPlayers');
  const [masterPlus, setMasterPlus] = useState(false);
  const [pickData, setPickData] = useState<PickData | null>(null);
  const [catalog, setCatalog] = useState<ChampionCatalog | null>(null);
  const [iconVersion, setIconVersion] = useState<string | null>(null);
  const [runeTrees, setRuneTrees] = useState<RuneTrees | null>(null);
  const [itemCatalog, setItemCatalog] = useState<ReadonlyMap<number, ItemIconInfo> | null>(null);
  const [result, setResult] = useState<SetupRuneResult | null>(null);
  const [spellsResult, setSpellsResult] = useState<SetupSpellsResult | null>(null);
  const [startersResult, setStartersResult] = useState<SetupStartersResult | null>(null);
  const [spellsError, setSpellsError] = useState<string | null>(null);
  const [startersError, setStartersError] = useState<string | null>(null);
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

  // BL-058: the handoff is authoritative for the locked champion and rank —
  // a changed or emptied handoff (pick edit, new-game reset) re-applies it.
  // While the setup screen is mounted the pick screen cannot change, so a
  // manual pick on this screen is never overridden by a stale handoff.
  useEffect(() => {
    setChampionId(handoffChampionId);
  }, [handoffChampionId]);
  useEffect(() => {
    setRank(handoffRank ?? DEFAULT_RANK);
  }, [handoffRank]);

  // Role-scoped recommendation data (baselines, roleProb, tags) for the
  // engine query; null means "no cached release".
  useEffect(() => {
    let cancelled = false;
    setPickData(null);
    setResult(null);
    setSpellsResult(null);
    setStartersResult(null);
    setSpellsError(null);
    setStartersError(null);
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

  // Item catalog (`<patch>/items.json`): display-only for the starter
  // bundles, same degradation contract as the rune catalog — a missing or
  // unreadable catalog degrades to id-only bundles instead of failing the
  // starter query (unlike the fail-closed manifest files).
  useEffect(() => {
    if (dataPatch === undefined) return;
    let cancelled = false;
    void loadItemCatalog(dataPatch)
      .then((items) => {
        if (!cancelled) setItemCatalog(items === null ? null : buildItemIndex(items));
      })
      .catch(() => {
        if (!cancelled) setItemCatalog(null);
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
  const items = useMemo(() => itemCatalog ?? EMPTY_ITEMS, [itemCatalog]);

  // BL-058: draft slots, bans and pool come from the pick screen's handoff
  // when present; the screen's own role/rank stay authoritative. Without a
  // handoff allies/enemies stay empty so lane/matchup contexts simply do
  // not match and pages resolve at the broader labeled levels.
  const draft: DraftInput = useMemo(
    () => setupDraftInput(draftHandoff, role, rank),
    [draftHandoff, role, rank],
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

  // Mode switch re-queries the chosen source for every setup section
  // (BL-030b runes, BL-031b summoners + starters): each loader re-reads its
  // per-champion export only for topPlayers and re-aggregates the profile
  // for myData, with no restart and no hidden state (D-134). The three
  // queries run together on the same inputs; each section keeps its own
  // error state so one corrupt export cannot hide the others (fail-closed
  // per file, like the rune loader).
  useEffect(() => {
    if (championId === null || pickData === null) {
      setResult(null);
      setSpellsResult(null);
      setStartersResult(null);
      setSpellsError(null);
      setStartersError(null);
      setQueryPending(false);
      return;
    }
    let cancelled = false;
    setQueryPending(true);
    const base = {
      mode,
      championId,
      draft,
      pickData,
      ...(profile !== undefined ? { profile } : {}),
      config: runeConfig,
    } as const;
    void Promise.allSettled([
      loadSetupRunes(base),
      loadSetupSpells(base),
      loadSetupStarters(base),
    ]).then(([runes, spells, starters]) => {
      if (cancelled) return;
      if (runes.status === 'fulfilled') {
        setResult(runes.value);
        setLoadError(null);
      } else {
        setResult(null);
        setLoadError(runes.reason instanceof Error ? runes.reason.message : String(runes.reason));
      }
      if (spells.status === 'fulfilled') {
        setSpellsResult(spells.value);
        setSpellsError(null);
      } else {
        setSpellsResult(null);
        setSpellsError(
          spells.reason instanceof Error ? spells.reason.message : String(spells.reason),
        );
      }
      if (starters.status === 'fulfilled') {
        setStartersResult(starters.value);
        setStartersError(null);
      } else {
        setStartersResult(null);
        setStartersError(
          starters.reason instanceof Error ? starters.reason.message : String(starters.reason),
        );
      }
      setQueryPending(false);
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
          ) : (
            <div className="space-y-8">
              {loadError !== null ? (
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
              {spellsError !== null ? (
                <p className="text-red-600 dark:text-red-400">{strings.loadFailed(spellsError)}</p>
              ) : spellsResult !== null ? (
                <SetupSpells
                  result={spellsResult}
                  championName={selectedName ?? strings.championFallback(championId)}
                  roleName={strings.roleNames[spellsResult.myRole]}
                  {...(profileLabel !== undefined ? { profileLabel } : {})}
                />
              ) : null}
              {startersError !== null ? (
                <p className="text-red-600 dark:text-red-400">
                  {strings.loadFailed(startersError)}
                </p>
              ) : startersResult !== null ? (
                <SetupStarters
                  result={startersResult}
                  championName={selectedName ?? strings.championFallback(championId)}
                  roleName={strings.roleNames[startersResult.myRole]}
                  {...(profileLabel !== undefined ? { profileLabel } : {})}
                  items={items}
                  iconVersion={iconVersion}
                />
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
