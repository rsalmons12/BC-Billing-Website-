-- Atomic claim reservation so two collectors never get the same claim, even
-- when they load their queues at the same moment. Reserves each claim ONLY if
-- it isn't already reserved by someone else today (no stealing), and returns
-- the ids this collector actually holds.
create or replace function reserve_claims(p_ids text[], p_collector uuid, p_today date)
returns setof text
language plpgsql
security definer
set search_path = public
as $$
declare
  cid text;
begin
  foreach cid in array coalesce(p_ids, array[]::text[]) loop
    insert into claim_work (claim_id, claimed_by, claimed_at)
    values (cid, p_collector, p_today)
    on conflict (claim_id) do update
      set claimed_by = p_collector, claimed_at = p_today
      where claim_work.claimed_at is distinct from p_today
         or claim_work.claimed_by is null
         or claim_work.claimed_by = p_collector;
    -- Return the claim only if this collector now holds it today.
    if exists (
      select 1 from claim_work
      where claim_id = cid and claimed_by = p_collector and claimed_at = p_today
    ) then
      return next cid;
    end if;
  end loop;
end;
$$;

grant execute on function reserve_claims(text[], uuid, date) to authenticated;
