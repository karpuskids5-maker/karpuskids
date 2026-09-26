-- ============================================================================
-- DIAGNÓSTICO (SOLO LECTURA) — pagos que no aparecen en el panel del padre
-- Pegar en Supabase → SQL Editor y ejecutar. No modifica nada.
-- ============================================================================

-- [1] ¿Se aplicaron las migraciones 10/11? Si el CHECK de status no existe,
--      la base tiene el vocabulario viejo y puede haber 'approved'/'pagado'.
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.payments'::regclass
  AND contype = 'c'
ORDER BY conname;

-- [2] FORMATOS DE month_paid REALMENTE EN LA BASE.
--      La lógica de periodo (migración 10) compara month_paid como TEXTO contra
--      '2026-08'. En ASCII las minúsculas (0x61-0x7A) ordenan después de los
--      dígitos (0x30-0x39), así que un nombre en español siempre pasa:
--        'mayo'   >= '2026-08'  -> TRUE  ('m'=0x6D > '2'=0x32; no se archiva)
--        '2026-05' >= '2026-08' -> FALSE (se archiva con deleted_at)
--      Mismo mes, resultado opuesto según el formato. Esto es la inconsistencia.
SELECT month_paid,
       (month_paid >= '2026-08') AS pasa_el_piso,
       (month_paid <  '2026-08') AS seria_archivado,
       count(*) AS filas
FROM public.payments
WHERE deleted_at IS NULL
GROUP BY month_paid
ORDER BY month_paid NULLS FIRST;

-- [3] LOS PAGOS EN CUESTIÓN: agosto y mayo, de cualquier formato.
--      deleted_at IS NOT NULL  -> la migración 10 los anuló (fuera de RLS,
--                                 vistas y totales). Es el motivo #1 de que
--                                 el panel no los muestre: el panel filtra
--                                 .is('deleted_at', null).
SELECT p.id,
       p.student_id,
       s.name                AS estudiante,
       p.status,
       p.month_paid,
       p.due_date,
       p.paid_date,
       p.amount,
       p.concept,
       p.deleted_at,
       CASE
         WHEN p.status = 'paid' AND p.deleted_at IS NULL THEN 'OK: debería verse'
         WHEN p.deleted_at IS NOT NULL                    THEN 'OCULTO: anulado por la migración 10 (piso 2026-08)'
         WHEN p.status IN ('pending','review','overdue') AND p.month_paid < '2026-08'
                                                            THEN 'OCULTO: pre-piso y no pagado'
         ELSE 'visible: el problema NO es el periodo'
       END AS diagnostico
FROM public.payments p
LEFT JOIN public.students s ON s.id = p.student_id
WHERE p.month_paid ILIKE '%agosto%'
   OR p.month_paid ILIKE '%mayo%'
   OR p.month_paid IN ('2026-08', '2026-05')
ORDER BY p.month_paid, p.created_at DESC;

-- [4] ¿El pago pertenece al estudiante que el padre está viendo?
--      El panel hace .eq('student_id', this._studentId) Y la policy de SELECT
--      exige is_family_member(student_id). Si el pago colga de otro
--      student_id, no aparece por más que esté pagado.
--      Comparar estos emails con la cuenta del padre.
SELECT s.id                AS student_id,
       s.name,
       s.parent_id,
       s.p1_email,
       s.p2_email,
       s.deleted_at,
       (SELECT count(*) FROM public.payments p
         WHERE p.student_id = s.id AND p.deleted_at IS NULL) AS pagos_visibles
FROM public.students s
ORDER BY s.name;

-- [5] ¿Hubo archivado masivo? La migración 10 deja rastro en audit_logs.
SELECT created_at, action, payload
FROM public.audit_logs
WHERE action = 'payment.pre_floor_cleared'
ORDER BY created_at DESC
LIMIT 5;
