/**
 * @draftorb/web — Legal footer.
 *
 * DraftOrb is a free, unofficial League of Legends tool. It is not endorsed
 * by Riot Games and does not scrape third-party stats sites.
 */

import { strings } from '../strings.js';

export function LegalFooter() {
  return (
    <footer className="border-t border-gray-800 bg-gray-900 mt-auto">
      <div className="max-w-7xl mx-auto px-6 py-4 text-xs text-gray-500">
        <p className="mb-1">{strings.legalDescription}</p>
        <p>
          {strings.legalNotice}
          {strings.legalDataSource}
        </p>
      </div>
    </footer>
  );
}
