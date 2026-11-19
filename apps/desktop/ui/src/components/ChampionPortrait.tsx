import { useState } from 'react';

export type PortraitSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<PortraitSize, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-12 w-12 text-base',
  lg: 'h-16 w-16 text-xl',
};

/** Initials of up to two words, uppercase; "?" for an empty name. */
export function championInitials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  return letters === '' ? '?' : letters;
}

/** Whether to render the image: a URL exists and it has not failed to load. */
export function shouldShowImage(iconUrl: string | null, failedUrl: string | null): boolean {
  return iconUrl !== null && iconUrl !== failedUrl;
}

export interface ChampionPortraitProps {
  name: string;
  iconUrl: string | null;
  size?: PortraitSize;
}

/**
 * Champion icon with an initials fallback (missing URL, offline or load error;
 * never a broken image). Recommendation cards, draft slots, the pool editor
 * and the ban list will use it (BL-016b/BL-022).
 */
export function ChampionPortrait({ name, iconUrl, size = 'md' }: ChampionPortraitProps) {
  // Track the URL that failed (not a boolean) so a new iconUrl is retried.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const box = `${SIZE_CLASS[size]} shrink-0 rounded-lg`;
  if (iconUrl !== null && shouldShowImage(iconUrl, failedUrl)) {
    return (
      <img
        src={iconUrl}
        alt={name}
        loading="lazy"
        onError={() => setFailedUrl(iconUrl)}
        className={`${box} bg-slate-200 object-cover dark:bg-slate-700`}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={`${box} inline-flex items-center justify-center bg-slate-200 font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200`}
    >
      {championInitials(name)}
    </span>
  );
}
