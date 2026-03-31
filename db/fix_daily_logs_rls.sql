-- ============================================================
-- FIX: Padres can read daily_logs for their own children
-- Run in Supabase SQL Editor → New Query → Run
-- ============================================================

-- 1. Allow padres to read daily_logs for their own students
drop policy if exists "Padres leen daily_logs de sus hijos" on public.daily_logs;
create policy "Padres leen daily_logs de sus hijos" on public.daily_logs
  for select using (
    exists (
      select 1 from public.students s
      where s.id = daily_logs.student_id
        and s.parent_id = auth.uid()
    )
  );

-- 2. Allow directora and asistente to read all daily_logs
drop policy if exists "Staff lee daily_logs" on public.daily_logs;
create policy "Staff lee daily_logs" on public.daily_logs
  for select using (
    public.get_my_role() in ('directora', 'asistente')
  );
