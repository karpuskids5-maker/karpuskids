-- ═══════════════════════════════════════════════════════════════════════════
-- 21 · CONTROL TOTAL — ANALÍTICA REAL DE ACCESOS + KPIs CORREGIDOS
-- Karpus Kids · Panel de Control
-- ═══════════════════════════════════════════════════════════════════════════
-- Objetivo:
--   1. get_login_stats() → estadísticas REALES de logins a partir de
--      login_attempts (la única tabla que registra cada ingreso), que es la
--      fuente que el panel de control NO podía leer (RLS solo INSERT).
--      Responde: "¿cuál es el usuario que más ingresa y cuántas veces por
--      semana y mes?" usando data real, no auditoría decorativa.
--   2. get_dashboard_kpis corregido: los pagos en estado 'review' (en
--      revisión) ahora cuentan dentro de los pendientes.
--   3. Política SELECT de login_attempts NO se abre a la API (seguridad);
--      toda lectura pasa por el RPC SECURITY DEFINER (solo directora/admin).
--
-- Es idempotente: CREATE OR REPLACE / GRANT. Ejecutar en Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 21.1 · RPC get_login_stats() — Logins reales por usuario (7d y 30d)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_login_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_role      text;
  v_7d_start  timestamptz := now() - INTERVAL '7 days';
  v_30d_start timestamptz := now() - INTERVAL '30 days';
  v_today     date := current_date;
  v_tot7      bigint;
  v_tot30     bigint;
  v_today_n   bigint;
  v_users7    bigint;
  v_users30   bigint;
  v_peak_hour int;
  v_result    jsonb;
