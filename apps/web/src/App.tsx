import { useEffect, useState } from 'react';

import { loadLatest, loadManifest, loadExportFiles } from './data/loader';
import { strings } from './strings';

export function App() {
  const [patch, setPatch] = useState<string | null>(null);
  const [roles, setRoles] = useState<readonly string[]>([]);
  const [fileCount, setFileCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const latest = await loadLatest();
        const manifest = await loadManifest(latest.patch);
        const loaded = await loadExportFiles(manifest);
        if (cancelled) {
          return;
        }
        setPatch(loaded.patch);
        setRoles(manifest.roles);
        setFileCount(Object.keys(loaded.files).length);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="p-6 text-center text-red-400">
        <h1 className="text-xl font-bold">{strings.appTitle}</h1>
        <p>
          {strings.loadFailed} {error}
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 min-h-screen bg-gray-900 text-gray-100">
      <h1 className="text-2xl font-bold text-indigo-400">{strings.appTitle}</h1>
      {patch === null ? (
        <p className="mt-2 text-gray-400">{strings.loading}</p>
      ) : (
        <>
          <p className="mt-2 text-gray-400">
            {strings.patchLabel}: <span className="font-mono">{patch}</span>
          </p>
          <p className="text-gray-400">
            {strings.rolesLabel}: {strings.rolesLabelPlural(roles)}
          </p>
          <p className="text-gray-400">{strings.filesLoaded(fileCount)}</p>
        </>
      )}
    </div>
  );
}
