// Fetch ALL rows from a query, paging past PostgREST's 1000-row default cap.
// `build(from, to)` should return a Supabase range query, e.g.:
//   selectAll((f, t) => supabase.from("claims").select("*").eq("present", true).range(f, t))
export async function selectAll<T>(
  build: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