BEGIN
  SELECT get_my_role() INTO v_role;
  IF v_role IS DISTINCT FROM 'directora' AND v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/admin';
  END IF;

  SELECT count(*) INTO v_tot7   FROM public.login_attempts WHERE success AND created_at >= v_7d_start;
  SELECT count(*) INTO v_tot30  FROM public.login_attempts WHERE success AND created_at >= v_30d_start;
  SELECT count(*) INTO v_today_n FROM public.login_attempts WHERE success AND created_at >= v_today::timestamptz;
  SELECT count(DISTINCT email)  INTO v_users7  FROM public.login_attempts WHERE success AND created_at >= v_7d_start;
  SELECT count(DISTINCT email)  INTO v_users30 FROM public.login_attempts WHERE success AND created_at >= v_30d_start;

  SELECT EXTRACT(hour FROM created_at)::int INTO v_peak_hour
  FROM public.login_attempts
  WHERE success AND created_at >= v_7d_start
  GROUP BY EXTRACT(hour FROM created_at)
  ORDER BY count(*) DESC
  LIMIT 1;

  -- Per-user agregado (7d / 30d / último acceso / hora más frecuente)
  SELECT COALESCE(jsonb_agg(u ORDER BY u->>'l7' DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'user_id', p.id,
      'name',    COALESCE(p.name, split_part(la.email, '@', 1)),
      'email',   la.email,
      'role',    COALESCE(p.role, 'sin_perfil'),
      'l7',      count(*) FILTER (WHERE la.created_at >= v_7d_start),
      'l30',     count(*) FILTER (WHERE la.created_at >= v_30d_start),
      'last_login', (extract(epoch FROM max(la.created_at)) * 1000)::bigint,
      'peak_hour', (
        SELECT EXTRACT(hour FROM x.created_at)::text
        FROM public.login_attempts x
        WHERE x.email = la.email AND x.success
        GROUP BY 1 ORDER BY count(*) DESC LIMIT 1
      )
    ) u
    FROM public.login_attempts la
    LEFT JOIN public.profiles p ON lower(p.email) = lower(la.email)
    WHERE la.success AND la.created_at >= v_30d_start
    GROUP BY la.email, p.id, p.name, p.role
  ) t;

  RETURN jsonb_build_object(
    'totals', jsonb_build_object(
      'logins_7d',    v_tot7,
      'logins_30d',   v_tot30,
      'logins_today', v_today_n,
      'users_7d',     v_users7,
      'users_30d',    v_users30,
      'peak_hour',    v_peak_hour
    ),
    'users', v_result
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_login_stats() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 21.2 · RPC get_login_series() — serie diaria por rol + distribución horaria
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_login_series()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_role text;
  v_daily jsonb;
  v_hour  jsonb;
  v_hour_today jsonb;
BEGIN
  SELECT get_my_role() INTO v_role;
  IF v_role IS DISTINCT FROM 'directora' AND v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/admin';
  END IF;

  -- Diario por rol (últimos 7 días)
  SELECT COALESCE(jsonb_agg(row_item), '[]'::jsonb) INTO v_daily
  FROM (
    SELECT jsonb_build_object(
      'day',       d.day,
      'rol',       COALESCE(p.role, 'sin_perfil'),
      'count',     g.n
    ) AS row_item
    FROM (
      SELECT created_at::date AS day, email, count(*) AS n
      FROM public.login_attempts
      WHERE success AND created_at >= now() - INTERVAL '7 days'
      GROUP BY 1, 2
    ) g
    LEFT JOIN public.profiles p ON lower(p.email) = lower(g.email)
    RIGHT JOIN LATERAL generate_series(current_date - 6, current_date, interval '1 day') AS d(day)
      ON d.day = g.day
  ) t;

  -- Horaria (últimos 7 días)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('hour', h, 'count', n) ORDER BY h), '[]'::jsonb) INTO v_hour
  FROM (
    SELECT EXTRACT(hour FROM created_at)::int AS h, count(*) AS n
    FROM public.login_attempts
    WHERE success AND created_at >= now() - INTERVAL '7 days'
    GROUP BY 1
  ) t;

  -- Horaria (hoy)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('hour', h, 'count', n) ORDER BY h), '[]'::jsonb) INTO v_hour_today
  FROM (
    SELECT EXTRACT(hour FROM created_at)::int AS h, count(*) AS n
    FROM public.login_attempts
    WHERE success AND created_at >= current_date::timestamptz
    GROUP BY 1
  ) t;

  RETURN jsonb_build_object(
    'daily',       v_daily,
    'hourly',      v_hour,
    'hourly_today', v_hour_today
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_login_series() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 21.3 · get_dashboard_kpis corregido — 'review' cuenta en pendientes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_month text DEFAULT '%')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_students   int;
  v_teachers   int;
  v_classrooms int;
  v_attendance int;
  v_pending    numeric;
  v_review_count int;
  v_incidents  int;
  v_today      date := current_date;
BEGIN
  v_students   := (SELECT count(*)::int FROM public.students WHERE is_active = true);
  v_teachers   := (SELECT count(*)::int FROM public.profiles WHERE role IN ('maestra','asistente'));
  v_classrooms := (SELECT count(*)::int FROM public.classrooms);
  v_attendance := (SELECT count(*)::int FROM public.attendance WHERE date = v_today AND status IN ('present','late'));
  v_pending    := COALESCE((SELECT sum(amount) FROM public.payments
                            WHERE status IN ('pending','overdue','review','pendiente','vencido')
                              AND deleted_at IS NULL), 0);
  v_review_count := COALESCE((SELECT count(*)::int FROM public.payments
                              WHERE status = 'review' AND deleted_at IS NULL), 0);
  v_incidents  := COALESCE((SELECT count(*)::int FROM public.inquiries WHERE status NOT IN ('resolved','closed')), 0);

  RETURN jsonb_build_object(
    'total',          v_students,
    'active',         v_students,
    'teachers',       v_teachers,
    'classrooms',     v_classrooms,
    'attendance_today', v_attendance,
    'pending_payments', v_pending,
    'pending_amount',   v_pending,
    'review_count',     v_review_count,
    'inquiries',        v_incidents
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_dashboard_kpis(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 21.4 · Sanidad — verifica la migración
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT public.get_login_stats() IS NOT NULL AS rpc_ok;