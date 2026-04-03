-- ============================================================
-- 🚀 Karpus Kids — Scalability RPCs
-- Funciones que reemplazan múltiples queries con una sola llamada
-- ============================================================

-- ── Dashboard KPIs en una sola query ─────────────────────────
-- Reemplaza 6 queries paralelas con 1 RPC
CREATE OR REPLACE FUNCTION get_dashboard_kpis(p_month text DEFAULT '%')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_students 