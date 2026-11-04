import { DraftScreen } from './components/DraftScreen.js';
import { UnvalidatedModelBanner } from './components/UnvalidatedModelBanner.js';
import { LegalFooter } from './components/LegalFooter.js';

export function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <UnvalidatedModelBanner />
      <main className="flex-1">
        <DraftScreen />
      </main>
      <LegalFooter />
    </div>
  );
}
