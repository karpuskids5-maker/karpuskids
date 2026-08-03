-- ============================================================
-- KARPUS KIDS — Arquitectura V8: Catálogo de Eventos
-- Agrega la categoría del catálogo a la configuración del
-- schedule por aula (classroom_event_schedule).
--
-- Las categorías y el universo de eventos viven en el frontend
-- (EVENT_CATALOG en js/maestra/modules/routine.js). Este script
-- solo persiste la categoría de cada evento configurado para
-- permitir agrupar en el timeline, reportes y panel padre.
-- ============================================================

-- 1. Columna category (si no existe)
ALTER TABLE public.classroom_event_schedule
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'personalizados';

-- 2. Índice para búsquedas por categoría
CREATE INDEX IF NOT EXISTS idx_event_schedule_category
  ON public.classroom_event_schedule(category);

-- 3. Backfill: categorías conocidas para eventos existentes
UPDATE public.classroom_event_schedule
SET category = CASE event_type
  WHEN 'desayuno'          THEN 'alimentacion'
  WHEN 'almuerzo'          THEN 'alimentacion'
  WHEN 'merienda'          THEN 'alimentacion'
  WHEN 'biberon'           THEN 'alimentacion'
  WHEN 'agua'              THEN 'alimentacion'
  WHEN 'fruta'             THEN 'alimentacion'
  WHEN 'picada'            THEN 'alimentacion'
  WHEN 'animo'             THEN 'animo'
  WHEN 'temperatura'       THEN 'salud'
  WHEN 'medicamento'       THEN 'salud'
  WHEN 'medicamento_extra' THEN 'salud'
  WHEN 'fiebre'            THEN 'salud'
  WHEN 'malestar'          THEN 'salud'
  WHEN 'curacion'          THEN 'salud'
  WHEN 'siesta'            THEN 'descanso'
  WHEN 'descanso_corto'    THEN 'descanso'
  WHEN 'panal_humedo'      THEN 'higiene'
  WHEN 'panal_sucio'       THEN 'higiene'
  WHEN 'bano'              THEN 'higiene'
  WHEN 'cepillado'         THEN 'higiene'
  WHEN 'lavado_manos'      THEN 'higiene'
  WHEN 'crema'             THEN 'higiene'
  WHEN 'actividad'         THEN 'actividades'
  WHEN 'manualidad'        THEN 'actividades'
  WHEN 'musica'            THEN 'actividades'
  WHEN 'baile'             THEN 'actividades'
  WHEN 'gimnasia'          THEN 'actividades'
  WHEN 'patio'             THEN 'juego'
  WHEN 'juego_libre'       THEN 'juego'
  WHEN 'juegos_mesa'       THEN 'juego'
  WHEN 'construccion'      THEN 'juego'
  WHEN 'bienvenida'        THEN 'social'
  WHEN 'convivencia'       THEN 'social'
  WHEN 'compartir'         THEN 'social'
  WHEN 'emociones'         THEN 'social'
  WHEN 'proyecto'          THEN 'aprendizaje'
  WHEN 'lectura'           THEN 'aprendizaje'
  WHEN 'escritura'         THEN 'aprendizaje'
  WHEN 'matematicas'       THEN 'aprendizaje'
  WHEN 'ciencias'          THEN 'aprendizaje'
  WHEN 'idiomas'           THEN 'aprendizaje'
  WHEN 'paseo'             THEN 'exterior'
  WHEN 'huerta'            THEN 'exterior'
  WHEN 'juegos_agua'       THEN 'exterior'
  WHEN 'accidente'         THEN 'incidentes'
  WHEN 'golpe'             THEN 'incidentes'
  WHEN 'pelea'             THEN 'incidentes'
  WHEN 'llamada_padres'    THEN 'incidentes'
  WHEN 'otro_incidente'    THEN 'incidentes'
  WHEN 'nota'              THEN 'personalizados'
  WHEN 'cumpleanos'        THEN 'personalizados'
  WHEN 'evento_especial'   THEN 'personalizados'
  WHEN 'otro'              THEN 'personalizados'
  ELSE category
END
WHERE category = 'personalizados' OR category IS NULL;
