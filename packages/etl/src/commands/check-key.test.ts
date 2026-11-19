import { describe, expect, it } from 'vitest';

import { formatKeyCheckSuccess } from './check-key';

describe('formatKeyCheckSuccess (B-067)', () => {
  it('includes the league name when Riot returns one', () => {
    expect(formatKeyCheckSuccess('euw1', { name: "Braum's Vanguard" })).toBe(
      `Riot API key is valid! Successfully reached euw1 Challenger league ("Braum's Vanguard").`,
    );
  });

  it('omits the league name instead of printing undefined when Riot omits it', () => {
    const message = formatKeyCheckSuccess('euw1', {});
    expect(message).toBe('Riot API key is valid! Successfully reached euw1 Challenger league.');
    expect(message).not.toContain('undefined');
  });
});
