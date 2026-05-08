-- ============================================================
-- 🔒 Karpus Kids — Production Security & Audit Fixes
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- ── 1. TABLA DE AUDITORÍA INMUTABLE ──────────────────────────
-- Registra cada cambio en pagos de forma que no se puede borrar
CREATE TABLE IF NOT EXISTS public.payment_audit_log (
  id            bigserial PRIMARY KEY,
  payment_id    bigint       NOT NULL,
  action        text         NOT NULL, -- 'approved', 'rejected', 'deleted', 'mora_waived', 'created', 'updated'
  actor_id      uuid         REFERENCES public.profiles(id),
  actor_name    text,
  actor_role    text,
  old_status    text, -- Estado anterior del pago
  new_status    text, -- Nuevo estado del pago
  changed_at    timestamp with time zone DEFAULT now() NOT NULL -- Fecha y hora del cambio
);