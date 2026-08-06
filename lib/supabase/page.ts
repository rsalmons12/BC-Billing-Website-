// Fetch ALL rows from a query, paging past PostgREST's 1000-row default cap.
// `build(from, to)` should return a Supabase range query, e.g.:
//   selectAll((f, t) => supabase.from("claims").select("*").eq("present", true).range(f, t))
//
// Pages are fetched in parallel WAVES (not one-at-a-time), so loading a large
// table costs a few round-trips instead of one per 1,000 rows. Ranges are
// contiguous and PostgREST only ever returns a short page at the very end, so a
// wave that contains a short page is the last one — nothing is skipped.
export async function selectAll<T>(
  build: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
  concurrency = 5
): Promise<T[]> {
  const out: T[] = [];

  const fetchPage = async (page: number): Promise<T[]> => {
    const from = page * pageSize;
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  for (let base = 0; ; base += concurrency) {
    const wave = await Promise.all(
      Array.from({ length: concurrency }, (_, i) => fetchPage(base + i))
    );
    let reachedEnd = false;
    for (const rows of wave) {
      out.push(...rows);
      if (rows.length < pageSize) reachedEnd = true; // a short page = last page
    }
    if (reachedEnd) break;
  }
  return out;
}
