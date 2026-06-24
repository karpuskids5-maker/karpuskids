-- Fix get_unread_counts to return unread counts per sender
create or replace function public.get_unread_counts()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_result  jsonb := '{}'::jsonb;
begin
  if v_user_id is null then return v_result; end if;

  -- Build a map of sender_id -> unread count
  select jsonb_object_agg(m.sender_id, m.count) into v_result
  from (
    select m.sender_id, count(*) as count
    from public.messages m
    join public.conversation_participants cp
      on cp.conversation_id = m.conversation_id
     and cp.user_id = v_user_id
    where m.sender_id <> v_user_id
      and m.is_read = false
    group by m.sender_id
  ) m;

  -- Also add a "total" key for backward compatibility
  v_result := jsonb_set(
    coalesce(v_result, '{}'::jsonb),
    '{total}',
    to_jsonb(
      coalesce(
        (select sum(count) from jsonb_each_text(coalesce(v_result, '{}'::jsonb)) as t(key, count)),
        0
      )
    )
  );

  return v_result;
end;
$$;

grant execute on function public.get_unread_counts() to authenticated;
