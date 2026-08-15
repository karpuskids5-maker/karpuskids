-- ── Vincular tareas didácticas a áreas (period_config) ──────────────
-- Agrega config_id a tasks para que la maestra pueda asociar una tarea
-- a la materia/área del período activo.
--
-- NOTA: period_config.id es bigint (schema legacy), así que config_id
-- debe ser bigint. Este script corrige/limpia una versión previa mal
-- tipada (uuid) si llegó a aplicarse.

-- 1. Si existe una columna uuid mal tipada, eliminarla (sin datos en ese caso)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks'
      AND column_name = 'config_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.tasks DROP COLUMN config_id;
  END IF;
END $$;

-- 2. Agregar como bigint, igual que period_config.id
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS config_id bigint REFERENCES public.period_config(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_config_id ON public.tasks (config_id);

-- El RLS sigue aplicando a la tabla tasks; el nuevo campo no abre acceso.
