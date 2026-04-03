-- ============================================================
-- 🔧 KARPUS KIDS — Drop Functions Before Re-creating
-- Ejecutar ESTE SCRIPT PRIMERO en Supabase SQL Editor
-- LUEGO ejecutar production-fixes.sql
-- ============================================================

-- Eliminar funciones que tienen conflicto de tipo de retorno
DROP FUNCTION IF EXISTS public.run_payment_cycle() CASCADE;
DROP FUNCTION IF EXISTS public.get_unread_counts() CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.get_dashboard_kpis(text) CASCADE;
DROP FUNCTION IF EXISTS public.get_monthly_financial_report_by_classroom(text) CASCADE;
DROP FUNCTION IF EXISTS public.find_or_create_private_conversation(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_direct_messages(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.mark_conversation_read(bigint) CASCADE;
DROP FUNCTION IF EXISTS public.user_is_participant(bigint, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.attendance_last_7_days() CASCADE;

SELECT 'DROP completado. Ahora ejecuta production-fixes.sql' AS status;
