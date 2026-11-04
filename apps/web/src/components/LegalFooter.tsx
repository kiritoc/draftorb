/**
 * @draftorb/web — Legal footer.
 *
 * DraftOrb is a free, unofficial League of Legends tool. It is not endorsed
 * by Riot Games and does not scrape third-party stats sites.
 */

export function LegalFooter() {
  return (
    <footer className="border-t border-gray-800 bg-gray-900 mt-auto">
      <div className="max-w-7xl mx-auto px-6 py-4 text-xs text-gray-500">
        <p className="mb-1">
          DraftOrb &mdash; a free League of Legends draft and itemization assistant.
        </p>
        <p>
          Not endorsed or sponsored by Riot Games. Champion, item and rune data comes from Data
          Dragon and CommunityDragon; match data comes from the Riot Games API with a personal
          development key.
        </p>
      </div>
    </footer>
  );
}
