/**
 * @draftorb/web — UI strings (single source, easy to localize later).
 * Only English ships for now (CONVENTIONS.md).
 */

export const strings = {
  appTitle: 'DraftOrb',
  patchLabel: 'Patch',
  rolesLabel: 'Roles',
  loading: 'Loading data…',
  loadFailed: 'Failed to load data:',
  filesLoaded: (count: number): string => `Loaded ${count} data file(s)`,
  rolesLabelPlural: (roles: readonly string[]): string => roles.join(', ') || '(none)',
};
