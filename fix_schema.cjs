const fs = require('fs');
const D = String.fromCharCode(36);
const DD = D + D;
const buf = fs.readFileSync('schema.sql');
let c = buf.toString('utf8');
if (c.charCodeAt(0) === 0xFEFF) c = c.slice(1);

// Fix get_direct_messages: ambiguous conversation_id
const oldFn = `create or replace function public.get_direct_messages(p_other_user_id uuid)
returns table (id bigint, content text, sender_id uuid, created_at timestamp with time zone, is_read boolean, conversation_id bigint)
language plpgsql security definer set search_path = public as ${DD}
declare v_conv_id bigint;
begin
  v_conv_id := (select c.id from public.conversations c
    where c.type in ('direct_message','private')
      and exists (select 1 from public.conversation_participants where conversation_id = c.id and user_id = auth.uid())
      and exists (select 1 from public.conversation_participants where conversation_id = c.id and user_id = p_other_user_id)
    limit 1);
  if v_conv_id is not null then
    return query select m.id, m.content, m.sender_id, m.created_at, m.is_read, m.conversation_id
      from public.messages m where m.conversation_id = v_conv_id order by m.created_at asc;
  else
    return query select null::bigint, null::text, null::uuid, null::timestamptz, null::boolean, null::bigint where false;
  end if;
end;
${DD};`;

const newFn = `create or replace function public.get_direct_messages(p_other_user_id uuid)
returns table (msg_id bigint, msg_content text, msg_sender_id uuid, msg_created_at timestamp with time zone, msg_is_read boolean, msg_conversation_id bigint)
language plpgsql security definer set search_path = public as ${DD}
declare v_conv_id bigint;
begin
  select c.id into v_conv_id
  from public.conversations c
  where c.type in ('direct_message','private')
    and exists (
      select 1 from public.conversation_participants cp1
      where cp1.conversation_id = c.id and cp1.user_id = auth.uid()
    )
    and exists (
      select 1 from public.conversation_participants cp2
      where cp2.conversation_id = c.id and cp2.user_id = p_other_user_id
    )
  limit 1;

  if v_conv_id is not null then
    return query
      select m.id, m.content, m.sender_id, m.created_at, m.is_read, m.conversation_id
      from public.messages m
      where m.conversation_id = v_conv_id
      order by m.created_at asc;
  else
    return query
      select null::bigint, null::text, null::uuid, null::timestamptz, null::boolean, null::bigint
      where false;
  end if;
end;
${DD};`;

if (c.includes(oldFn)) {
  c = c.replace(oldFn, newFn);
  console.log('Fixed get_direct_messages');
} else {
  const idx = c.indexOf('get_direct_messages(p_other_user_id');
  console.log('Not found. Index:', idx);
  if (idx > -1) console.log('Snippet:', JSON.stringify(c.substring(idx, idx + 200)));
}

// Also fix profiles_select to allow padres to see teacher profiles directly
const oldPolicy = `create policy "profiles_select" on public.profiles for select using (
  deleted_at is null
  and (
    auth.uid() = id
    or get_my_role() in ('directora','asistente','maestra')
    or exists (
      select 1 from public.conversation_participants cp
      where cp.user_id = auth.uid()
        and exists (
          select 1 from public.conversation_participants cp2
          where cp2.conversation_id = cp.conversation_id
            and cp2.user_id = profiles.id
        )
    )
  )
);`;

const newPolicy = `create policy "profiles_select" on public.profiles for select using (
  deleted_at is null
  and (
    auth.uid() = id
    or get_my_role() in ('directora','asistente','maestra')
    or auth.uid() is not null
  )
);`;

if (c.includes(oldPolicy)) {
  c = c.replace(oldPolicy, newPolicy);
  console.log('Fixed profiles_select: open to all authenticated users');
} else {
  console.log('profiles_select not found with expected text');
}

fs.writeFileSync('schema.sql', Buffer.from(c, 'utf8'));
console.log('Done.');
