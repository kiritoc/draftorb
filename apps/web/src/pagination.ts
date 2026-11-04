/**
 * @draftorb/web — Pagination helper (pure).
 *
 * Splits a flat list into fixed-size pages. Used by the recommendations and
 * pool lists so "Show N more" reveals exactly one page at a time until the
 * list is exhausted (SPECS §7.1, D-024).
 */

export function paginate<T>(items: readonly T[], pageSize: number): readonly T[][] {
  if (pageSize <= 0) {
    throw new Error(`pageSize must be positive, got ${pageSize}`);
  }
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += pageSize) {
    pages.push(items.slice(i, i + pageSize));
  }
  return pages;
}
