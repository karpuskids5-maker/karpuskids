-- ============================================================================
-- 16. Políticas RLS para terms_acceptance
-- ----------------------------------------------------------------------------
-- La tabla tenía RLS habilitado (09_rls_policies.sql) pero SIN políticas.
-- Con RLS activo y sin políticas, los usuarios autenticados no pueden leer ni
-- insertar sus propias aceptaciones. Efecto: el guard de los paneles nunca
-- encuentra el registro de términos y redirige en bucle a
-- login.html?reason=terms, impidiendo el acceso al panel.
-- ============================================================================

ALTER TABLE public.terms_acceptance ENABLE ROW LEVEL SECURITY;

-- Leer: cada usuario ve su propia aceptación; el personal directivo ve todas.
DROP POLICY IF EXISTS "terms_acceptance_select_own" ON public.terms_acceptance;
CREATE POLICY "terms_acceptance_select_own" ON public.terms_acceptance
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.get_my_role() IN ('directora', 'asistente', 'admin')
  );

-- Registrar: solo la propia aceptación.
DROP POLICY IF EXISTS "terms_acceptance_insert_own" ON public.terms_acceptance;
CREATE POLICY "terms_acceptance_insert_own" ON public.terms_acceptance
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Actualizar (upsert con ON CONFLICT DO UPDATE): solo la propia aceptación.
DROP POLICY IF EXISTS "terms_acceptance_update_own" ON public.terms_acceptance;
CREATE POLICY "terms_acceptance_update_own" ON public.terms_acceptance
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Borrar: solo dirección/admin.
DROP POLICY IF EXISTS "terms_acceptance_delete_admin" ON public.terms_acceptance;
CREATE POLICY "terms_acceptance_delete_admin" ON public.terms_acceptance
  FOR DELETE TO authenticated
  USING (public.get_my_role() IN ('directora', 'admin'));
