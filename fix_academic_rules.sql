-- ============================================================
-- 🎓 REGLAS ACADÉMICAS Y DE COMUNICACIÓN 2026
-- ============================================================

-- 1. Regla: Un aula debe tener al menos un periodo para ser considerada "activa" o funcional.
-- Como la relación es period -> classroom, no podemos poner un NOT NULL en classroom.
-- Usamos una función de validación.

CREATE OR REPLACE FUNCTION public.check_classroom_has_period(p_classroom_id bigint)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.periods WHERE classroom_id = p_classroom_id);
END;
$$;

-- 2. Trigger para advertir o prevenir acciones si no hay periodo (Opcional, pero recomendado)
-- Por ahora, lo implementaremos como una política de seguridad o validación en funciones críticas.

-- 3. Asegurar que el Chat se cree Automáticamente (Refuerzo del trigger existente)
-- El trigger 'on_student_upsert_chat' ya existe en schema.sql,
-- pero vamos a asegurarnos de que el Chat de Aula exista ANTES de insertar participantes.

CREATE OR REPLACE FUNCTION public.ensure_classroom_chat_exists(p_classroom_id bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_conv_id bigint;
BEGIN
  SELECT id INTO v_conv_id FROM public.conversations
  WHERE type = 'classroom' AND classroom_id = p_classroom_id LIMIT 1;

  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (type, classroom_id)
    VALUES ('classroom', p_classroom_id)
    RETURNING id INTO v_conv_id;
  END IF;

  RETURN v_conv_id;
END;
$$;

-- 4. Modificar el trigger de chat de estudiantes para usar la función de seguridad
CREATE OR REPLACE FUNCTION public.handle_student_chat_creation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_teacher_id uuid;
  v_cls_chat bigint;
  v_dm_chat bigint;
BEGIN
  IF NEW.classroom_id IS NULL OR NEW.parent_id IS NULL THEN RETURN NEW; END IF;

  v_teacher_id := (SELECT teacher_id FROM public.classrooms WHERE id = NEW.classroom_id);
  IF v_teacher_id IS NULL THEN RETURN NEW; END IF;

  -- Asegurar chat de aula
  v_cls_chat := public.ensure_classroom_chat_exists(NEW.classroom_id);

  -- Agregar participantes al chat de aula
  INSERT INTO public.conversation_participants (conversation_id, user_id)
    VALUES (v_cls_chat, NEW.parent_id) ON CONFLICT DO NOTHING;
  INSERT INTO public.conversation_participants (conversation_id, user_id)
    VALUES (v_cls_chat, v_teacher_id) ON CONFLICT DO NOTHING;

  -- Asegurar chat privado (DM) entre Padre y Maestra
  v_dm_chat := public.find_or_create_private_conversation(NEW.parent_id, v_teacher_id);

  RETURN NEW;
END;
$$;

-- 5. Regla de Éxito: Bloquear creación de tareas si no hay periodo activo
CREATE OR REPLACE FUNCTION public.fn_validate_task_period()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.period_id IS NULL THEN
    -- Intentar asignar el periodo activo del aula automáticamente
    NEW.period_id := (SELECT id FROM public.periods WHERE classroom_id = NEW.classroom_id AND is_active = true LIMIT 1);

    IF NEW.period_id IS NULL THEN
      RAISE EXCEPTION 'No se puede crear una tarea en un aula que no tiene un periodo académico activo.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_task_period ON public.tasks;
CREATE TRIGGER trg_validate_task_period
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_task_period();
