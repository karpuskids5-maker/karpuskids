-- ══════════════════════════════════════════════════════════════
-- Eliminar áreas creadas automáticamente por aula y desactivar el
-- mecanismo de auto-creación (trigger + backfill).
--
-- A partir de ahora la maestra será quien cree las áreas de su aula
-- (feature pendiente). La directora tampoco crea áreas.
--
-- ⚠️ EL DELETE EN CASCADA TAMBIÉN BORRA LAS ACTIVIDADES Y NOTAS DE
--    ESAS ÁREAS (FK: subjects -> period_config -> activities -> grades,
--    todas con ON DELETE CASCADE).
-- ══════════════════════════════════════════════════════════════

-- 1) Eliminar las áreas por aula (classroom_id NOT NULL).
DELETE FROM public.subjects
WHERE classroom_id IS NOT NULL;

-- 2) Quitar el trigger que crea áreas al insertar un aula
DROP TRIGGER IF EXISTS trg_classroom_auto_areas ON public.classrooms;
DROP FUNCTION IF EXISTS public.classroom_after_insert_areas();

-- 3) Quitar la función de aprovisionamiento (ya nadie la usa)
DROP FUNCTION IF EXISTS public.ensure_classroom_areas(bigint);
