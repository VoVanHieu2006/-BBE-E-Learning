export function normalizeStarHistoryPagination(
  pageValue: string | null,
  limitValue: string | null,
  itemCount: number,
) {
  const requestedPage = Number(pageValue || 1)
  const requestedLimit = Number(limitValue || 20)
  const safePage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 50)
    : 20
  const safeItemCount = Number.isSafeInteger(itemCount) && itemCount > 0 ? itemCount : 0
  const totalPages = Math.ceil(safeItemCount / limit)

  return {
    page: totalPages === 0 ? 1 : Math.min(safePage, totalPages),
    limit,
    totalPages,
  }
}
