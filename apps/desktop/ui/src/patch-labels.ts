/** Verified internal major -> public major (D-117); add a verified season as one line. */
const PUBLIC_MAJOR_BY_INTERNAL_MAJOR: Readonly<Record<number, number>> = { 16: 26 };

export interface PatchLabels {
  internal: string;
  public: string | null;
}

/** Pure label transform on `major.minor`; no version ordering. */
export function patchLabels(internal: string): PatchLabels {
  const match = /^(\d+)\.(\d+)$/.exec(internal);
  if (!match) return { internal, public: null };
  const publicMajor = PUBLIC_MAJOR_BY_INTERNAL_MAJOR[Number(match[1])];
  return {
    internal,
    public: publicMajor === undefined ? null : `${publicMajor}.${match[2]}`,
  };
}
