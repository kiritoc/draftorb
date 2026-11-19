import { profileExportSchema, profileIndexSchema, type ProfileExport } from '@draftorb/shared';
import { strings } from '../strings';
import { invokeCommand, isTauri } from '../tauri';

export type ProfileLoad =
  | { kind: 'none'; reason: 'noFolder' | 'missing' }
  | { kind: 'invalid'; notice: string }
  | { kind: 'loaded'; profile: ProfileExport };

type Read = { ok: true; text: string | null } | { ok: false; notice: string };

async function readFile(repoFolder: string, fileName: string): Promise<Read> {
  try {
    const text = await invokeCommand<string | null>('read_profile_file', { repoFolder, fileName });
    return { ok: true, text };
  } catch {
    return { ok: false, notice: strings.profileInvalid(fileName, strings.profileReasonRead) };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** SPECS §19.2: index.json, first entry (D-118), then its file. Never throws. */
export async function loadProfileExport(repoFolder: string | undefined): Promise<ProfileLoad> {
  if (repoFolder === undefined || !isTauri()) return { kind: 'none', reason: 'noFolder' };

  const index = await readFile(repoFolder, 'index.json');
  if (!index.ok) return { kind: 'invalid', notice: index.notice };
  if (index.text === null) return { kind: 'none', reason: 'missing' };
  const indexJson = parseJson(index.text);
  if (indexJson === undefined) {
    return {
      kind: 'invalid',
      notice: strings.profileInvalid('index.json', strings.profileReasonJson),
    };
  }
  const parsedIndex = profileIndexSchema.safeParse(indexJson);
  if (!parsedIndex.success) {
    return {
      kind: 'invalid',
      notice: strings.profileInvalid('index.json', strings.profileReasonSchema),
    };
  }
  const entry = parsedIndex.data.profiles[0];
  if (entry === undefined) return { kind: 'none', reason: 'missing' };

  const file = await readFile(repoFolder, entry.file);
  if (!file.ok) return { kind: 'invalid', notice: file.notice };
  if (file.text === null) return { kind: 'none', reason: 'missing' };
  const fileJson = parseJson(file.text);
  if (fileJson === undefined) {
    return {
      kind: 'invalid',
      notice: strings.profileInvalid(entry.file, strings.profileReasonJson),
    };
  }
  const parsed = profileExportSchema.safeParse(fileJson);
  if (!parsed.success) {
    return {
      kind: 'invalid',
      notice: strings.profileInvalid(entry.file, strings.profileReasonSchema),
    };
  }
  return { kind: 'loaded', profile: parsed.data };
}

/** `syncedAt` is unix seconds (packages/etl/src/profile-export.ts). */
export function syncedDate(syncedAtSeconds: number): string {
  return new Date(syncedAtSeconds * 1000).toISOString().slice(0, 10);
}

export function describeProfileLoad(load: ProfileLoad): string {
  if (load.kind === 'loaded') {
    return strings.profileLoaded(
      load.profile.label,
      load.profile.gameCount,
      syncedDate(load.profile.syncedAt),
    );
  }
  if (load.kind === 'invalid') return load.notice;
  return load.reason === 'noFolder' ? strings.profileNoFolder : strings.profileMissing;
}
