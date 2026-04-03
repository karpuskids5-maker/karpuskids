-- ============================================================
-- 🔧 Fix: RLS para tabla comments
-- Ejecutar en Supabase SQL Editor
-- ============================================================

alter table public.comments enable row level security;

-- Leer: cualquier usuario autenticado
drop policy if exists "comments_select_all" on comments;
create policy "comments_select_all" on comments for select
  using (auth.uid() is not null);

-- Insertar: solo el propio usuario
drop policy if exists "comments_insert_own" on comments;
create policy "comments_insert_own" on comments for insert
  with check (auth.uid() = user_id);

-- Eliminar: el autor o staff (directora/maestra/asistente)
drop policy if exists "comments_delete" on comments;
create policy "comments_delete" on comments for delete
  using (
    auth.uid() = user_id
    or exists (
      select 1 from profiles
      where id = auth.uid()
      and role in ('directora', 'asistente', 'maestra')
    )
  );

select 'Comments RLS fixed ✅' as status;
