-- ═══════════════════════════════════════════════════════════════
-- DIAGNÓSTICO: "Sin materias configuradas" (panel maestra)
-- Ejecuta esto en el SQL Editor de Supabase y comparte el resultado.
-- No modifica nada: solo lectura.
-- ═══════════════════════════════════════════════════════════════

-- 1) Período académico activo (el que usa el School Engine)
SELECT ap.id AS academic_period_id, ap.name, ap.start_date, ap.end_date,
       ap.status, ap.is_active, sy.name AS school_year
FROM academic_periods ap
JOIN school_years sy ON sy.id = ap.school_year_id
WHERE ap.is_active = true AND ap.status = 'open'
  AND sy.status IN ('active','enrollment','reenrollment')
ORDER BY ap.order_index
LIMIT 1;

-- 2) Todos los períodos legacy y cuántas materias tiene configuradas cada uno
SELECT p.id AS legacy_period_id, p.name, p.start_date, p.end_date,
       p.status, p.is_active, p.classroom_id,
       COUNT(pc.id) AS areas_configuradas
FROM periods p
LEFT JOIN period_config pc ON pc.period_id = p.id
GROUP BY p.id, p.name, p.start_date, p.end_date, p.status, p.is_active, p.classroom_id
ORDER BY p.start_date DESC, p.id;

-- 3) Qué id devuelve get_active_period() ahora (debe ser un legacy_period_id
--    que aparezca en el punto 2 con áreas_configuradas > 0)
SELECT get_active_period();

-- 4) Configuración que VE la maestra para ese período activo
SELECT get_period_config(
  (get_active_period()->>'id')::bigint
) AS config_visible_para_maestra;

-- 5) Si el punto 4 devuelve [] pero el punto 2 muestra áreas en otro período,
--    corre esto para ver a qué legacy_period_id resuelve cada academic_period:
SELECT ap.id AS academic_period_id, ap.name,
       resolve_period_id(ap.id) AS legacy_period_id_resuelto
FROM academic_periods ap
ORDER BY ap.order_index;
