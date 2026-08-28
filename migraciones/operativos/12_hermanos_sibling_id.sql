-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · MIGRACIÓN 12 — VINCULACIÓN DE HERMANOS (sibling_id)
-- ═══════════════════════════════════════════════════════════════════════════
-- Problema: el campo sibling_id nunca existió en la tabla students, por lo
-- que al reabrir el expediente la selección del hermano siempre aparecía vacía.
-- Esta migración agrega la columna y un índice para que el modal pueda
-- leer el hermano previamente seleccionado.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Agregar columna sibling_id (FK opcional a otro estudiante)
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS sibling_id BIGINT
    REFERENCES public.students(id) ON DELETE SET NULL;

-- 2. Índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_students_sibling_id ON public.students(sibling_id)
  WHERE sibling_id IS NOT NULL;

-- 3. Auto-resolver sibling_id desde sibling_name donde sea posible
--    (para los registros existentes que sólo tienen el nombre guardado)
UPDATE public.students s1
SET sibling_id = (
  SELECT s2.id
  FROM public.students s2
  WHERE s2.is_active = TRUE
    AND s2.deleted_at IS NULL
    AND s2.id <> s1.id
    AND LOWER(TRIM(COALESCE(s2.name,'') || ' ' || COALESCE(s2.last_name,''))) = LOWER(TRIM(s1.sibling_name))
  LIMIT 1
)
WHERE s1.has_siblings = TRUE
  AND s1.sibling_name IS NOT NULL
  AND s1.sibling_name <> ''
  AND s1.sibling_id IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN MIGRACIÓN 12
-- ═══════════════════════════════════════════════════════════════════════════
