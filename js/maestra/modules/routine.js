/**
 * ============================================================
 * RUTINA EXPRESS V4 — Panel Maestra
 * Arquitectura de 4 niveles con timeline dinámico:
 *   1. Timeline del Día (colapsable → ventana vertical / barra horizontal)
 *   2. Contenedor Colectivo
 *   3. Tarjetas de los Alumnos
 *   4. Modal Individual completo
 * Schedule configurable desde BD, diseño profesional, sync con panel padre
 * ============================================================
 */
import { supabase } from '/js/shared/supabase.js';
import { AppState } from '../state.js';
import { MaestraApi } from '../api.js';
import { UI } from './ui.js';
import { RateLimiter } from '/js/shared/rate-limiter.js';

const { safeToast, safeEscapeHTML, Modal } = UI;
const _saving = {};
let _undoTimer = null;
let _undoPayload = null;
let _bulkScheduledTime = null;
let _timelineExpanded = true;
let _classroomSchedule = [];
let _routineFilter = 'all';
let _siestaTimerInterval = null;

// ── PLANTILLAS DE COMENTARIOS FRECUENTES ──────────────────────────────────────
const COMMENT_TEMPLATES = [
  { icon: '😊', text: 'Se portó excelente hoy' },
  { icon: '🤝', text: 'Compartió juguetes con sus compañeros' },
  { icon: '🎨', text: 'Participó activamente en la actividad' },
  { icon: '📚', text: 'Mostró interés en las actividades' },
  { icon: '🍽️', text: 'Comió bien hoy' },
  { icon: '😴', text: 'Durmió toda la siesta' },
  { icon: '😢', text: 'Se mostró triste durante la mañana' },
  { icon: '🤒', text: 'Presentó malestar leve' },
  { icon: '💪', text: 'Fue muy independiente hoy' },
  { icon: '🗣️', text: 'Habló con sus compañeros' },
];

// ── AUTO-SAVE DRAFTS (localStorage) ───────────────────────────────────────────
function _draftKey(studentId) {
  const today = new Date().toISOString().split('T')[0];
  return `karpus_draft_${studentId}_${today}`;
}
function _saveDraft(studentId, data) {
  try { localStorage.setItem(_draftKey(studentId), JSON.stringify(data)); } catch (_) {}
}
function _getDraft(studentId) {
  try { const d = localStorage.getItem(_draftKey(studentId)); return d ? JSON.parse(d) : null; } catch (_) { return null; }
}
function _clearDraft(studentId) {
  try { localStorage.removeItem(_draftKey(studentId)); } catch (_) {}
}
function _autoSaveField(studentId, field, value) {
  const draft = _getDraft(studentId) || {};
  draft[field] = value;
  draft._savedAt = Date.now();
  _saveDraft(studentId, draft);
}

function _autoSaveNote(studentId, value) {
  _autoSaveField(studentId, 'notes', value);
}
window._routineAutoSaveNote = _autoSaveNote;

// ── Constantes de Eventos ─────────────────────────────────────────────────────
const EVENT_TYPES = {
  bienvenida:    { icon: '👋', label: 'Bienvenida', color: 'slate'  },
  biberon:      { icon: '🍼', label: 'Biberón',    color: 'blue'   },
  panal_humedo: { icon: '💧', label: 'Pañal 💧',   color: 'sky'    },
  panal_sucio:  { icon: '💩', label: 'Pañal 💩',   color: 'amber'  },
  siesta:       { icon: '😴', label: 'Siesta',      color: 'indigo' },
  temperatura:  { icon: '🌡️', label: 'Temperatura', color: 'rose'   },
  medicamento:  { icon: '💊', label: 'Medicamento', color: 'purple' },
  bano:         { icon: '🚽', label: 'Baño',        color: 'teal'   },
  animo:        { icon: '😊', label: 'Ánimo',       color: 'orange' },
  desayuno:     { icon: '🥐', label: 'Desayuno',    color: 'yellow' },
  actividad:    { icon: '📚', label: 'Actividad',   color: 'blue'   },
  patio:        { icon: '🌳', label: 'Patio',       color: 'green'  },
  almuerzo:     { icon: '🍽️', label: 'Almuerzo',   color: 'green'  },
  merienda:     { icon: '🍎', label: 'Merienda',    color: 'lime'   },
  nota:         { icon: '📝', label: 'Nota',        color: 'slate'  },
  cepillado:    { icon: '🪥', label: 'Cepillado',   color: 'cyan'   },
  lavado_manos: { icon: '🧼', label: 'Lavado',      color: 'sky'    },
  biberon:      { icon: '🍼', label: 'Biberón',     color: 'pink'   },
  bano:         { icon: '🚽', label: 'Baño',        color: 'blue'   },
  siesta:       { icon: '😴', label: 'Siesta',      color: 'purple' },
  bienvenida:   { icon: '👋', label: 'Bienvenida',  color: 'teal'   },
};

const DEFAULT_SCHEDULE = [
  { hour: 7,  minute: 30, label: 'Bienvenida',   type: 'bienvenida', duration: 30, autoRegister: true },
  { hour: 8,  minute: 0,  label: 'Desayuno',     type: 'desayuno',   duration: 60, autoRegister: true },
  { hour: 9,  minute: 0,  label: 'Actividad',    type: 'actividad',  duration: 30, autoRegister: true },
  { hour: 9,  minute: 30, label: 'Baño',         type: 'bano',       duration: 30, autoRegister: true },
  { hour: 10, minute: 0,  label: 'Patio',        type: 'patio',      duration: 90, autoRegister: true },
  { hour: 11, minute: 30, label: 'Almuerzo',     type: 'almuerzo',   duration: 60, autoRegister: true },
  { hour: 12, minute: 30, label: 'Siesta',       type: 'siesta',     duration: 90, autoRegister: true },
  { hour: 14, minute: 0,  label: 'Merienda',     type: 'merienda',   duration: 60, autoRegister: true },
  { hour: 15, minute: 0,  label: 'Biberón',      type: 'biberon',    duration: 30, autoRegister: true },
];

const EXTRA_EVENT_TYPES = [
  { type: 'fiebre',       icon: '🤒', label: 'Fiebre' },
  { type: 'accidente',    icon: '🩹', label: 'Accidente' },
  { type: 'golpe',        icon: '🤕', label: 'Golpe' },
  { type: 'llamada_padres', icon: '📞', label: 'Llamada a padres' },
  { type: 'medicamento_extra', icon: '💊', label: 'Medicamento' },
  { type: 'otro',         icon: '📋', label: 'Otro' },
];

// ── CATÁLOGO DE EVENTOS V8 (por categorías) ──────────────────────────────────
// Universo completo de eventos que la maestra puede habilitar en su rutina.
// Cada evento pertenece a UNA categoría. El schedule de cada aula es un
// subconjunto de este catálogo, guardado en classroom_event_schedule.
const CATEGORIES = {
  alimentacion:   { label: 'Alimentación',   icon: '🍽️', color: 'amber'   },
  animo:          { label: 'Ánimo',          icon: '😊', color: 'orange'   },
  salud:          { label: 'Salud',          icon: '🌡️', color: 'rose'     },
  descanso:       { label: 'Descanso',       icon: '😴', color: 'indigo'   },
  higiene:        { label: 'Higiene',        icon: '🧼', color: 'cyan'     },
  actividades:    { label: 'Actividades',    icon: '🎨', color: 'blue'     },
  juego:          { label: 'Juego',          icon: '🧸', color: 'green'    },
  social:         { label: 'Social',         icon: '🤝', color: 'purple'   },
  aprendizaje:    { label: 'Aprendizaje',    icon: '📚', color: 'violet'   },
  exterior:       { label: 'Exterior',       icon: '🌳', color: 'emerald'  },
  incidentes:     { label: 'Incidentes',     icon: '⚠️', color: 'red'      },
  seguridad:      { label: 'Seguridad y Salida', icon: '🛡️', color: 'red' },
  personalizados: { label: 'Personalizados', icon: '⭐', color: 'slate'    },
};

// ── GRUPOS DE EDAD ───────────────────────────────────────────────────────────
// Cada actividad del catálogo puede indicar la edad recomendada (ageGroup).
// Los eventos sin ageGroup son genéricos y aplican a todas las edades.
const AGE_GROUPS = {
  lactantes: { label: 'Lactantes',  icon: '👶', hint: '0–12 meses' },
  maternal:  { label: 'Maternal',   icon: '🧸', hint: '1–2 años'   },
  parvulos:  { label: 'Párvulos',   icon: '🎨', hint: '2–3 años'   },
  prekinder: { label: 'Pre-Kínder', icon: '📚', hint: '3–4 años'   },
  kinder:    { label: 'Kínder',     icon: '🎓', hint: '4–5 años'   },
};

const EVENT_CATALOG = [
  // Alimentación
  { type: 'desayuno',         label: 'Desayuno',        icon: '🥐', category: 'alimentacion',   defaultDuration: 60 },
  { type: 'almuerzo',         label: 'Almuerzo',        icon: '🍽️', category: 'alimentacion',   defaultDuration: 60 },
  { type: 'merienda',         label: 'Merienda',        icon: '🍎', category: 'alimentacion',   defaultDuration: 30 },
  { type: 'biberon',          label: 'Biberón',         icon: '🍼', category: 'alimentacion',   defaultDuration: 30 },
  { type: 'agua',             label: 'Agua',            icon: '💧', category: 'alimentacion',   defaultDuration: 15 },
  { type: 'fruta',            label: 'Fruta',           icon: '🍌', category: 'alimentacion',   defaultDuration: 15 },
  { type: 'picada',           label: 'Picada',          icon: '🥪', category: 'alimentacion',   defaultDuration: 30 },
  // Ánimo
  { type: 'animo',            label: 'Ánimo',           icon: '😊', category: 'animo',          defaultDuration: 15 },
  // Salud
  { type: 'temperatura',      label: 'Temperatura',     icon: '🌡️', category: 'salud',          defaultDuration: 5  },
  { type: 'medicamento',      label: 'Medicamento',     icon: '💊', category: 'salud',          defaultDuration: 5  },
  { type: 'medicamento_extra',label: 'Medicamento extra', icon: '💊', category: 'salud',        defaultDuration: 5  },
  { type: 'fiebre',           label: 'Fiebre',          icon: '🤒', category: 'salud',          defaultDuration: 5  },
  { type: 'malestar',         label: 'Malestar',        icon: '🤢', category: 'salud',          defaultDuration: 5  },
  { type: 'curacion',         label: 'Curaciones',      icon: '🩹', category: 'salud',          defaultDuration: 10 },
  // Descanso
  { type: 'siesta',           label: 'Siesta',          icon: '😴', category: 'descanso',       defaultDuration: 90 },
  { type: 'descanso_corto',   label: 'Descanso breve',  icon: '😪', category: 'descanso',       defaultDuration: 15 },
  // Higiene
  { type: 'panal_humedo',     label: 'Pañal mojado',    icon: '💧', category: 'higiene',        defaultDuration: 5  },
  { type: 'panal_sucio',      label: 'Pañal sucio',     icon: '💩', category: 'higiene',        defaultDuration: 5  },
  { type: 'bano',             label: 'Baño',            icon: '🚽', category: 'higiene',        defaultDuration: 15 },
  { type: 'cepillado',        label: 'Cepillado',       icon: '🪥', category: 'higiene',        defaultDuration: 10 },
  { type: 'lavado_manos',     label: 'Lavado de manos', icon: '🧼', category: 'higiene',        defaultDuration: 5  },
  { type: 'crema',            label: 'Crema / Solar',   icon: '🧴', category: 'higiene',        defaultDuration: 5  },
  { type: 'cambio_ropa',      label: 'Cambio de ropa',   icon: '👕', category: 'higiene',        defaultDuration: 5  },
  // Actividades
  { type: 'actividad',        label: 'Actividad',       icon: '📚', category: 'actividades',    defaultDuration: 30 },
  { type: 'manualidad',       label: 'Manualidad',      icon: '🎨', category: 'actividades',    defaultDuration: 45 },
  { type: 'musica',           label: 'Música',          icon: '🎵', category: 'actividades',    defaultDuration: 30 },
  { type: 'baile',            label: 'Baile',           icon: '💃', category: 'actividades',    defaultDuration: 30 },
  { type: 'gimnasia',         label: 'Gimnasia',        icon: '🤸', category: 'actividades',    defaultDuration: 30 },
  { type: 'gateo',            label: 'Gateo y Desplazamiento', icon: '🚼', category: 'actividades', defaultDuration: 20 },
  { type: 'masaje_infantil',  label: 'Masaje Infantil', icon: '💆', category: 'descanso',       defaultDuration: 15 },
  { type: 'texturas_sensoriales', label: 'Exploración Sensorial', icon: '🧊', category: 'actividades', defaultDuration: 30 },
  { type: 'recortado_ensamble',   label: 'Motricidad Fina', icon: '✂️', category: 'actividades', defaultDuration: 25 },
  { type: 'circuito_motor',   label: 'Circuito Psicomotor', icon: '🎪', category: 'actividades', defaultDuration: 30 },
  { type: 'modelado',         label: 'Modelado (Arcilla)', icon: '🧱', category: 'actividades', defaultDuration: 25 },
  { type: 'exposicion_arte',  label: 'Galería de Arte',  icon: '🎨', category: 'actividades',    defaultDuration: 20 },
  { type: 'orquesta_infantil', label: 'Concierto de Instrumentos', icon: '🎶', category: 'actividades', defaultDuration: 25 },
  { type: 'show_talentos',    label: 'Show de Talentos', icon: '👑', category: 'actividades',    defaultDuration: 30 },
  { type: 'foto_escolar',     label: 'Sesión Fotográfica', icon: '📸', category: 'actividades',  defaultDuration: 15 },
  { type: 'mini_cocina',      label: 'Taller de Mini Cocina', icon: '🍳', category: 'actividades', defaultDuration: 40 },
  { type: 'cine_foro',        label: 'Cine Infantil',    icon: '🎬', category: 'actividades',    defaultDuration: 45 },
  { type: 'yoga_infantil',    label: 'Yoga Infantil',    icon: '🕊️', category: 'descanso',       defaultDuration: 15 },
  { type: 'cuento_siesta',    label: 'Cuento para dormir', icon: '💤', category: 'descanso',     defaultDuration: 10 },
  // Juego
  { type: 'patio',            label: 'Patio',           icon: '🌳', category: 'juego',          defaultDuration: 60 },
  { type: 'juego_libre',      label: 'Juego libre',     icon: '🧸', category: 'juego',          defaultDuration: 45 },
  { type: 'juegos_mesa',      label: 'Juegos de mesa',  icon: '🎲', category: 'juego',          defaultDuration: 30 },
  { type: 'construccion',     label: 'Bloques',         icon: '🧱', category: 'juego',          defaultDuration: 30 },
  { type: 'puzzles',          label: 'Rompecabezas',    icon: '🧩', category: 'juego',          defaultDuration: 25 },
  { type: 'juego_motor_agil', label: 'Correr / Persecución', icon: '🏃', category: 'juego',     defaultDuration: 20 },
  // Social
  { type: 'bienvenida',       label: 'Bienvenida',      icon: '👋', category: 'social',         defaultDuration: 30 },
  { type: 'convivencia',      label: 'Convivencia',     icon: '🤝', category: 'social',         defaultDuration: 30 },
  { type: 'compartir',        label: 'Compartir',       icon: '💬', category: 'social',         defaultDuration: 20 },
  { type: 'emociones',        label: 'Emociones',       icon: '💛', category: 'social',         defaultDuration: 30 },
  { type: 'asamblea_matutina', label: 'Asamblea de Aula', icon: '💬', category: 'social',       defaultDuration: 20 },
  { type: 'dramatizacion',    label: 'Juego Simbólico', icon: '🎭', category: 'social',         defaultDuration: 30 },
  { type: 'mediacion_conflicto', label: 'Resolución de Conflictos', icon: '🤝', category: 'social', defaultDuration: 10 },
  { type: 'logro_destacado',  label: 'Refuerzo Positivo', icon: '👏', category: 'social',       defaultDuration: 5  },
  { type: 'objeto_apego',     label: 'Objeto de Transición', icon: '🧸', category: 'social',    defaultDuration: 15 },
  { type: 'intercambio_detalles', label: 'Intercambio de Detalles', icon: '🎁', category: 'social', defaultDuration: 20 },
  // Salida
  { type: 'salida',             label: 'Salida',            icon: '👋', category: 'salida',         defaultDuration: 5  },
  // Aprendizaje
  { type: 'proyecto',         label: 'Proyecto',        icon: '🎯', category: 'aprendizaje',    defaultDuration: 45 },
  { type: 'lectura',          label: 'Cuento',          icon: '📖', category: 'aprendizaje',    defaultDuration: 20 },
  { type: 'escritura',        label: 'Escritura',       icon: '✏️', category: 'aprendizaje',    defaultDuration: 20 },
  { type: 'matematicas',      label: 'Matemáticas',     icon: '🔢', category: 'aprendizaje',    defaultDuration: 30 },
  { type: 'ciencias',         label: 'Ciencias',        icon: '🔬', category: 'aprendizaje',    defaultDuration: 30 },
  { type: 'idiomas',          label: 'Idiomas',         icon: '🗣️', category: 'aprendizaje',    defaultDuration: 20 },
  { type: 'terapia_lenguaje', label: 'Terapia de Lenguaje', icon: '🗣️', category: 'aprendizaje', defaultDuration: 20 },
  { type: 'pantalla_interactiva', label: 'Tecnología Educativa', icon: '💻', category: 'aprendizaje', defaultDuration: 15 },
  { type: 'balanza_medidas',  label: 'Peso y Medidas',   icon: '⚖️', category: 'aprendizaje',    defaultDuration: 20 },
  { type: 'tesoro_mapa',      label: 'Orientación y Mapas', icon: '🧭', category: 'aprendizaje', defaultDuration: 30 },
  { type: 'biblioteca_rincon', label: 'Biblioteca',      icon: '📖', category: 'aprendizaje',    defaultDuration: 20 },
  // Exterior
  { type: 'paseo',            label: 'Paseo',           icon: '🚶', category: 'exterior',       defaultDuration: 30 },
  { type: 'huerta',           label: 'Huerta',          icon: '🌱', category: 'exterior',       defaultDuration: 20 },
  { type: 'juegos_agua',      label: 'Juegos de agua',  icon: '💦', category: 'exterior',       defaultDuration: 30 },
  { type: 'observacion_insectos_plantas', label: 'Exploración de la Naturaleza', icon: '🌿', category: 'exterior', defaultDuration: 25 },
  // Seguridad y Logística
  { type: 'simulacro_evacuacion', label: 'Simulacro de Evacuación', icon: '🚨', category: 'seguridad', defaultDuration: 15 },
  { type: 'entrega_mochila',  label: 'Entrega de Pertenencias', icon: '🧳', category: 'seguridad', defaultDuration: 10 },
  { type: 'transporte_escolar', label: 'Abordaje de Transporte', icon: '🚌', category: 'seguridad', defaultDuration: 15 },
  { type: 'recorrido_salida', label: 'Identificación de Tutor', icon: '👤', category: 'seguridad', defaultDuration: 5  },
  { type: 'lonchera_sana',    label: 'Revisión de Lonchera', icon: '🎒', category: 'seguridad',  defaultDuration: 10 },
  { type: 'distintivo_salida', label: 'Chaleco / Distintivo', icon: '🦺', category: 'seguridad', defaultDuration: 5  },
  // Higiene
  { type: 'limpieza_colaborativa', label: 'Cuidado del Aula', icon: '🧹', category: 'higiene',   defaultDuration: 15 },
  // Incidentes
  { type: 'accidente',        label: 'Accidente',       icon: '🩹', category: 'incidentes',     defaultDuration: 5  },
  { type: 'golpe',            label: 'Golpe',           icon: '🤕', category: 'incidentes',     defaultDuration: 5  },
  { type: 'pelea',            label: 'Pelea',           icon: '🤜', category: 'incidentes',     defaultDuration: 5  },
  { type: 'llamada_padres',   label: 'Llamada a padres', icon: '📞', category: 'incidentes',    defaultDuration: 5  },
  { type: 'otro_incidente',   label: 'Incidente',       icon: '⚠️', category: 'incidentes',     defaultDuration: 5  },
  // Personalizados
  { type: 'nota',             label: 'Nota',            icon: '📝', category: 'personalizados', defaultDuration: 5  },
  { type: 'cumpleanos',       label: 'Cumpleaños',      icon: '🎂', category: 'personalizados', defaultDuration: 30 },
  { type: 'fiesta_tematica',  label: 'Fiesta Temática', icon: '🎉', category: 'personalizados', defaultDuration: 60 },
  { type: 'evento_especial',  label: 'Evento especial', icon: '🎊', category: 'personalizados', defaultDuration: 60 },
  { type: 'otro',             label: 'Otro evento',     icon: '📋', category: 'personalizados', defaultDuration: 5  },
  // ════════════════════════════════════════════════════════════
  // ACTIVIDADES POR EDAD — Lactantes (0–12 meses)
  // ════════════════════════════════════════════════════════════
  { type: 'estimulacion_visual',       label: 'Estimulación visual',           icon: '👀', category: 'actividades', defaultDuration: 10, ageGroup: 'lactantes' },
  { type: 'seguimiento_objetos',       label: 'Seguimiento de objetos',        icon: '🎈', category: 'actividades', defaultDuration: 10, ageGroup: 'lactantes' },
  { type: 'estimulacion_auditiva',     label: 'Estimulación auditiva',         icon: '👂', category: 'actividades', defaultDuration: 10, ageGroup: 'lactantes' },
  { type: 'sonidos_voces',             label: 'Sonidos y voces',               icon: '🗣️', category: 'actividades', defaultDuration: 10, ageGroup: 'lactantes' },
  { type: 'canciones_bebe',            label: 'Canciones para bebés',          icon: '🎵', category: 'actividades', defaultDuration: 15, ageGroup: 'lactantes' },
  { type: 'sonajeros',                 label: 'Sonajeros',                     icon: '🪇', category: 'actividades', defaultDuration: 10, ageGroup: 'lactantes' },
  { type: 'exploracion_texturas_bebe', label: 'Exploración de texturas',        icon: '🖐️', category: 'actividades', defaultDuration: 15, ageGroup: 'lactantes' },
  { type: 'causa_efecto',              label: 'Causa y efecto',                icon: '🔘', category: 'actividades', defaultDuration: 10, ageGroup: 'lactantes' },
  { type: 'alcanzar_objetos',          label: 'Alcanzar objetos',              icon: '🤲', category: 'actividades', defaultDuration: 10, ageGroup: 'lactantes' },
  { type: 'agarre_objetos',            label: 'Agarre de objetos',             icon: '✋', category: 'actividades', defaultDuration: 10, ageGroup: 'lactantes' },
  { type: 'transferencia_objetos',     label: 'Transferencia de objetos',      icon: '🔄', category: 'actividades', defaultDuration: 10, ageGroup: 'lactantes' },
  { type: 'tummy_time',                label: 'Tummy Time',                    icon: '👶', category: 'actividades', defaultDuration: 10, ageGroup: 'lactantes' },
  { type: 'rodar',                     label: 'Rodar',                         icon: '↩️', category: 'actividades', defaultDuration: 10, ageGroup: 'lactantes' },
  { type: 'estimulacion_gateo',        label: 'Estimulación para gateo',       icon: '🚼', category: 'actividades', defaultDuration: 15, ageGroup: 'lactantes' },
  { type: 'gateo_libre',               label: 'Gateo libre',                   icon: '🐾', category: 'actividades', defaultDuration: 15, ageGroup: 'lactantes' },
  { type: 'juego_espejo',              label: 'Juego con espejo',              icon: '🪞', category: 'actividades', defaultDuration: 10, ageGroup: 'lactantes' },
  { type: 'escondidas_bebe',           label: 'Juego de escondidas',           icon: '🫥', category: 'actividades', defaultDuration: 10, ageGroup: 'lactantes' },
  { type: 'balbuceo',                  label: 'Balbuceo / Vocalización',       icon: '👄', category: 'actividades', defaultDuration: 10, ageGroup: 'lactantes' },
  // ════════════════════════════════════════════════════════════
  // MATERNAL (1–2 años)
  // ════════════════════════════════════════════════════════════
  { type: 'pintura_dedos',             label: 'Pintura con dedos',             icon: '🎨', category: 'actividades', defaultDuration: 25, ageGroup: 'maternal' },
  { type: 'pintura_esponja',           label: 'Pintura con esponja',           icon: '🧽', category: 'actividades', defaultDuration: 25, ageGroup: 'maternal' },
  { type: 'garabateo',                 label: 'Garabateo libre',               icon: '✏️', category: 'actividades', defaultDuration: 20, ageGroup: 'maternal' },
  { type: 'rasgado_papel',             label: 'Rasgado de papel',              icon: '📄', category: 'actividades', defaultDuration: 15, ageGroup: 'maternal' },
  { type: 'pegado_figuras',            label: 'Pegado de figuras',             icon: '🟦', category: 'actividades', defaultDuration: 20 },
  { type: 'plastilina',                label: 'Juego con plastilina',          icon: '🟣', category: 'actividades', defaultDuration: 25, ageGroup: 'maternal' },
  { type: 'clasificacion_objetos',     label: 'Clasificación de objetos',      icon: '🔵', category: 'aprendizaje', defaultDuration: 20 },
  { type: 'encaje',                    label: 'Juego de encajar',              icon: '🧩', category: 'actividades', defaultDuration: 20, ageGroup: 'maternal' },
  { type: 'torre_bloques',             label: 'Torre de bloques',              icon: '🧱', category: 'actividades', defaultDuration: 20, ageGroup: 'maternal' },
  { type: 'colores_basicos',           label: 'Introducción a colores',        icon: '🌈', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'maternal' },
  { type: 'animales_basicos',          label: 'Identificación de animales',    icon: '🐶', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'maternal' },
  { type: 'sonidos_animales',          label: 'Sonidos de animales',           icon: '🐮', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'maternal' },
  { type: 'canciones_movimiento',      label: 'Canciones con movimientos',     icon: '🎵', category: 'actividades', defaultDuration: 20, ageGroup: 'maternal' },
  { type: 'juegos_imitacion',          label: 'Juegos de imitación',           icon: '🪞', category: 'actividades', defaultDuration: 20, ageGroup: 'maternal' },
  { type: 'esconder_objetos',          label: 'Juego de esconder objetos',     icon: '🙈', category: 'actividades', defaultDuration: 15, ageGroup: 'maternal' },
  { type: 'buscar_objetos',            label: 'Buscar objetos',                icon: '🔎', category: 'actividades', defaultDuration: 20, ageGroup: 'maternal' },
  { type: 'trasvasar_agua',            label: 'Trasvasar agua',                icon: '💧', category: 'actividades', defaultDuration: 20, ageGroup: 'maternal' },
  { type: 'arena',                     label: 'Juegos con arena',              icon: '🏖️', category: 'actividades', defaultDuration: 25, ageGroup: 'maternal' },
  { type: 'circuito_motor_sencillo',   label: 'Circuito motor sencillo',       icon: '🤸', category: 'actividades', defaultDuration: 25, ageGroup: 'maternal' },
  { type: 'caminar_lineas',            label: 'Caminar sobre líneas',          icon: '➖', category: 'actividades', defaultDuration: 15, ageGroup: 'maternal' },
  { type: 'nombrar_objetos',           label: 'Nombrar objetos',               icon: '🗣️', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'maternal' },
  { type: 'partes_cuerpo',             label: 'Identificar partes del cuerpo', icon: '👃', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'maternal' },
  { type: 'repetir_palabras',          label: 'Repetición de palabras',        icon: '🔤', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'maternal' },
  { type: 'canciones_palabras',        label: 'Canciones de palabras',         icon: '🎵', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'maternal' },
  { type: 'cuento_imagenes',           label: 'Cuento con imágenes',           icon: '📖', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'maternal' },
  { type: 'senalar_imagenes',          label: 'Señalar imágenes',              icon: '👆', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'maternal' },
  { type: 'preguntas_simples',         label: 'Preguntas simples',             icon: '❓', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'maternal' },
  { type: 'imitacion_sonidos',         label: 'Imitación de sonidos',          icon: '🔊', category: 'aprendizaje', defaultDuration: 15 },
  // ════════════════════════════════════════════════════════════
  // PÁRVULOS (2–3 años)
  // ════════════════════════════════════════════════════════════
  { type: 'reconocimiento_colores',    label: 'Reconocimiento de colores',     icon: '🌈', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'parvulos' },
  { type: 'reconocimiento_formas',     label: 'Reconocimiento de formas',      icon: '🔺', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'parvulos' },
  { type: 'clasificacion_color',       label: 'Clasificación por color',       icon: '🎨', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'parvulos' },
  { type: 'clasificacion_tamano',      label: 'Clasificación por tamaño',      icon: '📏', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'parvulos' },
  { type: 'conteo_objetos',            label: 'Conteo de objetos',             icon: '🔢', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'parvulos' },
  { type: 'asociacion_imagenes',       label: 'Asociación de imágenes',        icon: '🖼️', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'parvulos' },
  { type: 'memoria_visual',            label: 'Memoria visual',                icon: '🧠', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'parvulos' },
  { type: 'rompecabezas_sencillos',    label: 'Rompecabezas sencillos',        icon: '🧩', category: 'juego',       defaultDuration: 25, ageGroup: 'parvulos' },
  { type: 'secuencias_simples',        label: 'Secuencias simples',            icon: '🔢', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'parvulos' },
  { type: 'grande_pequeno',            label: 'Grande y pequeño',              icon: '↕️', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'parvulos' },
  { type: 'arriba_abajo',              label: 'Arriba y abajo',                icon: '⬆️', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'parvulos' },
  { type: 'dentro_fuera',              label: 'Dentro y fuera',                icon: '📦', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'parvulos' },
  { type: 'trazos_verticales',         label: 'Trazos verticales',             icon: '✏️', category: 'actividades', defaultDuration: 15, ageGroup: 'parvulos' },
  { type: 'trazos_horizontales',       label: 'Trazos horizontales',           icon: '➖', category: 'actividades', defaultDuration: 15, ageGroup: 'parvulos' },
  { type: 'trazos_circulares',         label: 'Trazos circulares',             icon: '⭕', category: 'actividades', defaultDuration: 15, ageGroup: 'parvulos' },
  { type: 'enhebrado',                 label: 'Enhebrado',                     icon: '🧵', category: 'actividades', defaultDuration: 20, ageGroup: 'parvulos' },
  { type: 'pinzas_objetos',            label: 'Pinzas y objetos',              icon: '🤏', category: 'actividades', defaultDuration: 20, ageGroup: 'parvulos' },
  { type: 'modelado_plastilina',       label: 'Modelado con plastilina',       icon: '🟣', category: 'actividades', defaultDuration: 25, ageGroup: 'parvulos' },
  { type: 'rasgado_pegado',            label: 'Rasgado y pegado',              icon: '📄', category: 'actividades', defaultDuration: 20, ageGroup: 'parvulos' },
  { type: 'pintura_libre',             label: 'Pintura libre',                 icon: '🎨', category: 'actividades', defaultDuration: 25, ageGroup: 'parvulos' },
  { type: 'pintura_dirigida',          label: 'Pintura dirigida',              icon: '🖌️', category: 'actividades', defaultDuration: 25, ageGroup: 'parvulos' },
  { type: 'conversacion_guiada',       label: 'Conversación guiada',           icon: '💬', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'parvulos' },
  { type: 'nombrar_imagenes',          label: 'Nombrar imágenes',              icon: '🖼️', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'parvulos' },
  { type: 'completar_frases',          label: 'Completar frases',              icon: '🗣️', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'parvulos' },
  { type: 'cuento_participativo',      label: 'Cuento participativo',          icon: '📖', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'parvulos' },
  { type: 'rimas',                     label: 'Rimas infantiles',              icon: '🎵', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'parvulos' },
  { type: 'canciones_educativas',      label: 'Canciones educativas',          icon: '🎶', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'parvulos' },
  { type: 'adivinanzas',               label: 'Adivinanzas sencillas',         icon: '❓', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'parvulos' },
  // ════════════════════════════════════════════════════════════
  // PRE-KÍNDER (3–4 años)
  // ════════════════════════════════════════════════════════════
  { type: 'reconocimiento_letras',     label: 'Reconocimiento de letras',      icon: '🔤', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'letra_dia',                 label: 'Letra del día',                 icon: '🔠', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'trazado_letras',            label: 'Trazado de letras',             icon: '✏️', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'identificacion_nombre',     label: 'Identificación del nombre',     icon: '🪪', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'prekinder' },
  { type: 'escritura_nombre',          label: 'Escritura del nombre',          icon: '✍️', category: 'aprendizaje', defaultDuration: 20 },
  { type: 'sonido_inicial',            label: 'Sonido inicial de palabras',    icon: '🔊', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'prekinder' },
  { type: 'letra_imagen',              label: 'Asociación letra-imagen',       icon: '🖼️', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'cuento_comprension',        label: 'Cuento y comprensión',          icon: '📖', category: 'aprendizaje', defaultDuration: 25, ageGroup: 'prekinder' },
  { type: 'ordenar_historia',          label: 'Ordenar una historia',          icon: '📚', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'crear_historia',            label: 'Crear una historia',            icon: '📝', category: 'aprendizaje', defaultDuration: 25, ageGroup: 'prekinder' },
  { type: 'conteo_10',                 label: 'Conteo hasta 10',               icon: '🔢', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'conteo_20',                 label: 'Conteo hasta 20',               icon: '🔢', category: 'aprendizaje', defaultDuration: 20 },
  { type: 'reconocimiento_numeros',    label: 'Reconocimiento de números',     icon: '🔢', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'numero_cantidad',           label: 'Número-cantidad',               icon: '🔢', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'series_simples',            label: 'Series simples',                icon: '🔴', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'comparacion_cantidades',    label: 'Comparación de cantidades',     icon: '⚖️', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'formas_geometricas',        label: 'Formas geométricas',            icon: '🔺', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'secuencias_numericas',      label: 'Secuencias numéricas',          icon: '🔢', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'problemas_sencillos',       label: 'Problemas sencillos',           icon: '🧠', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'animales_domesticos',       label: 'Animales domésticos',           icon: '🐶', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'animales_salvajes',         label: 'Animales salvajes',             icon: '🦁', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'partes_planta',             label: 'Partes de una planta',          icon: '🌱', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'cuidado_plantas',           label: 'Cuidado de plantas',            icon: '🌿', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'clima',                     label: 'El clima',                      icon: '☀️', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'prekinder' },
  { type: 'los_sentidos',              label: 'Los sentidos',                  icon: '👀', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'cuerpo_humano',             label: 'El cuerpo humano',              icon: '🧍', category: 'aprendizaje', defaultDuration: 20 },
  { type: 'experimento_agua',          label: 'Experimento con agua',          icon: '💧', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'experimento_colores',       label: 'Experimento con colores',       icon: '🌈', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  { type: 'observacion_insectos',      label: 'Observación de insectos',       icon: '🐜', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'prekinder' },
  // ════════════════════════════════════════════════════════════
  // KÍNDER (4–5 años)
  // ════════════════════════════════════════════════════════════
  { type: 'lectura_palabras',          label: 'Lectura de palabras',           icon: '📖', category: 'aprendizaje', defaultDuration: 25, ageGroup: 'kinder' },
  { type: 'silabas',                   label: 'Reconocimiento de sílabas',     icon: '🔤', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'formacion_palabras',        label: 'Formación de palabras',         icon: '📝', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'escritura_palabras',        label: 'Escritura de palabras',         icon: '✏️', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'dictado_palabras',          label: 'Dictado de palabras',           icon: '🗣️', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'comprension_cuentos',       label: 'Comprensión de cuentos',        icon: '📚', category: 'aprendizaje', defaultDuration: 25, ageGroup: 'kinder' },
  { type: 'crear_cuentos',             label: 'Crear cuentos',                 icon: '📝', category: 'aprendizaje', defaultDuration: 30, ageGroup: 'kinder' },
  { type: 'exposicion_oral',           label: 'Exposición oral',               icon: '🎤', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'conversacion_grupal',       label: 'Conversación grupal',           icon: '💬', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'conteo_50',                 label: 'Conteo hasta 50',               icon: '🔢', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'sumas',                     label: 'Sumas sencillas',               icon: '➕', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'restas',                    label: 'Restas sencillas',              icon: '➖', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'mayor_menor',               label: 'Mayor y menor',                 icon: '⚖️', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'orden_numerico',            label: 'Orden numérico',                icon: '🔢', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'series_numericas',          label: 'Series numéricas',              icon: '🔢', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'patrones',                  label: 'Patrones',                      icon: '🔵', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'figuras_geometricas',       label: 'Figuras geométricas',           icon: '🔺', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'medicion',                  label: 'Medición',                      icon: '📏', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'clasificacion',             label: 'Clasificación',                 icon: '🔢', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'resolucion_problemas',      label: 'Resolución de problemas',       icon: '🧠', category: 'aprendizaje', defaultDuration: 25, ageGroup: 'kinder' },
  { type: 'ciclo_planta',              label: 'Ciclo de una planta',           icon: '🌱', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'germinacion',               label: 'Germinación',                   icon: '🌱', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'animales_habitats',         label: 'Animales y hábitats',           icon: '🐘', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'cinco_sentidos',            label: 'Los cinco sentidos',            icon: '👁️', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'estados_agua',              label: 'Estados del agua',              icon: '💧', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'mezcla_colores',            label: 'Mezcla de colores',             icon: '🎨', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
  { type: 'experimentos',              label: 'Experimentos científicos',      icon: '🧪', category: 'aprendizaje', defaultDuration: 25, ageGroup: 'kinder' },
  { type: 'observacion_clima',         label: 'Observación del clima',         icon: '☀️', category: 'aprendizaje', defaultDuration: 15, ageGroup: 'kinder' },
  { type: 'medioambiente',             label: 'Cuidado del medioambiente',     icon: '🌎', category: 'aprendizaje', defaultDuration: 20, ageGroup: 'kinder' },
];

function _getEventMeta(type) {
  const e = EVENT_CATALOG.find(x => x.type === type);
  if (e) return e;
  const core = EVENT_TYPES[type];
  if (core) return { type, label: core.label, icon: core.icon, color: core.color };
  return null;
}

const MOOD_OPTIONS = [
  { value: 'feliz',        icon: '😀', label: 'Feliz' },
  { value: 'tranquilo',    icon: '🙂', label: 'Tranquilo' },
  { value: 'normal',       icon: '😐', label: 'Normal' },
  { value: 'triste',       icon: '😢', label: 'Triste' },
  { value: 'llanto',       icon: '😭', label: 'Llanto' },
  { value: 'enfermo',      icon: '🤒', label: 'Enfermo' },
  { value: 'somnoliento',  icon: '😴', label: 'Somnoliento' },
  { value: 'irritable',    icon: '😡', label: 'Irritable' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function _isWithin12h(dateStr) {
  if (!dateStr) return false;
  return (Date.now() - new Date(dateStr).getTime()) < 12 * 60 * 60 * 1000;
}

function _getCurrentScheduleEvent() {
  const schedule = _classroomSchedule.length ? _classroomSchedule : DEFAULT_SCHEDULE;
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  let closest = null, minDiff = Infinity;
  for (const ev of schedule) {
    const diff = Math.abs(mins - (ev.hour * 60 + ev.minute));
    if (diff < minDiff && diff <= 90) { minDiff = diff; closest = ev; }
  }
  return closest;
}

function _getActiveScheduleIndex() {
  const schedule = _classroomSchedule.length ? _classroomSchedule : DEFAULT_SCHEDULE;
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  let activeIdx = -1, bestDiff = Infinity;
  for (let i = 0; i < schedule.length; i++) {
    const start = (schedule[i].hour ?? 0) * 60 + (schedule[i].minute ?? 0);
    if (start <= mins) {
      const diff = mins - start;
      if (diff < bestDiff) { bestDiff = diff; activeIdx = i; }
    }
  }
  return activeIdx;
}

function _formatTime(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function _formatTime12(h, m) {
  const hh = h > 12 ? h - 12 : h;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${hh}:${String(m).padStart(2,'0')} ${ampm}`;
}

function _formatDate(dateStr) {
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

function _getActiveSiestas(students, logsMap) {
  return students.filter(s => {
    const events = logsMap[s.id]?.events || [];
    const siestas = events.filter(e => e.type === 'siesta');
    return siestas.length && siestas[siestas.length - 1].open === true;
  });
}

function _makeEvent(type, data = {}) {
  return { id: crypto.randomUUID(), type, created_at: new Date().toISOString(), ...data };
}

function _addEventToLog(log, event) {
  const events = Array.isArray(log?.events) ? [...log.events] : [];
  events.push(event);
  return events;
}

function _getScheduleEventIcon(type) {
  const iconMap = {
    bienvenida: '👋', desayuno: '🍞', actividad: '📚', bano: '🚽',
    patio: '🌳', almuerzo: '🥗', siesta: '😴', merienda: '🍎', biberon: '🍼'
  };
  return iconMap[type] || EVENT_TYPES[type]?.icon || _getEventMeta(type)?.icon || '⏰';
}

// ── V8 Fase 2: helpers de prellenado ─────────────────────────────────────────
function _getScheduledEventByType(type) {
  const schedule = _classroomSchedule.length ? _classroomSchedule : DEFAULT_SCHEDULE;
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  let best = null;
  for (const ev of schedule) {
    if (ev.type !== type) continue;
    if (!best) { best = ev; continue; }
    if (Math.abs(mins - (ev.hour * 60 + ev.minute)) < Math.abs(mins - (best.hour * 60 + best.minute))) best = ev;
  }
  return best;
}

function _lastRegisteredEvent(type) {
  const logsMap = AppState.get('logsMap') || {};
  let last = null, lastT = 0;
  Object.values(logsMap).forEach(log => {
    (log.events || []).forEach(ev => {
      const t = new Date(ev.created_at || 0).getTime();
      if (ev.type === type && t >= lastT) { lastT = t; last = ev; }
    });
  });
  return last;
}

function _prefillBulkSubParams(eventType) {
  if (eventType === 'siesta') {
    const active = _getActiveSiestas(AppState.get('students') || [], AppState.get('logsMap') || {});
    const target = active.length ? 'despertar' : 'iniciar';
    const btn = document.querySelector(`[data-siesta-action="${target}"]`);
    if (btn) btn.classList.add('bg-indigo-500','text-white','border-indigo-500');
    return;
  }
  const last = _lastRegisteredEvent(eventType);
  if (!last) return;
  if (eventType === 'temperatura' && last.temp != null) {
    const btn = document.querySelector(`[data-temp="${last.temp}"]`);
    if (btn) { btn.classList.remove('bg-slate-50','border-slate-100'); btn.classList.add(last.temp >= 37.5 ? 'bg-rose-500' : 'bg-blue-500', last.temp >= 37.5 ? 'border-rose-500' : 'border-blue-400','text-white'); }
  }
  if (eventType === 'biberon') {
    const oz = document.querySelector(`[data-oz="${last.oz}"]`);
    if (oz) oz.classList.add('bg-blue-500','text-white','border-blue-500');
    const t = document.querySelector(`[data-milk-temp="${last.milk_temp}"]`);
    if (t) t.classList.add('bg-sky-500','text-white','border-sky-500');
  }
  if (eventType === 'animo' && last.mood) {
    const b = document.querySelector(`[data-mood="${last.mood}"]`);
    if (b) b.classList.add('border-orange-400','bg-orange-50');
  }
  if (eventType === 'medicamento') {
    const n = document.getElementById('medNombre'), d = document.getElementById('medDosis'), a = document.getElementById('medAuth');
    if (n) n.value = last.nombre || '';
    if (d) d.value = last.dosis || '';
    if (a) a.value = last.autorizacion || '';
  }
}

function _countReportedStudents(logsMap, students) {
  return students.filter(s => {
    const log = logsMap[s.id];
    return log && (log.mood || log.food || log.nap || log.notes || (log.events && log.events.length));
  }).length;
}

function _isStudentPresent(studentId) {
  const attendance = AppState.get('attendance') || [];
  const numId = Number(studentId);
  const record = attendance.find(a => Number(a.student_id) === numId);
  return record?.status === 'present' || record?.status === 'late';
}

// ¿El estudiante ya se retiró del centro hoy? (attendance.status = 'retirado').
// La maestra NO puede cambiar de aula, pero el padre/la puerta marca el retiro.
function _isStudentRetirado(studentId) {
  const attendance = AppState.get('attendance') || [];
  const numId = Number(studentId);
  const record = attendance.find(a => Number(a.student_id) === numId);
  return record?.status === 'retirado';
}

function _getPresentStudentIds() {
  const students = AppState.get('students') || [];
  return students.filter(s => _isStudentPresent(s.id)).map(s => s.id);
}

// ¿La hora de salida del estudiante ya pasó? (exit_time en formato "HH:MM")
function _isStudentExitTimePassed(student) {
  const exitTime = student?.exit_time;
  if (!exitTime) return false;
  const now = new Date();
  const [h, m] = String(exitTime).split(':').map(Number);
  const exitMins = (h || 0) * 60 + (m || 0);
  return (now.getHours() * 60 + now.getMinutes()) > exitMins + 30; // 30 min de gracia
}

// ¿El estudiante está próximo a salir? (dentro de 30 min de su exit_time)
function _isStudentNearExit(student) {
  const exitTime = student?.exit_time;
  if (!exitTime) return false;
  const now = new Date();
  const [h, m] = String(exitTime).split(':').map(Number);
  const exitMins = (h || 0) * 60 + (m || 0);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return nowMins >= exitMins - 30 && nowMins <= exitMins + 30;
}

// ── FILTROS RÁPIDOS DE ESTADO ────────────────────────────────────────────────
function _filterStudents(students, filter, logsMap) {
  if (filter === 'all') return students;
  return students.filter(s => {
    const log = logsMap[s.id];
    const isPresent = _isStudentPresent(s.id);
    const isRetirado = _isStudentRetirado(s.id);
    const hasReport = log && (log.mood || log.food || log.nap || log.notes || (log.events && log.events.length));
    const activeSiesta = (log?.events || []).filter(e => e.type === 'siesta').some(e => e.open === true);
    const nearExit = isPresent && !isRetirado && _isStudentNearExit(s);
    switch (filter) {
      case 'unreported': return isPresent && !isRetirado && !hasReport;
      case 'siesta': return activeSiesta;
      case 'near_exit': return nearExit;
      case 'retirado': return isRetirado;
      default: return true;
    }
  });
}

function _setRoutineFilter(filter) {
  _routineFilter = filter;
  document.querySelectorAll('#routineFilterChips button').forEach(b => {
    const active = b.dataset.filter === filter;
    b.classList.toggle('bg-gradient-to-r', active);
    b.classList.toggle('from-orange-500', active);
    b.classList.toggle('to-amber-500', active);
    b.classList.toggle('text-white', active);
    b.classList.toggle('shadow-lg', active);
    b.classList.toggle('shadow-orange-200', active);
    b.classList.toggle('border-orange-400', active);
    b.classList.toggle('bg-slate-50', !active);
    b.classList.toggle('text-slate-500', !active);
    b.classList.toggle('border-slate-200', !active);
    b.classList.toggle('hover:bg-slate-100', !active);
    b.classList.toggle('hover:text-slate-700', !active);
    b.classList.toggle('hover:border-slate-300', !active);
  });
  _refreshStudentCards();
}
export const setRoutineFilter = _setRoutineFilter;

function _toggleRoutineSection(section) {
  const body = document.getElementById(`${section}Body`);
  const toggle = body?.previousElementSibling?.querySelector('.routine-section-toggle') ||
                 document.querySelector(`[aria-controls="${section}Body"]`);
  if (!body || !toggle) return;
  const expanded = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!expanded));
  if (expanded) {
    body.classList.add('collapsed');
  } else {
    body.classList.remove('collapsed');
    body.style.maxHeight = body.scrollHeight + 'px';
    setTimeout(() => { body.style.maxHeight = ''; }, 300);
  }
}
export const toggleRoutineSection = _toggleRoutineSection;

function _getFilterCounts(students, logsMap) {
  const counts = { all: students.length, unreported: 0, siesta: 0, near_exit: 0, retirado: 0 };
  students.forEach(s => {
    const log = logsMap[s.id];
    const isPresent = _isStudentPresent(s.id);
    const isRetirado = _isStudentRetirado(s.id);
    const hasReport = log && (log.mood || log.food || log.nap || log.notes || (log.events && log.events.length));
    const activeSiesta = (log?.events || []).filter(e => e.type === 'siesta').some(e => e.open === true);
    const nearExit = isPresent && !isRetirado && _isStudentNearExit(s);
    if (isPresent && !isRetirado && !hasReport) counts.unreported++;
    if (activeSiesta) counts.siesta++;
    if (nearExit) counts.near_exit++;
    if (isRetirado) counts.retirado++;
  });
  return counts;
}

// ── CRONÓMETRO DE SIESTA EN TIEMPO REAL ──────────────────────────────────────
function _startSiestaTimers() {
  if (_siestaTimerInterval) clearInterval(_siestaTimerInterval);
  _siestaTimerInterval = setInterval(_updateSiestaTimers, 30000);
  _updateSiestaTimers();
}

function _stopSiestaTimers() {
  if (_siestaTimerInterval) { clearInterval(_siestaTimerInterval); _siestaTimerInterval = null; }
}

function _updateSiestaTimers() {
  document.querySelectorAll('[data-siesta-elapsed]').forEach(el => {
    const startIso = el.dataset.siestaElapsed;
    if (!startIso) return;
    const mins = Math.round((Date.now() - new Date(startIso).getTime()) / 60000);
    el.textContent = `${mins}min`;
  });
}

// ── CÁLCULO AUTOMÁTICO DE LECHE DEL DÍA ──────────────────────────────────────
function _getDailyMilkSummary(logsMap, students) {
  let totalOz = 0;
  let count = 0;
  students.forEach(s => {
    const log = logsMap[s.id];
    if (!log?.events) return;
    log.events.forEach(e => {
      if ((e.type === 'biberon' || e.type === 'milk') && e.oz) {
        totalOz += parseFloat(e.oz) || 0;
        count++;
      }
    });
  });
  return { totalOz, count };
}

// ── V8: helpers de cronología ─────────────────────────────────────────────────
function _minutesToTime(mins) {
  const t = ((mins % 1440) + 1440) % 1440;
  return { hour: Math.floor(t / 60), minute: t % 60 };
}

function _getTimelineState(ev) {
  const now     = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const start   = (ev.hour ?? 0) * 60 + (ev.minute ?? 0);
  const end     = start + (ev.duration || 30);
  if (nowMins >= end) return 'completed';
  if (nowMins >= start) return 'in_progress';
  return 'pending';
}

let _v8StylesInjected = false;
function _injectV8Styles() {
  if (_v8StylesInjected || document.getElementById('routine-v8-styles')) return;
  _v8StylesInjected = true;
  const style = document.createElement('style');
  style.id = 'routine-v8-styles';
  style.textContent = `
    @keyframes tlPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,138,0,0.45);}50%{box-shadow:0 0 0 10px rgba(255,138,0,0);}}
    .tl-pulse{animation:tlPulse 1.6s ease-in-out infinite;}
    .schedule-order-row.dragging{opacity:.45;border-style:dashed !important;}
    .schedule-order-row.drop-target{border-color:#FF8A00 !important;background:#fff7ed !important;}
    .drag-handle{cursor:grab;-webkit-user-select:none;user-select:none;}
    .drag-handle:active{cursor:grabbing;}
    .tl-insert-btn{background:#fff;border:2px solid #FF8A00;color:#FF8A00;border-radius:9999px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;line-height:1;box-shadow:0 2px 8px rgba(255,138,0,0.35);cursor:pointer;transition:transform .15s ease,background .15s ease,color .15s ease;}
    .tl-insert-btn:hover{background:#FF8A00;color:#fff;transform:scale(1.1);}
    .tl-insert-btn:active{transform:scale(.9);}
    #scheduleOrderList .schedule-order-row select{font-size:11px;font-weight:700;color:#475569;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:6px 8px;outline:none;min-height:36px;min-width:52px;-webkit-appearance:auto;appearance:auto;}
    #scheduleOrderList .schedule-order-row select:focus{border-color:#FF8A00;}
    @media(min-width:640px){#scheduleOrderList .schedule-order-row select{font-size:9px;padding:2px 4px;min-height:auto;min-width:auto;}}
    .routine-section-toggle{cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;}
    .routine-section-toggle .acc-chevron{transition:transform .25s ease;}
    .routine-section-toggle[aria-expanded="true"] .acc-chevron{transform:rotate(180deg);}
    .routine-section-body{overflow:hidden;transition:max-height .3s ease,opacity .25s ease;}
    .routine-section-body.collapsed{max-height:0!important;opacity:0;padding-top:0;padding-bottom:0;pointer-events:none;}
    .acc-section summary{list-style:none;}
    .acc-section summary::-webkit-details-marker{display:none;}
    .acc-section summary::marker{content:"";}
    .acc-section[open] .acc-chev{transform:rotate(180deg);}
    .acc-section[open]{background:#fff;border-color:#e2e8f0;box-shadow:0 1px 4px rgba(0,0,0,0.04);}
    #ageFilterChips button{color:#fff;border-color:rgba(255,255,255,.35);background:rgba(255,255,255,.12);}
    #ageFilterChips button:hover{background:rgba(255,255,255,.25);}
    #ageFilterChips button.active-age{background:#fff;color:#f97316;border-color:#fff;}
    /* Swipe card styles */
    .swipe-card{position:relative;overflow:hidden;touch-action:pan-y;}
    .swipe-card .swipe-action-left{position:absolute;top:0;left:0;bottom:0;width:60px;display:flex;align-items:center;justify-content:center;background:linear-gradient(90deg,#ef4444,#dc2626);color:#fff;font-size:20px;opacity:0;transition:opacity .15s;pointer-events:none;}
    .swipe-card .swipe-action-right{position:absolute;top:0;right:0;bottom:0;width:60px;display:flex;align-items:center;justify-content:center;background:linear-gradient(270deg,#22c55e,#16a34a);color:#fff;font-size:20px;opacity:0;transition:opacity .15s;pointer-events:none;}
    .swipe-card.swiping-left .swipe-action-left{opacity:1;}
    .swipe-card.swiping-right .swipe-action-right{opacity:1;}
    .swipe-card .swipe-hint{position:absolute;top:50%;transform:translateY(-50%);font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;pointer-events:none;opacity:0;transition:opacity .15s;}
    .swipe-card.swiping-left .swipe-hint-left{opacity:.8;left:8px;color:#fff;}
    .swipe-card.swiping-right .swipe-hint-right{opacity:.8;right:8px;color:#fff;}`;
  document.head.appendChild(style);
}

// ── LOAD SCHEDULE FROM DB ─────────────────────────────────────────────────────
async function _loadSchedule(classroomId) {
  try {
    const { data, error } = await supabase
      .from('classroom_event_schedule')
      .select('event_type, event_label, event_icon, scheduled_hour, scheduled_minute, duration_minutes, auto_register, applies_to, category, sort_order')
      .eq('classroom_id', classroomId)
      .eq('is_active', true)
      .order('sort_order');

    if (error) {
      _classroomSchedule = DEFAULT_SCHEDULE.map(s => ({ ...s }));
      return;
    }

    if (!data?.length) {
      _classroomSchedule = DEFAULT_SCHEDULE.map(s => ({ ...s }));
      await _seedDefaultSchedule(classroomId);
      return;
    }

    _classroomSchedule = data.map(d => ({
      type: d.event_type,
      label: d.event_label,
      icon: d.event_icon,
      hour: d.scheduled_hour,
      minute: d.scheduled_minute,
      duration: d.duration_minutes,
      autoRegister: true,
      appliesTo: d.applies_to,
      category: d.category || null,
      sort_order: d.sort_order,
    }));
    // Orden respeta la cronología personalizada (sort_order) y, como respaldo, la hora.
    _classroomSchedule.sort((a, b) =>
      ((a.sort_order ?? Infinity) - (b.sort_order ?? Infinity)) ||
      ((a.hour * 60 + a.minute) - (b.hour * 60 + b.minute))
    );
  } catch {
    _classroomSchedule = DEFAULT_SCHEDULE.map(s => ({ ...s }));
  }
}

async function _seedDefaultSchedule(classroomId) {
  try {
    const inserts = DEFAULT_SCHEDULE.map((s, i) => ({
      classroom_id: classroomId,
      event_type: s.type,
      event_label: s.label,
      event_icon: EVENT_TYPES[s.type]?.icon || '📋',
      category: EVENT_TYPES[s.type]?.color || 'personalizados',
      scheduled_hour: s.hour,
      scheduled_minute: s.minute,
      duration_minutes: s.duration,
      sort_order: i,
      is_active: true,
      auto_register: true,
      applies_to: 'all',
    }));
    await supabase.from('classroom_event_schedule').insert(inserts);
  } catch { /* noop - fallback to in-memory default */ }
}

// ── LOG EVENT TO TIMELINE ─────────────────────────────────────────────────────
async function _logTimelineEvent(classroom, eventType, studentIds, extra = {}) {
  try {
    const user = AppState.get('user');
    await supabase.rpc('log_timeline_event', {
      p_classroom_id: classroom.id,
      p_event_type: eventType,
      p_registered_by: user?.id || null,
      p_target_students: studentIds || [],
      p_scheduled_time: extra.scheduledTime || null,
      p_duration_minutes: extra.duration || null,
      p_metadata: extra.metadata || {},
    });
  } catch { /* silencioso */ }
}

// ── INIT RUTINA V4 ─────────────────────────────────────────────────────────────
export async function initRoutine() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('tab-daily-routine');
  if (!container) return;

  container.innerHTML = `
    <div class="animate-pulse space-y-5">
      <div class="h-10 bg-slate-100 rounded-2xl w-1/2"></div>
      <div class="h-28 bg-gradient-to-r from-orange-50 to-amber-50 rounded-[2rem]"></div>
      <div class="h-20 bg-indigo-50 rounded-[2rem]"></div>
      <div class="h-16 bg-green-50 rounded-[2rem]"></div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        ${Array(5).fill('<div class="h-44 bg-slate-50 rounded-[2rem]"></div>').join('')}
      </div>
    </div>`;

  try {
    const students = AppState.get('students') || [];
    const today    = new Date().toISOString().split('T')[0];

    // Cargar asistencia si no está en estado
    let attendance = AppState.get('attendance');
    if (!attendance || !attendance.length) {
      const { data: attData } = await supabase
        .from('attendance')
        .select('student_id, status')
        .eq('classroom_id', classroom.id)
        .eq('date', today);
      attendance = attData || [];
      AppState.set('attendance', attendance);
    }

    await _loadSchedule(classroom.id);

    let todayLogs = [];
    const { data: logsData, error: logsError } = await supabase
      .from('daily_logs')
      .select('id, student_id, mood, food, nap, notes, status, created_at, infant_data, events')
      .eq('classroom_id', classroom.id)
      .eq('date', today);

    if (logsError) {
      const { data: fallbackLogs } = await supabase
        .from('daily_logs')
        .select('id, student_id, mood, food, nap, notes, created_at')
        .eq('classroom_id', classroom.id)
        .eq('date', today);
      todayLogs = (fallbackLogs || []).map(l => ({ ...l, status: 'published', infant_data: [], events: [] }));
    } else {
      todayLogs = logsData || [];
    }

    const logsMap = {};
    (todayLogs || []).forEach(l => { logsMap[l.student_id] = l; });
    AppState.set('logsMap', logsMap);

    if (!students.length) {
      container.innerHTML = '<div class="text-center p-12 text-slate-400 font-bold">No hay estudiantes en esta aula.</div>';
      return;
    }

    const todayLabel    = _formatDate(today);
    const withReport    = _countReportedStudents(logsMap, students);
    const scheduleNow   = _getCurrentScheduleEvent();
    const activeSiestas = _getActiveSiestas(students, logsMap);

    container.innerHTML = _renderRoutineLayout({
      todayLabel, students, logsMap, withReport,
      scheduleNow, activeSiestas, today, classroom
    });

    _refreshStudentCards();
    if (window.lucide) window.lucide.createIcons();

    _startAutoRegisterClock();
    _startSiestaTimers();

  } catch (e) {
    console.error('[routine] Error cargando rutina:', e);
    container.innerHTML = '<div class="text-center p-10 text-rose-500 font-bold">Error al cargar rutina. Intenta de nuevo.</div>';
  }
}

// ── RENDER FILAS DEL TIMELINE (reutilizable: página + sheet móvil) ────────────
function _renderTimelineEventRows() {
  const students = AppState.get('students') || [];
  const logsMap  = AppState.get('logsMap') || {};
  const schedule = _classroomSchedule.length ? _classroomSchedule : DEFAULT_SCHEDULE;

  return schedule.map((ev, i) => {
    const state    = _getTimelineState(ev);
    const isActive = state === 'in_progress';
    const isTimePast = state === 'completed';
    const isNext   = state === 'pending' && schedule.slice(0, i).every(e => _getTimelineState(e) === 'completed');
    const timeStr  = _formatTime12(ev.hour, ev.minute);
    const eventIcon = _getScheduleEventIcon(ev.type);
    const endMins  = (ev.hour ?? 0) * 60 + (ev.minute ?? 0) + (ev.duration || 30);
    const endTime  = _formatTime12(Math.floor(endMins / 60), endMins % 60);

    const presentStudents = students.filter(s => _isStudentPresent(s.id));
    const studentsWithEvent = presentStudents.filter(s => {
      const evts = logsMap[s.id]?.events || [];
      return evts.some(e => e.type === ev.type);
    }).length;

    const isRegistered = studentsWithEvent > 0;
    const isDone   = isTimePast && isRegistered;
    const isMissed = isTimePast && !isRegistered;

    const activeSoftBgs = {
      bienvenida:'#f1f5f9', desayuno:'#fef3c7', actividad:'#eff6ff',
      bano:'#f0fdfa', patio:'#f0fdf4', almuerzo:'#f0fdf4',
      siesta:'#eef2ff', merienda:'#ecfccb', biberon:'#f0f9ff'
    };

    const rowBgCls = isActive
      ? 'bg-gradient-to-r from-[#FF8A00]/10 to-orange-50 border-2 border-[#FF8A00]/30 shadow-md shadow-orange-100/50'
      : isDone
        ? 'bg-green-50/70 border-2 border-green-200/70 hover:bg-green-50'
        : isMissed
          ? 'bg-amber-50/70 border-2 border-amber-200/70 hover:bg-amber-50'
          : 'border-2 border-transparent hover:bg-slate-50';

    return `
    <div class="relative">
      <div
        onclick="App.openBulkEventModal('${ev.type}', '${timeStr}')"
        class="relative flex items-start gap-3 sm:gap-4 w-full p-2.5 sm:p-3 rounded-2xl transition-all active:scale-[0.98] cursor-pointer ${rowBgCls}" data-index="${i}">

        <div class="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 z-10 transition-all ${isActive ? 'text-white shadow-lg scale-110 tl-pulse' : 'text-slate-500'}" style="${isActive ? 'background:linear-gradient(135deg, #FF8A00, #f97316);box-shadow:0 4px 12px rgba(255,138,0,0.3);' : `background:${activeSoftBgs[ev.type] || '#f1f5f9'};`}">
          ${eventIcon}
        </div>

        <div class="flex-1 text-left min-w-0">
          <div class="flex items-center gap-2 mb-0.5">
            <span class="text-[11px] font-black ${isActive ? 'text-[#FF8A00]' : isDone ? 'text-[#28B54D]' : isMissed ? 'text-amber-600' : 'text-slate-400'}">${timeStr}</span>
            ${isActive ? '<span class="px-2 py-0.5 bg-[#FF8A00] text-white text-[7px] font-black uppercase rounded-lg animate-pulse shadow-sm">AHORA</span>' : ''}
            ${isNext ? '<span class="px-2 py-0.5 bg-indigo-500 text-white text-[7px] font-black uppercase rounded-lg shadow-sm">SIGUIENTE</span>' : ''}
            ${isDone ? '<span class="px-2 py-0.5 bg-green-100 text-[#28B54D] text-[7px] font-black uppercase rounded-lg">✓ Hecho</span>' : ''}
            ${isMissed ? '<span class="px-2 py-0.5 bg-amber-100 text-amber-700 text-[7px] font-black uppercase rounded-lg">Sin registrar</span>' : ''}
          </div>
          <p class="text-sm font-black text-slate-700 leading-tight">${ev.label}</p>
          <div class="flex items-center gap-3 mt-1">
            <span class="text-[9px] font-bold text-slate-400">${endTime}</span>
            <span class="text-[9px] font-bold text-slate-300">·</span>
            <span class="text-[9px] font-bold text-slate-400">${ev.duration || 30}min</span>
            ${presentStudents.length ? `
              <span class="text-[9px] font-black ${isDone ? 'text-[#28B54D]' : 'text-[#FF8A00]'}">
                ${studentsWithEvent}/${presentStudents.length} alumnos
              </span>
            ` : ''}
          </div>
        </div>

        <div class="shrink-0 mt-1">
          <i data-lucide="chevron-right" class="w-4 h-4 ${isActive ? 'text-[#FF8A00]' : 'text-slate-300'}"></i>
        </div>
      </div>

      <div class="relative z-10 flex items-center justify-center" style="margin:-7px 0;" data-insert-slot="${i + 1}">
        <button onclick="App.openInsertEventPicker(${i + 1})" class="tl-insert-btn" style="position:absolute;left:25px;" title="Insertar evento aquí">+</button>
      </div>
    </div>`;
  }).join('');
}

// ── SHEET MÓVIL DEL TIMELINE (ventana de todos los eventos que sube) ──────────
async function openTimelineSheet() {
  const modalId = 'timelineSheetModal';
  const today   = new Date().toISOString().split('T')[0];
  // Recargar la cronología del aula activa por si se cambió de aula.
  const classroom = AppState.get('classroom');
  if (classroom) await _loadSchedule(classroom.id);
  const rows    = _renderTimelineEventRows();

  const content = `
    <style>
      #${modalId}-inner{margin:auto auto 0 !important;animation:sheetUp .26s cubic-bezier(.32,.72,.3,1)}
      @media (min-width:640px){#${modalId}-inner{margin:auto !important}}
      @keyframes sheetUp{from{transform:translateY(100%);opacity:.4}to{transform:translateY(0);opacity:1}}
    </style>
    <div class="w-full sm:max-w-md flex items-end sm:items-center justify-center" style="height:min(82vh,640px);min-height:52vh;">
      <div class="bg-white w-full rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl overflow-hidden flex flex-col" style="max-height:100%;">
        <div class="pt-2 pb-1 flex justify-center sm:hidden"><span class="w-10 h-1.5 rounded-full bg-slate-200"></span></div>
        <div class="px-4 sm:px-5 pb-3 pt-1 flex items-center justify-between gap-3 border-b border-slate-100" style="background:linear-gradient(135deg, #fff7ed 0%, #ffffff 100%);">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0" style="background:linear-gradient(135deg, #FF8A00, #f97316);box-shadow:0 4px 10px rgba(255,138,0,0.3);">📅</div>
            <div class="min-w-0">
              <h3 class="text-sm font-black text-slate-800">Timeline del Día</h3>
              <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider truncate">${_formatDate(today)}</p>
            </div>
          </div>
          <button onclick="Modal.close('${modalId}')" class="p-2 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors shrink-0" aria-label="Cerrar">
            <svg class="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="overflow-y-auto flex-1 custom-scrollbar" style="-webkit-overflow-scrolling:touch;">
          <div class="relative p-3 sm:p-4">
            <div class="absolute left-[38px] top-5 bottom-5 w-0.5 bg-gradient-to-b from-[#FF8A00]/30 via-slate-200 to-slate-100"></div>
            <div class="space-y-2">${rows}</div>
          </div>
        </div>
        <div class="p-3 sm:p-4 shrink-0" style="background:#f8fafc;border-top:1px solid #e2e8f0;">
          <button onclick="Modal.close('${modalId}'); App.openBulkEventModal('animo')"
            class="w-full py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-[0.98]" style="background:#FF8A00 !important;color:#fff !important;border:2px solid #E67A00 !important;box-shadow:0 4px 14px rgba(255,138,0,0.35);">
            ➕ Registrar evento a todos
          </button>
        </div>
      </div>
    </div>`;

  Modal.open(modalId, content);
  if (window.lucide) window.lucide.createIcons();
}

// ── RENDER LAYOUT PRINCIPAL (4 NIVELES) ───────────────────────────────────────
function _renderRoutineLayout({ todayLabel, students, logsMap, withReport, scheduleNow, activeSiestas, today, classroom }) {
  const schedule = _classroomSchedule.length ? _classroomSchedule : DEFAULT_SCHEDULE;
  const retirados = students.filter(s => _isStudentRetirado(s.id));
  const presentStudents = students.filter(s => _isStudentPresent(s.id));
  const scheduleNowNeedsAction = scheduleNow && presentStudents.some(s => {
    const evts = logsMap[s.id]?.events || [];
    return !evts.some(e => e.type === scheduleNow.type);
  });

  return `
  <div class="space-y-5 pb-24" id="routineWrapper">

    <!-- ═══ NIVEL 1: TIMELINE DEL DÍA ═══ -->
    <div class="bg-white border border-slate-100 rounded-[2rem] overflow-hidden" id="timelineContainer" style="box-shadow:0 4px 24px rgba(0,0,0,0.04);">
      <!-- Header (clickeable para colapsar) -->
      <div class="routine-section-toggle px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100" style="background:linear-gradient(135deg, #f8fafc 0%, #ffffff 100%);" onclick="App.toggleRoutineSection('timeline')" aria-expanded="true" aria-controls="timelineBody">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-2xl flex items-center justify-center text-white text-lg shadow-md shrink-0" style="background:linear-gradient(135deg, #FF8A00, #f97316);box-shadow:0 4px 12px rgba(255,138,0,0.3);">📅</div>
          <div class="min-w-0">
            <h3 class="text-sm font-black text-slate-800">Timeline del Día</h3>
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider capitalize truncate">${todayLabel}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button onclick="event.stopPropagation();App.openAllEventsMenu()"
            class="flex items-center gap-1 px-2.5 py-2 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-all text-[10px] font-black text-indigo-600 uppercase tracking-widest active:scale-95">
            <span class="text-sm">➕</span>
            <span class="hidden sm:inline">Eventos</span>
          </button>
          <button onclick="event.stopPropagation();App.openScheduleManager()"
            class="flex items-center gap-1 px-2.5 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all text-[10px] font-black text-slate-500 uppercase tracking-widest active:scale-95">
            <span class="text-sm">⚙️</span>
            <span class="hidden sm:inline">Rutina</span>
          </button>
          <span class="hidden sm:inline-flex items-center text-[10px] font-black text-[#28B54D] bg-green-50 border border-green-200 px-3 py-1.5 rounded-full">
            ${withReport}/${students.length} reportes
          </span>
          <span class="acc-chevron text-slate-400 text-xs">▼</span>
        </div>
      </div>

      <!-- Timeline Body (colapsable) -->
      <div id="timelineBody" class="routine-section-body">
        <!-- Timeline Expandido: Ventana Vertical con Detalles -->
        <div id="timelineExpanded" class="${_timelineExpanded ? '' : 'hidden'}">
          <div class="max-h-[320px] sm:max-h-[420px] overflow-y-auto custom-scrollbar">
            <div class="relative p-3 sm:p-5">
              <!-- Línea vertical conectora -->
              <div class="absolute left-[38px] top-5 bottom-5 w-0.5 bg-gradient-to-b from-[#FF8A00]/30 via-slate-200 to-slate-100"></div>

              <div class="space-y-2">
                ${_renderTimelineEventRows()}
              </div>
            </div>
          </div>
        </div>

        <!-- Timeline Colapsado: Barra Horizontal de Emojis -->
        <div id="timelineCollapsed" class="${_timelineExpanded ? 'hidden' : ''} px-4 py-3 border-t border-slate-100 w-full max-w-full" style="overflow:hidden;">
          <div class="overflow-x-auto w-full" style="scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;" id="timelineCollapsedScroll">
            <div class="flex items-center gap-1.5 min-w-max py-1" style="min-width:max-content;">
              ${schedule.map((ev, i) => {
                const state    = _getTimelineState(ev);
                const isActive = state === 'in_progress';
                const isTimePast = state === 'completed';
                const isRegistered = students.filter(s => _isStudentPresent(s.id) && (logsMap[s.id]?.events || []).some(e => e.type === ev.type)).length > 0;
                const isDone   = isTimePast && isRegistered;
                const isMissed = isTimePast && !isRegistered;
                return `
                <button onclick="App.openBulkEventModal('${ev.type}', '${_formatTime12(ev.hour, ev.minute)}')"
                  class="flex flex-col items-center gap-1 px-3 py-2 rounded-2xl transition-all active:scale-90 shrink-0 ${
                    isActive ? 'bg-[#FF8A00]/10 scale-110 shadow-sm' :
                    isDone ? 'bg-green-50' :
                    isMissed ? 'bg-amber-50' : 'hover:bg-slate-50'
                  }">
                  <span class="text-xl leading-none ${isActive ? 'drop-shadow-md' : ''}">${_getScheduleEventIcon(ev.type)}</span>
                  ${isActive ? '<span class="w-1.5 h-1.5 bg-[#FF8A00] rounded-full tl-pulse"></span>' :
                    isDone ? '<span class="w-1.5 h-1.5 bg-[#28B54D] rounded-full"></span>' :
                    isMissed ? '<span class="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>' :
                    '<span class="w-1.5 h-1.5 bg-slate-200 rounded-full"></span>'}
                </button>`;
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ NIVEL 2: CONTENEDOR COLECTIVO ═══ -->

    <!-- Banner Siestas Activas -->
    ${activeSiestas.length > 0 ? `
    <div class="bg-white border-2 border-purple-200 rounded-[1.5rem] p-4 flex items-center gap-4 shadow-sm" style="background:linear-gradient(135deg, #faf5ff 0%, #f0f0ff 100%);">
      <div class="w-12 h-12 text-white rounded-2xl flex items-center justify-center text-xl shrink-0 shadow-lg animate-pulse" style="background:linear-gradient(135deg, #9333ea, #7c3aed);box-shadow:0 4px 14px rgba(147,51,234,0.35);">😴</div>
      <div class="flex-1">
        <p class="text-sm font-black text-purple-800">${activeSiestas.length} siesta${activeSiestas.length > 1 ? 's' : ''} activa${activeSiestas.length > 1 ? 's' : ''}</p>
        <p class="text-[11px] font-bold text-purple-600">
          ${activeSiestas.slice(0,2).map(s => {
            const log = logsMap[s.id] || {};
            const openSiesta = (log.events || []).filter(e => e.type === 'siesta').find(e => e.open);
            const elapsed = openSiesta ? Math.round((Date.now() - new Date(openSiesta.created_at).getTime()) / 60000) : '?';
            return `${s.name.split(' ')[0]} <span class="text-purple-400" data-siesta-elapsed="${openSiesta?.created_at || ''}">${elapsed}min</span>`;
          }).join(', ')}${activeSiestas.length > 2 ? ` y ${activeSiestas.length - 2} más` : ''}
        </p>
      </div>
      <button onclick="App.wakeAllSiestas()" class="px-4 py-2.5 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all shadow-lg" style="background:linear-gradient(135deg, #9333ea, #7c3aed);box-shadow:0 4px 14px rgba(147,51,234,0.35);">
        Despertar todos
      </button>
    </div>
    ` : ''}

    <!-- Banner Salidas del Día (estudiantes retirados: ya no reciben más eventos) -->
    ${retirados.length > 0 ? `
    <div class="bg-white border-2 border-blue-300 rounded-[1.5rem] p-4 flex items-center gap-4 shadow-sm" style="background:linear-gradient(135deg, #eff6ff 0%, #f0f9ff 100%);">
      <div class="w-12 h-12 text-white rounded-2xl flex items-center justify-center text-xl shrink-0 shadow-lg" style="background:linear-gradient(135deg, #3b82f6, #2563eb);box-shadow:0 4px 14px rgba(59,130,246,0.35);">🚪</div>
      <div class="flex-1">
        <p class="text-sm font-black text-blue-800">${retirados.length} estudiante${retirados.length > 1 ? 's' : ''} se retiró${retirados.length > 1 ? 'n' : ''} del centro</p>
        <p class="text-[11px] font-bold text-blue-600">
          ${retirados.slice(0,2).map(s => s.name.split(' ')[0]).join(', ')}${retirados.length > 2 ? ` y ${retirados.length - 2} más` : ''} · ya no reciben más eventos
        </p>
      </div>
    </div>
    ` : ''}

    <!-- Alerta Momento del Día (solo si queda algún alumno sin registrar para ese evento) -->
    ${scheduleNowNeedsAction ? `
    <div class="bg-white border-2 rounded-[1.5rem] p-4 flex items-center gap-4 shadow-sm" style="border-color:rgba(255,138,0,0.3);background:linear-gradient(135deg, #fff7ed 0%, #fffbeb 100%);">
      <div class="w-12 h-12 text-white rounded-2xl flex items-center justify-center text-xl shrink-0 shadow-lg" style="background:linear-gradient(135deg, #FF8A00, #f97316);box-shadow:0 4px 14px rgba(255,138,0,0.35);">
        ${EVENT_TYPES[scheduleNow.type]?.icon || _getScheduleEventIcon(scheduleNow.type)}
      </div>
      <div class="flex-1">
        <p class="text-[10px] font-black uppercase tracking-wider" style="color:#FF8A00;">Momento del día</p>
        <p class="text-sm font-black text-slate-800">Es hora del ${scheduleNow.label}</p>
      </div>
      <button onclick="App.openBulkEventModal('${scheduleNow.type}', '${_formatTime12(scheduleNow.hour, scheduleNow.minute)}')"
        class="px-4 py-2.5 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all shadow-lg" style="background:linear-gradient(135deg, #FF8A00, #f97316);box-shadow:0 4px 14px rgba(255,138,0,0.35);">
        Registrar todos
      </button>
    </div>
    ` : ''}

    <!-- Acciones Colectivas del Aula (colapsable) -->
    <div class="bg-white border border-slate-100 rounded-[2rem] shadow-lg overflow-hidden" style="box-shadow:0 4px 24px rgba(0,0,0,0.04);">
      <div class="routine-section-toggle px-5 py-4 flex items-center justify-between" onclick="App.toggleRoutineSection('acciones')" aria-expanded="false" aria-controls="accionesBody">
        <div>
          <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Acciones del Aula</p>
          <p class="text-[9px] font-bold text-slate-300 mt-0.5">${withReport} de ${students.length} reportados</p>
        </div>
        <span class="acc-chevron text-slate-400 text-xs">▼</span>
      </div>
      <div id="accionesBody" class="routine-section-body collapsed px-5 pb-5">
        <div class="grid grid-cols-4 sm:grid-cols-6 gap-2.5">
          ${Object.entries(EVENT_TYPES).map(([type, meta]) => {
            const softBgs = {slate:'#f1f5f9',blue:'#eff6ff',sky:'#f0f9ff',amber:'#fffbeb',indigo:'#eef2ff',rose:'#fff1f2',purple:'#faf5ff',teal:'#f0fdfa',orange:'#fff7ed',yellow:'#fefce8',green:'#f0fdf4',lime:'#f7fee7',cyan:'#ecfeff'};
            const softBorders = {slate:'#cbd5e1',blue:'#93c5fd',sky:'#7dd3fc',amber:'#fcd34d',indigo:'#a5b4fc',rose:'#fda4af',purple:'#d8b4fe',teal:'#5eead4',orange:'#fdba74',yellow:'#fde047',green:'#86efac',lime:'#bef264',cyan:'#67e8f9'};
            const bg = softBgs[meta.color] || '#f1f5f9';
            const hovBorder = softBorders[meta.color] || '#cbd5e1';
            return `
            <button onclick="App.openBulkEventModal('${type}')"
              class="flex flex-col items-center gap-1.5 p-3 hover:bg-white border-2 border-transparent rounded-[1.2rem] transition-all active:scale-90 group" style="background:${bg};box-shadow:0 1px 3px rgba(0,0,0,0.04);--hov-bc:${hovBorder};" onmouseenter="this.style.borderColor=this.style.getPropertyValue('--hov-bc')" onmouseleave="this.style.borderColor='transparent'">
              <span class="text-2xl group-hover:scale-110 transition-transform">${meta.icon}</span>
              <span class="text-[9px] font-black uppercase tracking-tight leading-tight text-center" style="color:${hovBorder};">${meta.label}</span>
            </button>`;
          }).join('')}
        </div>
        <button onclick="App.registerMissingStudents()" class="w-full mt-3 py-2.5 bg-slate-50 hover:bg-slate-100 border-2 border-dashed border-slate-200 rounded-2xl text-[10px] font-black text-slate-400 uppercase tracking-widest transition-all active:scale-95">
          Registrar faltantes
        </button>
      </div>
    </div>

    <!-- ═══ NIVEL 3: TARJETAS DE LOS ALUMNOS (colapsable) ═══ -->
    <div class="bg-white border border-slate-100 rounded-[2rem] overflow-hidden shadow-sm" style="box-shadow:0 2px 12px rgba(0,0,0,0.03);">
      <!-- Resumen de leche del día -->
      ${(() => {
        const milk = _getDailyMilkSummary(logsMap, students);
        if (milk.count === 0) return '';
        return `
        <div class="flex items-center gap-2 mx-5 mt-4 px-3 py-2 bg-blue-50 rounded-xl border border-blue-100">
          <span class="text-sm">🍼</span>
          <span class="text-[9px] font-black text-blue-600 uppercase tracking-wider">Leche hoy:</span>
          <span class="text-[10px] font-black text-blue-800">${milk.totalOz} oz total · ${milk.count} registro${milk.count > 1 ? 's' : ''}</span>
        </div>`;
      })()}

      <!-- Header colapsable -->
      <div class="routine-section-toggle px-5 py-4 flex items-center justify-between" onclick="App.toggleRoutineSection('alumnos')" aria-expanded="true" aria-controls="alumnosBody">
        <div>
          <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Alumnos</p>
          <p class="text-[9px] font-bold text-slate-300 mt-0.5">${_filterStudents(students, _routineFilter, logsMap).length} de ${_getPresentStudentIds().length} presentes</p>
        </div>
        <span class="acc-chevron text-slate-400 text-xs">▼</span>
      </div>

      <div id="alumnosBody" class="routine-section-body px-5 pb-5">
        <!-- Filtros rápidos -->
        ${(() => {
          const counts = _getFilterCounts(students, logsMap);
          const filters = [
            { key: 'all', label: 'Todos', icon: '👥' },
            { key: 'unreported', label: 'Sin Reportar', icon: '⚠️' },
            { key: 'siesta', label: 'Durmiendo', icon: '😴' },
            { key: 'near_exit', label: 'Próx. Salir', icon: '⏰' },
            { key: 'retirado', label: 'Retirados', icon: '🚪' },
          ];
          return `
          <div id="routineFilterChips" class="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1" style="scrollbar-width:none;-webkit-overflow-scrolling:touch;">
            ${filters.map(f => `
              <button data-filter="${f.key}" onclick="App.setRoutineFilter('${f.key}')"
                class="flex items-center gap-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-all active:scale-95 shrink-0 min-h-[36px] ${
                  _routineFilter === f.key
                    ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-200 border border-orange-400'
                    : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100 hover:text-slate-700 hover:border-slate-300'
                }">
                <span class="text-xs">${f.icon}</span>
                <span>${f.label}</span>
                ${counts[f.key] > 0 ? `<span class="min-w-[18px] h-[18px] rounded-full ${_routineFilter === f.key ? 'bg-white/25 text-white' : 'bg-orange-100 text-orange-600'} flex items-center justify-center text-[8px] font-black">${counts[f.key]}</span>` : ''}
              </button>`).join('')}
          </div>`;
        })()}

        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3" id="routineStudentsGrid"></div>
      </div>
    </div>

    <p class="text-[10px] text-slate-400 text-center font-medium pb-2">
      Toca un alumno para ver su reporte completo
    </p>
  </div>`;
}

// ── TARJETA ESTUDIANTE (NIVEL 3) ──────────────────────────────────────────────
function _renderStudentRoutineCard(s, log) {
  const isValid    = !!(log && (log.mood || log.food || log.nap || log.notes || (log.events && log.events.length)));
  const mood       = isValid && log.mood  ? log.mood  : null;
  const food       = isValid && log.food  ? log.food  : null;
  const sleep      = isValid && log.nap   ? log.nap   : null;
  const note       = isValid && log.notes ? true       : false;
  const isDraft    = isValid && log.status === 'draft';
  const isInfant   = s.age_type === 'meses' || s.age_type === 'mes';
  const events     = isValid ? (log.events || log.infant_data || []) : [];
  const lastEvent  = events.length ? events[events.length - 1] : null;
  const hasBiberon = events.some(e => e.type === 'biberon' || e.type === 'milk' || e.type === 'structured_entry');
  const activeSiesta = events.filter(e => e.type === 'siesta').some(e => e.open === true);
  const isPresent  = _isStudentPresent(s.id);
  const isRetirado = _isStudentRetirado(s.id);
  const nearExit   = !isRetirado && isPresent && _isStudentNearExit(s);

  // Alerta de temperatura elevada
  const lastTemp = events.filter(e => e.type === 'temperatura' && e.temp != null).pop();
  const hasFever = lastTemp && parseFloat(lastTemp.temp) >= 37.5;

  const moodEmojiMap = {};
  MOOD_OPTIONS.forEach(m => { moodEmojiMap[m.value] = m.icon; });
  const moodEmojis = { ...moodEmojiMap, feliz: '😀', normal: '😐', triste: '😢', enojado: '😡' };
  const foodEmojis = { todo: '🍽️', poco: '🍲', nada: '🙅', all: '🍽️', half: '🥣', little: '🍲', none: '🙅' };
  const sleepEmojis = { si: '💤', no: '☀️' };

  const eventTypes = [];
  if (events.some(e => e.type === 'desayuno'))  eventTypes.push('🍞');
  if (events.some(e => e.type === 'almuerzo'))  eventTypes.push('🥗');
  if (events.some(e => e.type === 'siesta'))    eventTypes.push('😴');
  if (events.some(e => e.type === 'actividad')) eventTypes.push('📚');
  if (events.some(e => e.type === 'bano'))      eventTypes.push('🚽');
  if (hasBiberon)                               eventTypes.push('🍼');

  return `
    <div class="swipe-card" data-student-id="${s.id}" data-present="${isPresent}" data-retirado="${isRetirado}">
      <div class="swipe-action-left">🚫</div>
      <div class="swipe-action-left swipe-hint-left" style="position:absolute;top:50%;left:8px;transform:translateY(-50%);font-size:7px;font-weight:900;text-transform:uppercase;color:#fff;">Ausente</div>
      <div class="swipe-action-right">🍽️</div>
      <div class="swipe-action-right swipe-hint-right" style="position:absolute;top:50%;right:8px;transform:translateY(-50%);font-size:7px;font-weight:900;text-transform:uppercase;color:#fff;">Comió todo</div>
      <div onclick="App.openStudentRoutine('${s.id}')"
        class="group relative bg-white rounded-[1.5rem] p-3 border-2 ${hasFever ? 'border-red-400 bg-red-50/40 shadow-lg shadow-red-100/50' : isRetirado ? 'border-blue-400 bg-blue-50/60' : !isPresent ? 'border-dashed border-slate-200 opacity-60' : isDraft ? 'border-dashed border-[#FF8A00]/40 bg-orange-50/20' : isValid ? 'border-[#28B54D]/30' : 'border-slate-100'} hover:border-[#FF8A00] hover:shadow-xl hover:shadow-orange-100 transition-all cursor-pointer active:scale-95 flex flex-col overflow-hidden">
      ${hasFever ? '<div class="absolute top-2 left-2 z-10"><span class="px-2 py-0.5 bg-red-500 text-white text-[8px] font-black uppercase rounded-lg shadow-sm animate-pulse">🔥 Fiebre ' + lastTemp.temp + '°C</span></div>' : ''}

      ${isRetirado ? '<div class="absolute top-2 left-2 z-10"><span class="px-2 py-0.5 bg-blue-500 text-white text-[8px] font-black uppercase rounded-lg shadow-sm">Salió del centro</span></div>' : ''}
      ${nearExit ? '<div class="absolute top-2 left-2 z-10"><span class="px-2 py-0.5 bg-amber-500 text-white text-[8px] font-black uppercase rounded-lg shadow-sm animate-pulse">⏰ Próximo a salir</span></div>' : ''}
      ${!isRetirado && !isPresent ? '<div class="absolute top-2 left-2 z-10"><span class="px-2 py-0.5 bg-slate-400 text-white text-[8px] font-black uppercase rounded-lg">Ausente</span></div>' : ''}
      ${isDraft ? '<div class="absolute top-2 left-2 z-10"><span class="px-2 py-0.5 bg-[#FF8A00] text-white text-[8px] font-black uppercase rounded-lg">Borrador</span></div>' : ''}
      ${activeSiesta ? '<div class="absolute top-2 left-2 z-10 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-sm shadow-md animate-pulse">😴</div>' : ''}

      <div class="flex items-center gap-2.5 mb-2">
        <div class="w-11 h-11 rounded-xl bg-orange-50 border-2 border-white shadow-inner overflow-hidden shrink-0 flex items-center justify-center font-black text-base text-orange-300 group-hover:scale-105 transition-transform">
          ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover" loading="lazy">` : s.name.charAt(0)}
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="text-[11px] font-black text-slate-800 leading-tight truncate">${safeEscapeHTML(s.name)}</h4>
          <p class="text-[9px] font-bold text-slate-400 uppercase">${s.age} ${s.age_type || 'años'}${s.exit_time ? ' · Sale ' + _formatTime12(...s.exit_time.split(':').map(Number)) : ''}</p>
        </div>
        <div class="flex flex-col gap-0.5 shrink-0">
          ${mood ? `<div class="w-5 h-5 bg-orange-50 rounded-full flex items-center justify-center text-[10px] border border-orange-100">${moodEmojis[mood] || '😐'}</div>` : ''}
          ${(!isInfant && food) ? `<div class="w-5 h-5 bg-emerald-50 rounded-full flex items-center justify-center text-[10px] border border-emerald-100">${foodEmojis[food] || '🍽️'}</div>` : ''}
          ${(isInfant && hasBiberon) ? '<div class="w-5 h-5 bg-blue-50 rounded-full flex items-center justify-center text-[10px] border border-blue-100">🍼</div>' : ''}
          ${sleep ? `<div class="w-5 h-5 bg-indigo-50 rounded-full flex items-center justify-center text-[10px] border border-indigo-100">${sleepEmojis[sleep] || '💤'}</div>` : ''}
        </div>
      </div>

      ${eventTypes.length > 0 ? `
      <div class="flex items-center gap-0.5 flex-wrap mb-1.5">
        ${eventTypes.map(e => `<span class="text-[10px] leading-none">${e}</span>`).join('')}
      </div>
      ` : ''}

      <div class="mt-auto flex items-center justify-between">
        ${lastEvent ? `<p class="text-[8px] font-bold text-slate-300">${_formatTime(lastEvent.created_at)}</p>` : '<p class="text-[8px] font-bold text-slate-200">Sin registros</p>'}
        <div class="flex gap-1">
          <div class="w-2 h-2 rounded-full ${mood ? 'bg-[#FF8A00]' : 'bg-slate-200'}"></div>
          <div class="w-2 h-2 rounded-full ${isInfant ? (hasBiberon ? 'bg-blue-400' : 'bg-slate-200') : (food ? 'bg-[#28B54D]' : 'bg-slate-200')}"></div>
          <div class="w-2 h-2 rounded-full ${sleep ? 'bg-indigo-400' : 'bg-slate-200'}"></div>
        </div>
      </div>
    </div>`;
}

// ── TOGGLE TIMELINE ───────────────────────────────────────────────────────────
export function toggleTimeline() {
  // En móvil, "ocultar" abre una ventana de todos los eventos que sube desde abajo
  // (evita la barra horizontal de iconos). En desktop mantiene colapsar/expandir.
  if (window.innerWidth < 640) {
    openTimelineSheet();
    return;
  }
  _timelineExpanded = !_timelineExpanded;
  const expanded  = document.getElementById('timelineExpanded');
  const collapsed = document.getElementById('timelineCollapsed');
  const icon      = document.getElementById('timelineToggleIcon');
  const label     = document.getElementById('timelineToggleLabel');

  if (_timelineExpanded) {
    expanded?.classList.remove('hidden');
    collapsed?.classList.add('hidden');
    if (icon) icon.textContent = '▲';
    if (label) label.textContent = 'Ocultar';
  } else {
    expanded?.classList.add('hidden');
    collapsed?.classList.remove('hidden');
    if (icon) icon.textContent = '▼';
    if (label) label.textContent = 'Abrir';
    const activeIdx = _getActiveScheduleIndex();
    const scroll = document.getElementById('timelineCollapsedScroll');
    if (scroll && activeIdx >= 0) {
      const btns = scroll.querySelectorAll('button');
      if (btns[activeIdx]) btns[activeIdx].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }
}

// ── REFRESH HELPERS ───────────────────────────────────────────────────────────
function _refreshReportCount() {
  const students = AppState.get('students') || [];
  const logsMap  = AppState.get('logsMap') || {};
  const withReport = _countReportedStudents(logsMap, students);
  const badge = document.querySelector('#routineWrapper .text-\\[\\#28B54D\\]');
  if (badge) badge.textContent = `${withReport}/${students.length} reportes`;
  const countEl = document.querySelectorAll('#routineWrapper .text-slate-300');
  countEl.forEach(el => { if (el.textContent.includes(' de ')) el.textContent = `${withReport} de ${students.length}`; });
}

// ── REGISTER MISSING STUDENTS ─────────────────────────────────────────────────
export async function registerMissingStudents() {
  const students  = AppState.get('students') || [];
  const logsMap   = AppState.get('logsMap') || {};
  const missing   = students.filter(s => {
    if (_isStudentRetirado(s.id)) return false;
    if (!_isStudentPresent(s.id)) return false;
    const log = logsMap[s.id];
    return !log || !(log.mood || log.food || log.nap || log.notes || (log.events && log.events.length));
  });
  if (!missing.length) { safeToast('Todos los alumnos ya tienen registro hoy'); return; }
  if (!confirm(`¿Registrar ${missing.length} alumno${missing.length > 1 ? 's' : ''} faltante${missing.length > 1 ? 's' : ''} como presentes?`)) return;

  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  try {
    await Promise.all(missing.map(s =>
      MaestraApi.upsertDailyLog({ student_id: s.id, classroom_id: classroom.id, date: today, events: [] })
    ));
    await _logTimelineEvent(classroom, 'registro_manual', missing.map(s => s.id));
    safeToast(`${missing.length} alumno${missing.length > 1 ? 's' : ''} registrado${missing.length > 1 ? 's' : ''}`);
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
    _refreshReportCount();
  } catch (e) {
    safeToast('Error al registrar faltantes', 'error');
  }
}

// ── MODAL COLECTIVO (BULK) — DISEÑO PROFESIONAL ──────────────────────────────
export async function openBulkEventModal(eventType = 'animo', scheduledTime = null) {
  const students = AppState.get('students') || [];
  const meta = _getEventMeta(eventType) || { icon: '📝', label: eventType, color: 'slate' };
  const modalId = 'bulkEventModal';

  if (!scheduledTime) {
    const schedEv = _getScheduledEventByType(eventType);
    if (schedEv) scheduledTime = _formatTime12(schedEv.hour, schedEv.minute);
  }
  _bulkScheduledTime = scheduledTime;

  const subParams = _renderSubParams(eventType);

  const chipsHTML = students.map(s => {
    const isPresent = _isStudentPresent(s.id);
    const isRetirado = _isStudentRetirado(s.id);
    if (isRetirado) return `
    <div class="flex items-center gap-2 px-3 py-2.5 bg-blue-50/80 border-2 border-blue-200/60 rounded-2xl opacity-70 cursor-not-allowed">
      <div class="w-8 h-8 rounded-full bg-slate-200 overflow-hidden shrink-0 flex items-center justify-center text-xs font-black text-slate-500">
        ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : s.name.charAt(0)}
      </div>
      <div class="flex-1 min-w-0 text-left">
        <span class="text-[11px] font-black text-slate-700 leading-tight block truncate">${s.name.split(' ')[0]}</span>
        <span class="text-[8px] font-bold text-blue-500 uppercase">🚪 Salió del centro</span>
      </div>
    </div>`;
    if (!isPresent) return `
    <div class="flex items-center gap-2 px-3 py-2.5 bg-slate-50/80 border-2 border-slate-200/50 rounded-2xl opacity-50 cursor-not-allowed">
      <div class="w-8 h-8 rounded-full bg-slate-200 overflow-hidden shrink-0 flex items-center justify-center text-xs font-black text-slate-500">
        ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : s.name.charAt(0)}
      </div>
      <div class="flex-1 min-w-0 text-left">
        <span class="text-[11px] font-black text-slate-700 leading-tight block truncate">${s.name.split(' ')[0]}</span>
        <span class="text-[8px] font-bold text-red-400 uppercase">Ausente</span>
      </div>
    </div>`;
    return `
    <button type="button" data-sid="${s.id}" onclick="this.classList.toggle('selected'); this.classList.toggle('ring-2'); this.classList.toggle('ring-[#28B54D]');"
      class="selected ring-2 ring-[#28B54D] flex items-center gap-2 px-3 py-2.5 bg-green-50/80 border-2 border-[#28B54D]/20 rounded-2xl transition-all active:scale-95 hover:border-[#28B54D] hover:bg-green-50">
      <div class="w-8 h-8 rounded-full bg-slate-200 overflow-hidden shrink-0 flex items-center justify-center text-xs font-black text-slate-500">
        ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : s.name.charAt(0)}
      </div>
      <div class="flex-1 min-w-0 text-left">
        <span class="text-[11px] font-black text-slate-700 leading-tight block truncate">${s.name.split(' ')[0]}</span>
        <span class="text-[8px] font-bold text-[#28B54D] uppercase">Presente</span>
      </div>
    </button>`;
  }).join('');

  const content = `
    <style>
      #bulkEventModal-inner{margin:auto auto 0 !important;animation:sheetUp .26s cubic-bezier(.32,.72,.3,1)}
      @media (min-width:640px){#bulkEventModal-inner{margin:auto !important}}
      @keyframes sheetUp{from{transform:translateY(100%);opacity:.4}to{transform:translateY(0);opacity:1}}
    </style>
    <div class="w-full sm:max-w-md flex items-end sm:items-center justify-center" style="height:min(90vh,680px);min-height:60vh;">
    <div class="bg-white w-full rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl overflow-hidden flex flex-col" style="max-height:100%;">
      <div class="pt-2 pb-1 flex justify-center sm:hidden"><span class="w-10 h-1.5 rounded-full bg-slate-200"></span></div>
      <!-- Header con gradiente -->
      <div class="px-4 sm:px-5 py-3 sm:py-4 text-white relative overflow-hidden" style="background:linear-gradient(135deg, #28B54D 0%, #10b981 50%, #14b8a6 100%);">
        <div class="absolute -top-8 -right-8 w-32 h-32 rounded-full blur-2xl" style="background:rgba(255,255,255,0.1);"></div>
        <div class="absolute -bottom-8 -left-8 w-24 h-24 rounded-full blur-xl" style="background:rgba(255,255,255,0.1);"></div>
        <div class="relative flex items-center gap-3 sm:gap-4">
          <div class="w-11 h-11 sm:w-14 sm:h-14 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center text-xl sm:text-2xl border border-white/20 shadow-lg shrink-0">${meta.icon}</div>
          <div class="flex-1 min-w-0">
            <h3 class="text-lg sm:text-xl font-black truncate">${meta.label}</h3>
            <p class="text-[10px] sm:text-xs font-bold text-green-100 uppercase tracking-widest">Registro colectivo</p>
            ${scheduledTime ? `<p class="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 bg-white/15 backdrop-blur-sm border border-white/20 rounded-full text-[10px] font-black text-white">⏰ Programado · ${scheduledTime}</p>` : ''}
          </div>
          <button onclick="Modal.close('${modalId}')" class="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors border border-white/20 shrink-0">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <div class="overflow-y-auto flex-1 p-4 sm:p-5 space-y-5 custom-scrollbar" style="-webkit-overflow-scrolling:touch;">
        ${subParams}

        <div>
          <div class="flex items-center justify-between mb-3">
            <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">¿A quién aplica?</p>
            <div class="flex gap-2">
              <button type="button" onclick="_bulkSelectAll(true)"  class="text-[9px] font-black text-[#28B54D] hover:underline uppercase">Todos</button>
              <button type="button" onclick="_bulkSelectAll(false)" class="text-[9px] font-black text-slate-400 hover:underline uppercase">Ninguno</button>
            </div>
          </div>
          <div id="bulkChipsGrid" class="flex flex-wrap gap-2">
            ${chipsHTML}
          </div>
        </div>
      </div>

      <div class="p-3 sm:p-4 bg-white border-t border-slate-100 shrink-0">
        <button id="btnBulkConfirm" onclick="App.confirmBulkEvent('${eventType}')"
          class="w-full py-3 sm:py-3.5 text-white rounded-2xl font-black text-sm uppercase tracking-widest active:scale-[0.98] transition-colors flex items-center justify-center gap-2" style="background:#FF8A00 !important;border:2px solid #E67A00 !important;box-shadow:0 6px 20px rgba(255,138,0,0.4);">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Confirmar
        </button>
      </div>
    </div>
    </div>`;

  Modal.open(modalId, content);
  if (window.lucide) window.lucide.createIcons();
}

// ── INSERTAR EVENTO ENTRE BLOQUES ────────────────────────────────────────────
export function openInsertEventPicker(index) {
  const modalId = 'insertEventPickerModal';

  const catsHTML = Object.entries(CATEGORIES).map(([catId, cat]) => {
    const items = EVENT_CATALOG.filter(e => e.category === catId);
    if (!items.length) return '';
    return `
      <div class="space-y-2">
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
          <span>${cat.icon}</span> ${cat.label}
        </p>
        <div class="grid grid-cols-4 gap-2">
          ${items.map(ev => `
            <button onclick="App.insertEventAt(${index}, '${ev.type}')"
              class="flex flex-col items-center gap-1 p-3 bg-slate-50 hover:bg-[#FF8A00]/10 border-2 border-transparent hover:border-[#FF8A00]/30 rounded-2xl transition-all active:scale-90 group">
              <span class="text-xl group-hover:scale-110 transition-transform">${ev.icon}</span>
              <span class="text-[8px] font-black text-slate-400 uppercase text-center leading-tight">${ev.label}</span>
            </button>`).join('')}
        </div>
      </div>`;
  }).join('');

  const content = `
    <div class="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col" style="max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);">
      <div class="p-4 sm:p-5 text-white relative overflow-hidden" style="background:linear-gradient(135deg, #FF8A00 0%, #f97316 50%, #ec4899 100%);">
        <div class="absolute -top-8 -right-8 w-32 h-32 rounded-full blur-2xl" style="background:rgba(255,255,255,0.1);"></div>
        <div class="relative flex items-center gap-3 sm:gap-4">
          <div class="w-10 h-10 sm:w-12 sm:h-12 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center text-xl sm:text-2xl border border-white/20 shadow-lg shrink-0">➕</div>
          <div class="flex-1 min-w-0">
            <h3 class="text-base sm:text-lg font-black truncate">Insertar evento</h3>
            <p class="text-[9px] sm:text-[10px] font-bold text-orange-100 uppercase tracking-widest">En la cronología del día</p>
          </div>
          <button onclick="Modal.close('${modalId}')" class="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors border border-white/20 shrink-0">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="p-4 flex-1 overflow-y-auto custom-scrollbar space-y-4" style="-webkit-overflow-scrolling:touch;">
        ${catsHTML}
      </div>
    </div>`;

  Modal.open(modalId, content);
  if (window.lucide) window.lucide.createIcons();
}

export async function insertEventAt(index, type) {
  const schedule = _classroomSchedule.length ? [..._classroomSchedule] : [...DEFAULT_SCHEDULE];
  const meta = _getEventMeta(type) || { label: type, icon: '⏰', defaultDuration: 30, category: 'personalizados' };
  let duration = meta.defaultDuration || 30;

  const prev      = index > 0 ? schedule[index - 1] : null;
  const next      = index < schedule.length ? schedule[index] : null;
  const prevEnd   = prev ? (prev.hour ?? 0) * 60 + (prev.minute ?? 0) + (prev.duration || 30) : 7 * 60;
  const nextStart = next ? (next.hour ?? 0) * 60 + (next.minute ?? 0) : 18 * 60;

  let start = prevEnd;
  if (start + duration > nextStart) {
    start = nextStart - duration;
    if (start < prevEnd) { start = prevEnd; duration = Math.max(5, nextStart - start); }
  }
  start = Math.round(start / 5) * 5;
  if (start > nextStart - duration) start = nextStart - duration;
  if (start < 0) start = 0;

  const tm = _minutesToTime(start);
  schedule.splice(index, 0, {
    type,
    label: meta.label || type,
    icon: meta.icon || '⏰',
    hour: tm.hour,
    minute: tm.minute,
    duration,
    category: meta.category || 'personalizados',
  });

  _classroomSchedule = schedule;
  try {
    await _persistSchedule(schedule);
    safeToast(`${meta.icon} ${meta.label} insertado en la cronología`);
    Modal.close('insertEventPickerModal');
    await _reRenderTimeline();
  } catch (e) {
    safeToast('Error al guardar la cronología', 'error');
  }
}

// Inyectar estilos de la cronología V8 al importar el módulo
_injectV8Styles();

function _renderSubParams(eventType) {
  switch (eventType) {
    case 'biberon':
      return `
        <div class="space-y-4">
          <div class="space-y-2">
            <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Onzas de leche</p>
            <div class="grid grid-cols-4 gap-2">
              ${[2,4,6,8].map(oz => `
                <button type="button" data-oz="${oz}" onclick="document.querySelectorAll('[data-oz]').forEach(b=>b.classList.remove('bg-blue-500','text-white','border-blue-500')); this.classList.add('bg-blue-500','text-white','border-blue-500');"
                  class="py-3.5 bg-blue-50 border-2 border-blue-200 rounded-2xl font-black text-sm text-blue-700 hover:bg-blue-100 transition-all active:scale-90">
                  ${oz}<span class="text-[9px]">oz</span>
                </button>`).join('')}
            </div>
          </div>
          <div class="space-y-2">
            <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Temperatura</p>
            <div class="grid grid-cols-4 gap-2">
              ${['Fría','Natural','Tibia','Caliente'].map(t => `
                <button type="button" data-milk-temp="${t}" onclick="document.querySelectorAll('[data-milk-temp]').forEach(b=>b.classList.remove('bg-sky-500','text-white','border-sky-500')); this.classList.add('bg-sky-500','text-white','border-sky-500');"
                  class="py-2.5 bg-sky-50 border-2 border-sky-200 rounded-2xl font-black text-[10px] text-sky-700 hover:bg-sky-100 transition-all active:scale-90 uppercase">
                  ${t}
                </button>`).join('')}
            </div>
          </div>
        </div>`;
    case 'temperatura': {
      const temps = [36.4,36.6,36.8,37.0,37.2,37.5,37.8,38.0];
      return `
        <div class="space-y-2">
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Temperatura</p>
          <div class="grid grid-cols-4 gap-2">
            ${temps.map(t => {
              const fiebre = t >= 37.5;
              return `
              <button type="button" data-temp="${t}" onclick="document.querySelectorAll('[data-temp]').forEach(b=>{b.classList.remove('bg-rose-500','text-white','border-rose-500','bg-blue-500','border-blue-400'); b.classList.add('bg-slate-50','border-slate-100');}); this.classList.remove('bg-slate-50','border-slate-100'); this.classList.add('${fiebre ? 'bg-rose-500' : 'bg-blue-500'}','${fiebre ? 'border-rose-500' : 'border-blue-400'}','text-white');"
                class="py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs ${fiebre ? 'text-rose-600' : 'text-slate-600'} hover:bg-slate-100 transition-all active:scale-90 relative">
                ${t}°${fiebre ? '<span class="absolute -top-1 -right-1 text-[8px]">🔥</span>' : ''}
              </button>`;}).join('')}
          </div>
      </div>
    </div>`;
}

// ── SWIPE GESTURE HANDLER ─────────────────────────────────────────────────────
let _swipeStartX = 0, _swipeStartY = 0, _swipeCurrentCard = null, _swipeLocked = false;
function _initSwipeHandlers() {
  const grid = document.getElementById('routineStudentsGrid');
  if (!grid || grid.dataset.swipeBound) return;
  grid.dataset.swipeBound = '1';
  grid.addEventListener('pointerdown', _onSwipeStart, { passive: true });
  grid.addEventListener('pointermove', _onSwipeMove, { passive: false });
  grid.addEventListener('pointerup', _onSwipeEnd, { passive: true });
  grid.addEventListener('pointercancel', _onSwipeEnd, { passive: true });
  grid.addEventListener('pointerleave', _onSwipeEnd, { passive: true });
}
function _onSwipeStart(e) {
  const card = e.target.closest('.swipe-card');
  if (!card) return;
  if (card.dataset.present !== 'true' || card.dataset.retirado === 'true') return;
  _swipeStartX = e.clientX;
  _swipeStartY = e.clientY;
  _swipeCurrentCard = card;
  _swipeLocked = false;
}
function _onSwipeMove(e) {
  if (!_swipeCurrentCard || _swipeLocked) return;
  const dx = e.clientX - _swipeStartX;
  const dy = e.clientY - _swipeStartY;
  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 15) { _swipeCurrentCard = null; return; }
  if (Math.abs(dx) < 10) return;
  e.preventDefault();
  const inner = _swipeCurrentCard.querySelector('[onclick]');
  if (inner) inner.style.transform = `translateX(${Math.max(-60, Math.min(60, dx))}px)`;
  _swipeCurrentCard.classList.toggle('swiping-left', dx < -15);
  _swipeCurrentCard.classList.toggle('swiping-right', dx > 15);
}
function _onSwipeEnd(e) {
  if (!_swipeCurrentCard) return;
  const card = _swipeCurrentCard;
  const inner = card.querySelector('[onclick]');
  const dx = (e.clientX || 0) - _swipeStartX;
  if (inner) inner.style.transform = '';
  card.classList.remove('swiping-left', 'swiping-right');
  if (Math.abs(dx) > 50) {
    _swipeLocked = true;
    const sid = card.dataset.studentId;
    if (dx < -50) {
      App.safeToast('⬅️ Deslizó izquierda — registrar como ausente');
    } else if (dx > 50) {
      App.registerIndividualEvent(sid, 'desayuno', { obs: 'Comió todo (swipe rápido)' });
      App.safeToast('➡️ Deslizó derecha — registrado como comió todo');
    }
    setTimeout(() => { _swipeCurrentCard = null; }, 100);
  } else {
    _swipeCurrentCard = null;
  }
}
    case 'medicamento':
      return `
        <div class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Nombre</p>
              <input id="medNombre" type="text" placeholder="Ej: Ibuprofeno" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-purple-400 transition-all">
            </div>
            <div class="space-y-1">
              <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Dosis</p>
              <input id="medDosis" type="text" placeholder="Ej: 5ml" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-purple-400 transition-all">
            </div>
          </div>
          <div class="space-y-1">
            <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Autorización</p>
            <input id="medAuth" type="text" placeholder="Ej: Padre autorizó" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-purple-400 transition-all">
          </div>
        </div>`;
    case 'animo':
      return `
        <div class="space-y-2">
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Estado de ánimo</p>
          <div class="grid grid-cols-4 gap-2">
            ${MOOD_OPTIONS.map(m => `
              <button type="button" data-mood="${m.value}" onclick="document.querySelectorAll('[data-mood]').forEach(b=>{b.classList.remove('border-orange-400','bg-orange-50');}); this.classList.add('border-orange-400','bg-orange-50');"
                class="flex flex-col items-center p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl transition-all active:scale-90 hover:border-orange-200 hover:bg-orange-50/50">
                <span class="text-2xl">${m.icon}</span>
                <span class="text-[8px] font-black text-slate-400 uppercase mt-1 leading-tight text-center">${m.label}</span>
              </button>`).join('')}
          </div>
        </div>`;
    case 'siesta':
      return `
        <div class="space-y-2">
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Acción de siesta</p>
          <div class="grid grid-cols-2 gap-3">
            <button type="button" data-siesta-action="iniciar"
              onclick="document.querySelectorAll('[data-siesta-action]').forEach(b=>{b.classList.remove('bg-indigo-500','text-white','border-indigo-500');}); this.classList.add('bg-indigo-500','text-white','border-indigo-500');"
              class="flex flex-col items-center gap-2 p-5 bg-indigo-50 border-2 border-indigo-200 rounded-2xl transition-all active:scale-95 hover:border-indigo-400">
              <span class="text-4xl">😴</span>
              <span class="text-xs font-black text-indigo-700 uppercase tracking-wide">Se durmió</span>
            </button>
            <button type="button" data-siesta-action="despertar"
              onclick="document.querySelectorAll('[data-siesta-action]').forEach(b=>{b.classList.remove('bg-indigo-500','text-white','border-indigo-500');}); this.classList.add('bg-indigo-500','text-white','border-indigo-500');"
              class="flex flex-col items-center gap-2 p-5 bg-amber-50 border-2 border-amber-200 rounded-2xl transition-all active:scale-95 hover:border-amber-400">
              <span class="text-4xl">☀️</span>
              <span class="text-xs font-black text-amber-700 uppercase tracking-wide">Despertó</span>
            </button>
          </div>
        </div>`;
    case 'nota':
      return `
        <div class="space-y-1">
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Observación grupal</p>
          <textarea id="bulkNota" rows="3" placeholder="Escribe aquí la nota para el grupo..." class="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium outline-none focus:border-slate-400 transition-all resize-none"></textarea>
        </div>`;
    default:
      return `
        <div class="space-y-1">
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Observaciones</p>
          <textarea id="bulkObs" rows="2" placeholder="Detalles del evento..." class="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium outline-none focus:border-slate-400 transition-all resize-none"></textarea>
        </div>`;
  }
}

window._bulkSelectAll = (select) => {
  document.querySelectorAll('#bulkChipsGrid button[data-sid]').forEach(b => {
    const sid = b.dataset.sid;
    if (_isStudentRetirado(sid) || !_isStudentPresent(sid)) return;
    if (select) { b.classList.add('selected','ring-2','ring-[#28B54D]'); }
    else { b.classList.remove('selected','ring-2','ring-[#28B54D]'); }
  });
};

// ── RATE LIMITERS ──────────────────────────────────────────────────────────────
const _bulkEventLimiter = new RateLimiter('bulk_event', 10, 60_000); // max 10 por minuto

// ── CONFIRMAR EVENTO COLECTIVO ────────────────────────────────────────────────
export async function confirmBulkEvent(eventType) {
  if (!_bulkEventLimiter.check()) {
    const secs = _bulkEventLimiter.remainingSeconds();
    safeToast(`Demasiados registros. Espera ${secs}s`, 'warning');
    return;
  }
  const btn = document.getElementById('btnBulkConfirm');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="animate-spin">⏳</span> Guardando...'; }

  try {
    const selected = [...document.querySelectorAll('#bulkChipsGrid button.selected[data-sid]')]
      .map(b => b.dataset.sid)
      .filter(sid => _isStudentPresent(sid));
    if (!selected.length) { safeToast('Selecciona al menos un estudiante presente', 'warning'); return; }

    const classroom = AppState.get('classroom');
    const today     = new Date().toISOString().split('T')[0];
    const logsMap   = AppState.get('logsMap') || {};

    const extra = {};
    if (eventType === 'biberon') {
      extra.oz    = parseFloat(document.querySelector('[data-oz].bg-blue-500')?.dataset.oz) || 0;
      if (extra.oz < 0 || extra.oz > 32) { safeToast('Onzas inválidas (0-32oz)', 'error'); return; }
      extra.milk_temp = document.querySelector('[data-milk-temp].bg-sky-500')?.dataset.milkTemp || null;
    }
    if (eventType === 'temperatura') {
      extra.temp  = parseFloat(document.querySelector('[data-temp].text-white')?.dataset.temp) || null;
      if (extra.temp !== null && (extra.temp < 30 || extra.temp > 45)) { safeToast('Temperatura inválida (30-45°C)', 'error'); return; }
    }
    if (eventType === 'medicamento')  {
      extra.nombre = (document.getElementById('medNombre')?.value || '').replace(/<[^>]*>/g, '').trim().substring(0, 100);
      extra.dosis  = (document.getElementById('medDosis')?.value || '').replace(/<[^>]*>/g, '').trim().substring(0, 100);
      extra.autorizacion = (document.getElementById('medAuth')?.value || '').replace(/<[^>]*>/g, '').trim().substring(0, 100);
    }
    if (eventType === 'animo')        extra.mood  = document.querySelector('[data-mood].border-orange-400')?.dataset.mood;
    if (eventType === 'nota')         extra.texto = (document.getElementById('bulkNota')?.value || '').replace(/<[^>]*>/g, '').trim().substring(0, 500);
    if (!['biberon','temperatura','medicamento','animo','nota'].includes(eventType)) {
      extra.obs = (document.getElementById('bulkObs')?.value || '').replace(/<[^>]*>/g, '').trim().substring(0, 500);
    }
    if (_bulkScheduledTime) extra.scheduled_time = _bulkScheduledTime;
    const siestaAction = eventType === 'siesta' ? document.querySelector('[data-siesta-action].bg-indigo-500')?.dataset.siestaAction : null;

    const prevState = {};
    const now = new Date().toISOString();
    const promises  = selected.map(async (sid) => {
      const currentLog = logsMap[sid] || {};
      prevState[sid]   = { ...currentLog };
      let newEvents;

      if (eventType === 'siesta' && siestaAction === 'despertar') {
        const events = [...(currentLog.events || [])];
        let closed = false;
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].type === 'siesta' && events[i].open) {
            const start = new Date(events[i].created_at);
            const mins  = Math.round((new Date(now) - start) / 60000);
            events[i] = { ...events[i], open: false, end_at: now, duration_min: mins };
            closed = true;
            break;
          }
        }
        if (!closed) events.push(_makeEvent('siesta', { open: false, end_at: now, duration_min: 0 }));
        newEvents = events;
      } else {
        const newEvent = _makeEvent(eventType, extra);
        if (eventType === 'siesta') newEvent.open = true;
        newEvents = _addEventToLog(currentLog, newEvent);
      }

      const payload = { student_id: sid, classroom_id: classroom.id, date: today, events: newEvents };
      if (eventType === 'animo'  && extra.mood) payload.mood = extra.mood;
      if (eventType === 'biberon')               payload.nap  = currentLog.nap || null;
      return MaestraApi.upsertDailyLog(payload);
    });

    await Promise.all(promises);

    await _logTimelineEvent(classroom, eventType, selected.map(Number), {
      metadata: { oz: extra.oz, temp: extra.temp, mood: extra.mood, milk_temp: extra.milk_temp, obs: extra.obs, scheduled_time: extra.scheduled_time }
    });

    _bulkScheduledTime = null;
    Modal.close('bulkEventModal');
    safeToast(`${_getEventMeta(eventType)?.label || eventType} registrado para ${selected.length} estudiante${selected.length > 1 ? 's' : ''}`);

    await _refreshLogsMap(classroom.id, today);
    _reRenderTimeline();
    _showUndoBar(eventType, selected, prevState);

  } catch (e) {
    safeToast('Error al guardar', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4"></i> Confirmar'; if (window.lucide) lucide.createIcons(); }
  }
}

// ── UNDO BAR ──────────────────────────────────────────────────────────────────
function _showUndoBar(eventType, sids, prevState) {
  clearTimeout(_undoTimer);
  _undoPayload = { eventType, sids, prevState };

  let el = document.getElementById('undoBarWrapper');
  if (!el) {
    el = document.createElement('div');
    el.id = 'undoBarWrapper';
    el.className = 'fixed bottom-0 left-0 right-0 z-[9999] p-4 flex justify-center pointer-events-none';
    document.body.appendChild(el);
  }

  el.innerHTML = `
    <div class="pointer-events-auto bg-slate-900 text-white rounded-2xl px-5 py-3 flex items-center gap-4 shadow-2xl max-w-sm w-full animate-slideUpFade">
      <span class="text-sm font-bold flex-1">${_getEventMeta(eventType)?.icon || '✅'} Registrado para ${sids.length} estudiante${sids.length > 1 ? 's' : ''}</span>
      <button onclick="App.undoLastBulk()" class="text-[#FF8A00] font-black text-xs uppercase tracking-widest hover:text-orange-400 transition-colors shrink-0">Deshacer</button>
      <div class="w-1 h-8 bg-slate-700 rounded-full overflow-hidden shrink-0">
        <div id="undoProgress" class="w-full bg-[#FF8A00] rounded-full transition-all" style="height:100%"></div>
      </div>
    </div>`;

  let pct = 100;
  const tick = setInterval(() => {
    pct -= 2;
    const prog = document.getElementById('undoProgress');
    if (prog) prog.style.height = pct + '%';
    if (pct <= 0) { clearInterval(tick); el.innerHTML = ''; _undoPayload = null; }
  }, 200);
  _undoTimer = setTimeout(() => { clearInterval(tick); el.innerHTML = ''; _undoPayload = null; }, 10000);
}

export async function undoLastBulk() {
  if (!_undoPayload) return;
  clearTimeout(_undoTimer);
  const { sids, prevState } = _undoPayload;
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  try {
    await Promise.all(sids.map(sid => {
      const prev = prevState[sid] || {};
      return MaestraApi.upsertDailyLog({
        student_id: sid, classroom_id: classroom.id, date: today,
        events: prev.events || [], mood: prev.mood || null, food: prev.food || null, nap: prev.nap || null
      });
    }));
    _undoPayload = null;
    document.getElementById('undoBarWrapper').innerHTML = '';
    safeToast('Registro revertido', 'success');
    await _refreshLogsMap(classroom.id, today);
    _reRenderTimeline();
  } catch (e) { safeToast('Error al deshacer', 'error'); }
}

async function _refreshLogsMap(classroomId, today) {
  const { data } = await supabase
    .from('daily_logs')
    .select('id, student_id, mood, food, nap, notes, status, created_at, infant_data, events')
    .eq('classroom_id', classroomId)
    .eq('date', today);
  const newMap = {};
  (data || []).forEach(l => { newMap[l.student_id] = l; });
  AppState.set('logsMap', newMap);

  // Also refresh attendance
  const { data: attData } = await supabase
    .from('attendance')
    .select('student_id, status, check_out')
    .eq('classroom_id', classroomId)
    .eq('date', today);
  AppState.set('attendance', attData || []);

  return newMap;
}

// Refresca el estado de asistencia en la rutina y re-renderiza (usa en realtime
// cuando un estudiante se retira desde la puerta/asistencia).
export async function refreshRoutineAttendance() {
  const classroom = AppState.get('classroom');
  const wrapper = document.getElementById('routineWrapper');
  if (!classroom || !wrapper) return;
  const today = new Date().toISOString().split('T')[0];
  try {
    await _refreshLogsMap(classroom.id, today);
    _reRenderTimeline();
  } catch { /* silencioso */ }
}

function _refreshStudentCards() {
  const students = AppState.get('students') || [];
  const logsMap  = AppState.get('logsMap') || {};
  const grid = document.getElementById('routineStudentsGrid');
  if (!grid) return;
  const filtered = _filterStudents(students, _routineFilter, logsMap);
  grid.innerHTML = filtered.map(s => _renderStudentRoutineCard(s, logsMap[s.id] || {})).join('');
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="col-span-full text-center py-8 text-slate-400"><p class="text-2xl mb-2">🔍</p><p class="text-[11px] font-bold">No hay alumnos en esta categoría</p></div>';
  }
  if (typeof _initSwipeHandlers === 'function') _initSwipeHandlers();
  if (window.lucide) window.lucide.createIcons();
}

// ── DESPERTAR SIESTAS ────────────────────────────────────────────────────────
export async function wakeAllSiestas() {
  const students   = AppState.get('students') || [];
  const logsMap    = AppState.get('logsMap') || {};
  const classroom  = AppState.get('classroom');
  const today      = new Date().toISOString().split('T')[0];
  const active     = _getActiveSiestas(students, logsMap);
  if (!active.length) return;

  try {
    const now = new Date().toISOString();
    await Promise.all(active.map(s => {
      const log    = logsMap[s.id];
      const events = [...(log.events || [])];
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'siesta' && events[i].open) {
          const mins = Math.round((new Date(now) - new Date(events[i].created_at)) / 60000);
          events[i] = { ...events[i], open: false, end_at: now, duration_min: mins };
          break;
        }
      }
      return MaestraApi.upsertDailyLog({ student_id: s.id, classroom_id: classroom.id, date: today, events, nap: 'si' });
    }));
    await _logTimelineEvent(classroom, 'siesta', active.map(s => s.id), { metadata: { action: 'wake_all' } });
    safeToast(`${active.length} siesta${active.length > 1 ? 's' : ''} cerrada${active.length > 1 ? 's' : ''}`);
    await _refreshLogsMap(classroom.id, today);
    _reRenderTimeline();
    const banner = document.querySelector('#routineWrapper [class*="border-purple-200"]');
    if (banner) banner.remove();
  } catch(e) { safeToast('Error al cerrar siestas', 'error'); }
}

// ── MODAL INDIVIDUAL ESTUDIANTE (NIVEL 4) ────────────────────────────────────
export async function openStudentRoutine(studentId) {
  const student = AppState.get('students').find(s => s.id == studentId);
  if (!student) return;
  const today = new Date().toISOString().split('T')[0];
  const { data: log } = await supabase.from('daily_logs').select('*').eq('student_id', studentId).eq('date', today).maybeSingle();
  const isInfant = student.age_type === 'meses' || student.age_type === 'mes';
  const modalId  = 'routineStudentModal';
  const content  = isInfant ? _renderInfantRoutineUI(student, log, modalId) : _renderStandardRoutineUI(student, log, modalId);
  Modal.open(modalId, content);
  if (window.lucide) window.lucide.createIcons();

  if (!isInfant && log && log.events) {
    const lastTemp = [...log.events].reverse().find(e => e.type === 'temperatura' && e.temp != null);
    if (lastTemp) {
      const btn = document.querySelector(`[data-ind-temp-${student.id}="${lastTemp.temp}"]`);
      if (btn) {
        btn.classList.remove('bg-slate-50','border-slate-100');
        btn.classList.add(lastTemp.temp >= 37.5 ? 'bg-rose-500' : 'bg-blue-500', lastTemp.temp >= 37.5 ? 'border-rose-500' : 'border-blue-400','text-white');
      }
    }
  }
}

// ── MODAL INDIVIDUAL: ESTÁNDAR (NIVEL 4) ─────────────────────────────────────
function _accSection(title, icon, inner, open = false) {
  return `
    <details class="acc-section rounded-2xl bg-slate-50/60 border border-slate-100 overflow-hidden transition-colors" ${open ? 'open' : ''}>
      <summary class="flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer select-none list-none">
        <span class="text-base leading-none shrink-0">${icon}</span>
        <span class="text-[11px] font-black text-slate-500 uppercase tracking-widest flex-1 truncate">${title}</span>
        <svg class="acc-chev w-4 h-4 text-slate-300 shrink-0 transition-transform duration-200" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
      </summary>
      <div class="px-3.5 pb-3 pt-1">${inner}</div>
    </details>`;
}

function _renderStandardRoutineUI(student, log, modalId) {
  const isValid      = log && _isWithin12h(log.created_at);
  const currentMood  = isValid ? (log.mood  || '') : '';
  const currentFood  = isValid ? (log.food  || '') : '';
  const currentSleep = isValid ? (log.nap   || '') : '';
  const currentNotes = isValid ? (log.notes || '') : '';
  const events       = isValid ? (log.events || []) : [];
  const isRetirado   = _isStudentRetirado(student.id);

  const moodEmojiMap = {};
  MOOD_OPTIONS.forEach(m => { moodEmojiMap[m.value] = m.icon; });

  const foodOptions = [
    { value: 'nada',  icon: '🙅', label: 'No comió' },
    { value: 'poco',  icon: '🍲', label: 'Poco' },
    { value: 'half',  icon: '🥣', label: 'Mitad' },
    { value: 'all',   icon: '🍽️', label: 'Todo' },
  ];

  const timelineHTML = events.length ? events.map(ev => {
    const meta = _getEventMeta(ev.type) || { icon: '📋', label: ev.type };
    const icon = meta.icon;
    const label = meta.label;
    let detail = '';
    if (ev.type === 'biberon') { const p = []; if (ev.oz) p.push(`${ev.oz} oz`); if (ev.milk_temp) p.push(ev.milk_temp); detail = p.join(' · '); }
    if (ev.type === 'temperatura') detail = ev.temp ? `${ev.temp}°C ${parseFloat(ev.temp) >= 37.5 ? '🔥' : ''}` : '';
    if (ev.type === 'medicamento') detail = [ev.nombre, ev.dosis, ev.autorizacion].filter(Boolean).join(' · ');
    if (ev.type === 'siesta') detail = ev.duration_min ? `${ev.duration_min} min` : (ev.open ? 'En curso...' : '');
    if (ev.type === 'nota') detail = ev.texto ? (ev.texto.length > 40 ? ev.texto.substring(0,40)+'…' : ev.texto) : '';
    if (ev.type === 'fiebre') detail = ev.temp ? `${ev.temp}°C` : '';
    if (ev.type === 'medicamento_extra') detail = [ev.nombre, ev.dosis].filter(Boolean).join(' · ');
    if (ev.type === 'llamada_padres') detail = ev.motivo || '';

    return `
      <div class="flex items-start gap-3 group">
        <div class="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-sm shrink-0 group-hover:scale-110 transition-transform">${icon}</div>
        <div class="flex-1 min-w-0">
          <p class="text-[10px] font-black text-slate-400">${_formatTime(ev.created_at)}</p>
          <p class="text-xs font-bold text-slate-700">${label}${detail ? ` · ${detail}` : ''}</p>
        </div>
      </div>`;
  }).join('') : '<p class="text-xs text-slate-400 italic">Sin eventos registrados hoy.</p>';

  const activeSiesta = events.find(e => e.type === 'siesta' && e.open);
  const schedForStudent = _classroomSchedule.length ? _classroomSchedule : DEFAULT_SCHEDULE;
  const routineQuickHTML = schedForStudent.map(ev => {
    const meta = _getEventMeta(ev.type) || {};
    const time = _formatTime12(ev.hour, ev.minute);
    const regs = events.filter(e => e.type === ev.type);
    const registered = regs.length && (regs.some(e => (e.scheduled_time || '') === time) || regs.every(e => !e.scheduled_time));
    return `
      <button onclick="App.registerIndividualEvent('${student.id}','${ev.type}',{scheduled_time:'${time}'})"
        class="relative flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all active:scale-90 ${registered ? 'bg-green-50 border-[#28B54D]/40 opacity-80' : 'bg-slate-50 hover:bg-slate-100 border-transparent hover:border-slate-200'}">
        ${registered ? '<span class="absolute top-1 right-1 text-[9px]">✅</span>' : ''}
        <span class="text-lg">${_getScheduleEventIcon(ev.type)}</span>
        <span class="text-[8px] font-black ${registered ? 'text-[#28B54D]' : 'text-slate-400'} uppercase leading-tight text-center">${ev.label || meta.label || ev.type}</span>
        <span class="text-[8px] font-black ${registered ? 'text-[#28B54D]' : 'text-[#FF8A00]'}">${time}</span>
      </button>`;
  }).join('');
  const siestaSection = activeSiesta ? (() => {
    const elapsed = Math.round((Date.now() - new Date(activeSiesta.created_at)) / 60000);
    return `
      <div class="p-4 bg-purple-50 border-2 border-purple-200 rounded-2xl flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span class="text-2xl animate-pulse">😴</span>
          <div>
            <p class="text-xs font-black text-purple-800">Durmiendo ahora</p>
            <p class="text-[10px] font-bold text-purple-600">Desde ${_formatTime(activeSiesta.created_at)} · ${elapsed}min</p>
          </div>
        </div>
        <button onclick="App.wakeStudentSiesta('${student.id}')"
          class="px-3 py-2 bg-purple-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-purple-700 active:scale-90 transition-all shrink-0 shadow-md shadow-purple-200">
          ☀️ Despertó
        </button>
      </div>`;
  })() : `
    <div class="grid grid-cols-2 gap-2">
      ${Object.entries({si:'💤',no:'☀️'}).map(([v,e]) => `
        <button onclick="App.updateRoutineFieldInModal('${student.id}','sleep','${v}')"
          class="routine-modal-sleep-${student.id} flex items-center justify-center gap-3 p-4 rounded-2xl border-2 transition-all active:scale-90 ${currentSleep===v ? 'border-indigo-400 bg-indigo-50 shadow-md' : 'border-slate-100 bg-slate-50'}" data-val="${v}">
          <span class="text-2xl">${e}</span>
          <span class="text-xs font-black uppercase text-slate-600">${v==='si' ? 'Durmió' : 'No durmió'}</span>
        </button>`).join('')}
    </div>`;

  return `
    <div class="bg-white w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col" style="max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);">
      <!-- Header con gradiente -->
      <div class="p-3.5 sm:p-5 text-white relative overflow-hidden shrink-0" style="background:linear-gradient(135deg, #FF8A00 0%, #f97316 40%, #ec4899 100%);">
        <div class="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl" style="background:rgba(255,255,255,0.1);"></div>
        <div class="absolute -bottom-10 -left-10 w-32 h-32 rounded-full blur-2xl" style="background:rgba(255,255,255,0.1);"></div>
        <button onclick="Modal.close('${modalId}')" class="absolute top-2.5 right-2.5 p-2 rounded-full hover:bg-white/30 transition-colors border border-white/20 z-10" style="background:rgba(255,255,255,0.2);backdrop-filter:blur(4px);">
          <svg class="w-4 h-4" fill="none" stroke="white" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
        <div class="relative flex items-center gap-3 sm:gap-4">
          <div class="w-10 h-10 sm:w-14 sm:h-14 rounded-2xl overflow-hidden flex items-center justify-center font-black text-lg sm:text-2xl shrink-0 shadow-lg" style="background:rgba(255,255,255,0.2);backdrop-filter:blur(4px);border:2px solid rgba(255,255,255,0.3);color:white;">
            ${student.avatar_url ? `<img src="${student.avatar_url}" class="w-full h-full object-cover" style="color:transparent;">` : `<span style="color:white;">${student.name.charAt(0)}</span>`}
          </div>
          <div class="min-w-0">
            <h3 class="text-base sm:text-lg font-black truncate" style="color:white !important;text-shadow:0 1px 3px rgba(0,0,0,0.15);">${safeEscapeHTML(student.name)}</h3>
            <p class="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest" style="color:rgba(255,255,255,0.85);">Reporte de Rutina</p>
          </div>
        </div>
      </div>

      <div class="p-3 sm:p-4 space-y-2.5 overflow-y-auto flex-1 custom-scrollbar" style="-webkit-overflow-scrolling:touch;">

        ${isRetirado ? `
        <div class="rounded-2xl p-3.5 flex items-center gap-3 border-2 border-blue-200" style="background:linear-gradient(135deg, #eff6ff 0%, #f0f9ff 100%);">
          <div class="w-9 h-9 text-white rounded-xl flex items-center justify-center text-base shrink-0 shadow-sm" style="background:linear-gradient(135deg, #3b82f6, #2563eb);">🚪</div>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-black text-blue-800">Se retiró del centro</p>
            <p class="text-[10px] font-bold text-blue-600">Ya no se registran más eventos de la plantilla para hoy.</p>
          </div>
        </div>` : ''}

        ${_accSection('Estado emocional', '😊', `
          <div class="grid grid-cols-4 gap-1.5">
            ${MOOD_OPTIONS.map(m => `
              <button onclick="App.updateRoutineFieldInModal('${student.id}','mood','${m.value}')"
                class="routine-modal-mood-${student.id} flex flex-col items-center p-2 rounded-2xl border-2 transition-all active:scale-90 ${currentMood===m.value ? 'border-[#FF8A00] bg-orange-50 shadow-md' : 'border-slate-100 bg-slate-50 hover:border-orange-200'}" data-val="${m.value}">
                <span class="text-lg">${m.icon}</span>
                <span class="text-[7px] font-black uppercase text-slate-500 leading-tight text-center mt-0.5">${m.label}</span>
              </button>`).join('')}
          </div>`, true)}

        ${_accSection('Alimentación', '🍽️', `
          <div class="grid grid-cols-4 gap-2">
            ${foodOptions.map(f => `
              <button onclick="App.updateRoutineFieldInModal('${student.id}','food','${f.value}')"
                class="routine-modal-food-${student.id} flex flex-col items-center p-2.5 rounded-2xl border-2 transition-all active:scale-90 ${currentFood===f.value ? 'border-[#28B54D] bg-green-50 shadow-md' : 'border-slate-100 bg-slate-50 hover:border-green-200'}" data-val="${f.value}">
                <span class="text-lg">${f.icon}</span>
                <span class="text-[8px] font-black uppercase text-slate-500 leading-tight text-center">${f.label}</span>
              </button>`).join('')}
          </div>`, true)}

        ${_accSection('Siesta', '😴', siestaSection, true)}

        ${_accSection('Biberón', '🍼', `
          <div class="bg-blue-50 border border-blue-100 rounded-2xl p-3 space-y-2">
            <div class="grid grid-cols-4 gap-2">
              ${[2,4,6,8].map(oz => `
                <button onclick="App.registerIndividualEvent('${student.id}','biberon',{oz:${oz}}); App.safeToast('${oz}oz registrado ✓');"
                  class="py-2.5 bg-blue-50 border-2 border-blue-200 rounded-2xl font-black text-sm text-blue-700 hover:bg-blue-100 transition-all active:scale-90">
                  ${oz}<span class="text-[9px]">oz</span>
                </button>`).join('')}
            </div>
            <div class="grid grid-cols-4 gap-2">
              ${['Fría','Natural','Tibia','Caliente'].map(t => `
                <button onclick="this.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('bg-sky-500','text-white','border-sky-500')); this.classList.add('bg-sky-500','text-white','border-sky-500');"
                  class="py-2 bg-sky-50 border-2 border-sky-200 rounded-2xl font-black text-[10px] text-sky-700 hover:bg-sky-100 transition-all active:scale-90 uppercase">
                  ${t}
                </button>`).join('')}
            </div>
          </div>`, false)}

        ${_accSection('Temperatura', '🌡️', `
          <div class="grid grid-cols-4 gap-2">
            ${[36.4,36.6,36.8,37.0,37.2,37.5,37.8,38.0].map(t => {
              const fiebre = t >= 37.5;
              return `<button type="button" data-ind-temp-${student.id}="${t}"
                onclick="document.querySelectorAll('[data-ind-temp-${student.id}]').forEach(b=>{b.classList.remove('bg-rose-500','bg-blue-500','text-white','border-rose-500','border-blue-400'); b.classList.add('bg-slate-50','border-slate-100');}); this.classList.remove('bg-slate-50','border-slate-100'); this.classList.add('${fiebre ? 'bg-rose-500' : 'bg-blue-500'}','${fiebre ? 'border-rose-500' : 'border-blue-400'}','text-white'); App.registerIndividualEvent('${student.id}','temperatura',{temp:${t}});"
                class="py-2.5 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs ${fiebre ? 'text-rose-600' : 'text-slate-600'} hover:bg-slate-100 transition-all active:scale-90 relative">
                ${t}°${fiebre ? '<span class="absolute -top-1 -right-1 text-[8px]">🔥</span>' : ''}
              </button>`;
            }).join('')}
          </div>`, false)}

        ${_accSection('Medicamentos', '💊', `
          <div class="bg-purple-50 border border-purple-100 rounded-2xl p-3 space-y-2">
            <div class="grid grid-cols-2 gap-2">
              <input id="ind-med-nombre-${student.id}" type="text" placeholder="Nombre" class="p-2.5 bg-white border-2 border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-purple-400 transition-all">
              <input id="ind-med-dosis-${student.id}" type="text" placeholder="Dosis" class="p-2.5 bg-white border-2 border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-purple-400 transition-all">
            </div>
            <input id="ind-med-auth-${student.id}" type="text" placeholder="Autorización (opcional)" class="w-full p-2.5 bg-white border-2 border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-purple-400 transition-all">
            <button onclick="App.registerIndividualEvent('${student.id}','medicamento',{nombre:document.getElementById('ind-med-nombre-${student.id}')?.value.trim(),dosis:document.getElementById('ind-med-dosis-${student.id}')?.value.trim(),autorizacion:document.getElementById('ind-med-auth-${student.id}')?.value.trim()}); ['ind-med-nombre-${student.id}','ind-med-dosis-${student.id}','ind-med-auth-${student.id}'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});"
              class="w-full py-2 bg-purple-50 border-2 border-purple-200 rounded-xl text-[10px] font-black text-purple-700 hover:bg-purple-100 transition-all active:scale-95 uppercase tracking-widest">
              💊 Registrar medicamento
            </button>
          </div>`, false)}

        ${isRetirado ? '' : _accSection('Rutina de hoy', '📅', `
          <div class="grid grid-cols-4 gap-2">
            ${routineQuickHTML}
          </div>`, false)}

        ${_accSection('Pañales', '🧷', `
          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-2">
              <button onclick="App.registerIndividualEvent('${student.id}','panal_humedo',{crema:document.getElementById('diaper-cream-${student.id}')?.checked,consistencia:null,ropa_cambio:document.getElementById('diaper-change-${student.id}')?.checked})"
                class="flex flex-col items-center gap-1.5 p-3 bg-sky-50 hover:bg-sky-100 border-2 border-sky-200 rounded-2xl transition-all active:scale-90">
                <span class="text-2xl">💧</span>
                <span class="text-[9px] font-black text-sky-700 uppercase">Mojado</span>
              </button>
              <button onclick="App.registerIndividualEvent('${student.id}','panal_sucio',{crema:document.getElementById('diaper-cream-${student.id}')?.checked,consistencia:document.getElementById('diaper-consist-${student.id}')?.value||null,ropa_cambio:document.getElementById('diaper-change-${student.id}')?.checked})"
                class="flex flex-col items-center gap-1.5 p-3 bg-amber-50 hover:bg-amber-100 border-2 border-amber-200 rounded-2xl transition-all active:scale-90">
                <span class="text-2xl">💩</span>
                <span class="text-[9px] font-black text-amber-700 uppercase">Sucio</span>
              </button>
            </div>
            <div class="flex items-center gap-3 px-1">
              <label class="flex items-center gap-1.5 text-[9px] font-bold text-slate-500 cursor-pointer">
                <input type="checkbox" id="diaper-cream-${student.id}" class="accent-orange-500 w-3.5 h-3.5"> 🧴 Crema
              </label>
              <label class="flex items-center gap-1.5 text-[9px] font-bold text-slate-500 cursor-pointer">
                <input type="checkbox" id="diaper-change-${student.id}" class="accent-blue-500 w-3.5 h-3.5"> 👕 Ropa
              </label>
              <select id="diaper-consist-${student.id}" class="text-[9px] font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1 outline-none">
                <option value="">Consistencia</option>
                <option value="blanda">Blanda</option>
                <option value="semisolida">Semisólida</option>
                <option value="solida">Sólida</option>
                <option value="liquida">Líquida</option>
              </select>
            </div>
          </div>`, false)}

        ${_accSection('Eventos del día', '⚡', `
          <div class="grid grid-cols-4 gap-2">
            ${[
              {type:'desayuno', icon:'🥐', label:'Desayuno'},
              {type:'almuerzo', icon:'🍽️', label:'Almuerzo'},
              {type:'merienda', icon:'🍎', label:'Merienda'},
              {type:'panal_humedo', icon:'💧', label:'Pañal'},
              {type:'panal_sucio',  icon:'💩', label:'Sucio'},
              {type:'bano',        icon:'🚽', label:'Baño'},
              {type:'lavado_manos', icon:'🧼', label:'Lavado'},
              {type:'cepillado',   icon:'🪥', label:'Cepillado'},
              {type:'cambio_ropa', icon:'👕', label:'Ropa'},
            ].map(ev => `
              <button onclick="App.registerIndividualEvent('${student.id}','${ev.type}',{})"
                class="flex flex-col items-center gap-1 p-2.5 bg-slate-50 hover:bg-slate-100 border-2 border-transparent hover:border-slate-200 rounded-xl transition-all active:scale-90">
                <span class="text-xl">${ev.icon}</span>
                <span class="text-[8px] font-black text-slate-400 uppercase leading-tight text-center">${ev.label}</span>
              </button>`).join('')}
          </div>`, false)}

        ${_accSection('Agregar evento', '➕', `
          <div class="grid grid-cols-3 gap-2">
            ${EXTRA_EVENT_TYPES.map(ev => `
              <button onclick="App.openExtraEventModal('${student.id}','${ev.type}','${ev.icon}','${ev.label}')"
                class="flex flex-col items-center gap-1 p-2.5 bg-slate-50 hover:bg-rose-50 border-2 border-transparent hover:border-rose-200 rounded-xl transition-all active:scale-90">
                <span class="text-lg">${ev.icon}</span>
                <span class="text-[8px] font-black text-slate-400 uppercase leading-tight text-center">${ev.label}</span>
              </button>`).join('')}
          </div>`, false)}

        ${_accSection('Observaciones', '📝', `
          <div class="space-y-2">
            <div class="flex flex-wrap gap-1.5 mb-2">
              ${COMMENT_TEMPLATES.map(t => `
                <button onclick="const ta=document.getElementById('modal-note-${student.id}');if(ta){ta.value=ta.value?(ta.value+' '+t.text):t.text;ta.focus();}"
                  class="flex items-center gap-1 px-2 py-1 bg-slate-50 hover:bg-orange-50 border border-slate-100 hover:border-orange-200 rounded-lg transition-all active:scale-95 text-[8px] font-bold text-slate-500 hover:text-orange-600">
                  <span>${t.icon}</span><span class="truncate max-w-[80px]">${t.text.substring(0,20)}...</span>
                </button>`).join('')}
            </div>
            <textarea id="modal-note-${student.id}" rows="3"
              oninput="if(window.App._autoSaveNote) App._autoSaveNote('${student.id}', this.value)"
              class="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium outline-none focus:border-[#FF8A00] transition-all resize-none"
              placeholder="Escribe aquí...">${safeEscapeHTML(currentNotes || (_getDraft(student.id)?.notes || ''))}</textarea>
          </div>`, true)}

        ${_accSection('Registro del día', '🕐', `
          <div class="space-y-3 max-h-64 overflow-y-auto pr-1" id="ind-timeline-${student.id}">${timelineHTML}</div>`, false)}
      </div>

      <div class="p-3 sm:p-4 shrink-0" style="background:#f8fafc;border-top:1px solid #e2e8f0;">
        <button onclick="App.saveRoutineInModal('${student.id}')" id="btnSaveModalRoutine"
          class="w-full py-3.5 sm:py-4 text-white rounded-2xl font-black text-sm uppercase tracking-widest active:scale-[0.98] transition-colors flex items-center justify-center gap-2" style="background:#198754 !important;border:2px solid #146C43 !important;box-shadow:0 6px 20px rgba(25,135,84,0.45);opacity:1 !important;">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Guardar y Cerrar
        </button>
      </div>
    </div>`;
}

// ── MODAL EVENTO EXTRA ────────────────────────────────────────────────────────
export function openExtraEventModal(studentId, eventType, icon, label) {
  const modalId = 'extraEventModal';
  let extraFields = '';

  if (eventType === 'fiebre') {
    extraFields = `<div class="space-y-2">
      <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Temperatura</p>
      <input id="extraTemp" type="number" step="0.1" min="35" max="42" placeholder="37.5"
        class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-rose-400 transition-all">
    </div>`;
  } else if (eventType === 'medicamento_extra') {
    extraFields = `<div class="grid grid-cols-2 gap-2">
      <div class="space-y-1">
        <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Nombre</p>
        <input id="extraMedName" type="text" placeholder="Ej: Paracetamol" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-purple-400 transition-all">
      </div>
      <div class="space-y-1">
        <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Dosis</p>
        <input id="extraMedDosis" type="text" placeholder="Ej: 5ml" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-purple-400 transition-all">
      </div>
    </div>`;
  } else if (eventType === 'llamada_padres') {
    extraFields = `<div class="space-y-2">
      <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Motivo</p>
      <input id="extraMotivo" type="text" placeholder="Ej: Fiebre, golpe..." class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-blue-400 transition-all">
    </div>`;
  }

  const content = `
    <div class="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col" style="max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);">
      <div class="p-4 sm:p-5 text-white relative overflow-hidden" style="background:linear-gradient(135deg, #e11d48 0%, #db2777 100%);">
        <div class="absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl" style="background:rgba(255,255,255,0.1);"></div>
        <div class="relative flex items-center gap-3 sm:gap-4">
          <div class="w-10 h-10 sm:w-12 sm:h-12 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center text-xl sm:text-2xl border border-white/20 shadow-lg shrink-0">${icon}</div>
          <div class="min-w-0">
            <h3 class="text-base sm:text-lg font-black truncate">${label}</h3>
            <p class="text-[10px] sm:text-xs font-bold text-pink-100 uppercase tracking-widest">Evento especial</p>
          </div>
          <button onclick="Modal.close('${modalId}')" class="ml-auto p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors border border-white/20 shrink-0">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar" style="-webkit-overflow-scrolling:touch;">
        <p class="text-xs text-slate-500 text-center">Hora: <span class="font-black text-slate-800">${new Date().toLocaleTimeString('es-ES', {hour:'2-digit',minute:'2-digit'})}</span></p>
        ${extraFields}
        <div class="space-y-2">
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Observaciones</p>
          <textarea id="extraObs" rows="2" placeholder="Detalles..." class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium outline-none focus:border-rose-400 transition-all resize-none"></textarea>
        </div>
        <button onclick="App.confirmExtraEvent('${studentId}','${eventType}')"
          class="w-full py-3.5 text-white rounded-2xl font-black text-sm uppercase tracking-widest active:scale-[0.98] transition-colors shadow-lg flex items-center justify-center gap-2" style="background:#E11D48 !important;border:2px solid #BE123C !important;box-shadow:0 6px 20px rgba(225,29,72,0.4);opacity:1 !important;">
          Registrar Evento
        </button>
      </div>
    </div>`;
  Modal.open(modalId, content);
  if (window.lucide) window.lucide.createIcons();
}

export async function confirmExtraEvent(studentId, eventType) {
  const extra = { obs: document.getElementById('extraObs')?.value.trim() || '' };
  if (eventType === 'fiebre') extra.temp = parseFloat(document.getElementById('extraTemp')?.value) || null;
  else if (eventType === 'medicamento_extra') { extra.nombre = document.getElementById('extraMedName')?.value.trim() || ''; extra.dosis = document.getElementById('extraMedDosis')?.value.trim() || ''; }
  else if (eventType === 'llamada_padres') extra.motivo = document.getElementById('extraMotivo')?.value.trim() || '';

  await registerIndividualEvent(studentId, eventType, extra);
  Modal.close('extraEventModal');
}

// ── MODAL INDIVIDUAL: BEBÉ ────────────────────────────────────────────────────
function _renderInfantRoutineUI(student, log, modalId) {
  const infantData = log?.events || log?.infant_data || [];
  const lastEntry  = infantData.length ? infantData[infantData.length - 1] : null;
  const now        = new Date();
  const currentHourStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  const timeOptions = [];
  for (let h = 7; h <= 18; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = h > 12 ? h - 12 : h;
      const ampm = h >= 12 ? 'PM' : 'AM';
      timeOptions.push(`${hh}:${String(m).padStart(2,'0')} ${ampm}`);
    }
  }
  const activities = ['Sensorial','Motricidad','Música','Lectura','Juego libre','Estimulación temprana','Arte'];

  return `
    <div class="bg-white w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col" style="max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);">
      <div class="p-3.5 sm:p-5 text-white relative overflow-hidden" style="background:linear-gradient(135deg, #3b82f6 0%, #6366f1 50%, #8b5cf6 100%);">
        <div class="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl" style="background:rgba(255,255,255,0.1);"></div>
        <button onclick="Modal.close('${modalId}')" class="absolute top-2.5 right-2.5 p-2 rounded-full hover:bg-white/30 border border-white/20 z-10" style="background:rgba(255,255,255,0.2);backdrop-filter:blur(4px);">
          <i data-lucide="x" class="w-4 h-4" style="color:white;"></i>
        </button>
        <div class="relative flex items-center gap-3 sm:gap-4">
          <div class="w-10 h-10 sm:w-14 sm:h-14 rounded-2xl overflow-hidden flex items-center justify-center font-black text-lg sm:text-2xl shrink-0 shadow-lg" style="background:rgba(255,255,255,0.2);backdrop-filter:blur(4px);border:2px solid rgba(255,255,255,0.3);color:white;">
            ${student.avatar_url ? `<img src="${student.avatar_url}" class="w-full h-full object-cover" style="color:transparent;">` : `<span style="color:white;">${student.name.charAt(0)}</span>`}
          </div>
          <div class="min-w-0">
            <h3 class="text-base sm:text-lg font-black truncate" style="color:white !important;text-shadow:0 1px 3px rgba(0,0,0,0.15);">${safeEscapeHTML(student.name)}</h3>
            <p class="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest" style="color:rgba(255,255,255,0.85);">Registro del Bebé 🍼</p>
          </div>
        </div>
      </div>
      <div class="p-3 sm:p-4 space-y-2.5 overflow-y-auto flex-1 custom-scrollbar" style="background:rgba(248,250,252,0.5);-webkit-overflow-scrolling:touch;">

        ${_accSection('Hora', '🕐', `
          <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            <select id="infantTime" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:border-blue-400">
              ${timeOptions.map(t => `<option ${t === currentHourStr ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>`, true)}

        ${_accSection('Leche (Onzas)', '🍼', `
          <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            <div class="flex items-center gap-3">
              <input type="number" id="infantMilk" min="0" max="12" step="0.5" placeholder="0" class="flex-1 p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-lg outline-none focus:border-blue-400">
              <span class="font-black text-slate-400 text-[11px] uppercase">oz</span>
            </div>
            <div class="grid grid-cols-4 gap-2 mt-2">
              ${['Fría','Natural','Tibia','Caliente'].map(t => `
                <button type="button" onclick="this.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('bg-sky-500','text-white','border-sky-500')); this.classList.add('bg-sky-500','text-white','border-sky-500');"
                  class="py-1.5 bg-sky-50 border-2 border-sky-200 rounded-xl font-black text-[9px] text-sky-700 hover:bg-sky-100 transition-all active:scale-90 uppercase">
                  ${t}
                </button>`).join('')}
            </div>
          </div>`, true)}

        ${_accSection('Alimentación', '🍽️', `
          <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            <div class="grid grid-cols-2 gap-2">
              ${[{id:'none',label:'No comió',e:'🙅'},{id:'little',label:'Poco',e:'🍲'},{id:'half',label:'La mitad',e:'🥣'},{id:'all',label:'Todo',e:'🍽️'}].map(f => `
                <label class="flex items-center gap-2 p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl cursor-pointer hover:bg-blue-50 transition-all">
                  <input type="radio" name="infantFood" value="${f.id}" class="accent-blue-500">
                  <span class="text-lg">${f.e}</span>
                  <span class="text-xs font-bold text-slate-600">${f.label}</span>
                </label>`).join('')}
            </div>
          </div>`, true)}

        ${_accSection('Actividades', '🎨', `
          <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            <div class="flex flex-wrap gap-2">
              ${activities.map(a => `
                <label class="cursor-pointer">
                  <input type="checkbox" name="infantActivity" value="${a}" class="hidden peer">
                  <span class="block px-3 py-1.5 bg-slate-50 border-2 border-slate-100 rounded-xl text-[11px] font-bold text-slate-500 peer-checked:bg-indigo-50 peer-checked:border-indigo-400 peer-checked:text-indigo-700 transition-all">
                    ${a}
                  </span>
                </label>`).join('')}
            </div>
          </div>`, false)}

        ${_accSection('Observación', '📝', `
          <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            <textarea id="infantNotes" rows="2" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium outline-none focus:border-blue-400 resize-none" placeholder="Anota algo importante..."></textarea>
          </div>`, true)}

        ${lastEntry ? _accSection('Último registro', '📋', `
          <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center text-lg">🍼</div>
              <div>
                <p class="text-[10px] font-black text-slate-400 uppercase">${_formatTime(lastEntry.created_at)}</p>
                <p class="text-xs font-bold text-slate-700">${lastEntry.comment || 'Registro de rutina'}</p>
              </div>
            </div>
          </div>`, false) : ''}
      </div>
      <div class="p-3 sm:p-4 shrink-0" style="background:#f8fafc;border-top:1px solid #e2e8f0;">
        <button onclick="App.saveInfantEntry('${student.id}')" id="btnSaveInfant"
          class="w-full py-3.5 sm:py-4 text-white rounded-2xl font-black text-sm uppercase tracking-widest active:scale-[0.98] transition-colors flex items-center justify-center gap-2" style="background:#2563EB !important;border:2px solid #1D4ED8 !important;box-shadow:0 6px 20px rgba(37,99,235,0.45);opacity:1 !important;">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Guardar Registro
        </button>
      </div>
    </div>`;
}

// ── GUARDAR BEBÉ ──────────────────────────────────────────────────────────────
export async function saveInfantEntry(sid) {
  if (_isStudentRetirado(sid)) { safeToast('Este estudiante se retiró del centro: no se registran más eventos', 'warning'); return; }
  if (!_isStudentPresent(sid)) { safeToast('Este estudiante no está presente: no se pueden registrar eventos', 'warning'); return; }
  const btn = document.getElementById('btnSaveInfant');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i> Guardando...'; if (window.lucide) lucide.createIcons(); }
  try {
    const time = document.getElementById('infantTime').value;
    const milk = parseFloat(document.getElementById('infantMilk').value) || 0;
    const food = document.querySelector('input[name="infantFood"]:checked')?.value;
    const acts = [...document.querySelectorAll('input[name="infantActivity"]:checked')].map(c => c.value);
    const notes = document.getElementById('infantNotes').value.trim();
    const parts = [];
    if (milk > 0) parts.push(`Tomó ${milk} oz de leche.`);
    if (food) { const fm = {none:'No quiso comer.',little:'Comió poco.',half:'Comió la mitad.',all:'Comió todo.'}; parts.push(fm[food]); }
    if (acts.length) parts.push(`Actividades: ${acts.join(', ')}.`);
    if (notes) parts.push(notes);

    const classroom = AppState.get('classroom');
    const today     = new Date().toISOString().split('T')[0];
    const logsMap   = AppState.get('logsMap') || {};
    const currentLog = logsMap[sid] || {};
    const newEvent  = _makeEvent('biberon', { time, milk, food, activities: acts, notes, comment: parts.join(' ') });
    const newEvents = _addEventToLog(currentLog, newEvent);
    await MaestraApi.upsertDailyLog({ student_id: sid, classroom_id: classroom.id, date: today, events: newEvents });
    await _logTimelineEvent(classroom, 'biberon', [sid], { metadata: { milk, food } });
    safeToast('Registro guardado');
    Modal.close('routineStudentModal');
    await _refreshLogsMap(classroom.id, today);
    _reRenderTimeline();
  } catch (e) {
    safeToast('Error al guardar', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = 'Guardar Registro'; }
  }
}

// ── UPDATE CAMPO EN MODAL ─────────────────────────────────────────────────────
export function updateRoutineFieldInModal(sid, field, val) {
  const fieldMap = { mood: 'orange-400 bg-orange-50', food: '[#28B54D] bg-green-50', sleep: 'indigo-400 bg-indigo-50' };
  const target = field === 'sleep' ? 'sleep' : field;
  document.querySelectorAll(`.routine-modal-${target}-${sid}`).forEach(b => {
    b.className = b.className.replace(/border-[\w\[\]#]+ bg-\w+-\d+ shadow-md/g, '');
    b.classList.add('border-slate-100', 'bg-slate-50');
    b.classList.remove('shadow-md');
    if (b.dataset.val === val) {
      b.classList.remove('border-slate-100', 'bg-slate-50');
      const cls = fieldMap[field]?.split(' ') || [];
      cls.forEach(c => {
        if (c.startsWith('bg-')) b.classList.add(c);
        else b.classList.add(`border-${c}`);
      });
      b.classList.add('shadow-md');
    }
  });
  updateRoutineField(sid, field, val);
}

export async function saveRoutineInModal(sid) {
  const note  = document.getElementById(`modal-note-${sid}`)?.value.trim();
  const mood  = document.querySelector(`.routine-modal-mood-${sid}.border-\\[\\#FF8A00\\]`)?.dataset.val
             || document.querySelector(`.routine-modal-mood-${sid}.border-orange-400`)?.dataset.val;
  const food  = document.querySelector(`.routine-modal-food-${sid}.border-\\[\\#28B54D\\]`)?.dataset.val
             || document.querySelector(`.routine-modal-food-${sid}.border-emerald-400`)?.dataset.val;
  const sleep = document.querySelector(`.routine-modal-sleep-${sid}.border-indigo-400`)?.dataset.val;
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  try {
    await MaestraApi.upsertDailyLog({ student_id: sid, classroom_id: classroom.id, date: today, mood, food, nap: sleep, notes: note });
    _clearDraft(sid);
    Modal.close('routineStudentModal');
    safeToast('Reporte guardado');
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
    _refreshReportCount();
  } catch (e) { safeToast('Error al guardar', 'error'); }
}

export async function wakeStudentSiesta(studentId) {
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  const logsMap   = AppState.get('logsMap') || {};
  const log       = logsMap[studentId] || {};
  const events    = [...(log.events || [])];
  const now       = new Date().toISOString();
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'siesta' && events[i].open) {
      const mins = Math.round((new Date(now) - new Date(events[i].created_at)) / 60000);
      events[i] = { ...events[i], open: false, end_at: now, duration_min: mins };
      break;
    }
  }
  try {
    await MaestraApi.upsertDailyLog({ student_id: studentId, classroom_id: classroom.id, date: today, events, nap: 'si' });
    await _logTimelineEvent(classroom, 'siesta', [studentId], { metadata: { action: 'wake' } });
    safeToast('Siesta cerrada');
    Modal.close('routineStudentModal');
    await _refreshLogsMap(classroom.id, today);
    _reRenderTimeline();
  } catch (e) { safeToast('Error al cerrar siesta', 'error'); }
}

// ── PUBLICAR ──────────────────────────────────────────────────────────────────
export async function publishAll() {
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  const { data: drafts } = await supabase.from('daily_logs').select('id').eq('classroom_id', classroom.id).eq('date', today).eq('status', 'draft');
  if (!drafts?.length) { safeToast('No hay borradores para publicar'); return; }
  if (!confirm(`¿Publicar ${drafts.length} reporte${drafts.length > 1 ? 's' : ''}?`)) return;
  try {
    await MaestraApi.publishDailyLogs(drafts.map(d => d.id));
    safeToast('Reportes publicados', 'success');
    document.getElementById('btnPublishAll')?.classList.add('hidden');
    const students = AppState.get('students') || [];
    students.forEach(s => _clearDraft(s.id));
    await _refreshLogsMap(classroom.id, today);
    _reRenderTimeline();
  } catch (e) { safeToast('Error al publicar', 'error'); }
}

export async function updateRoutineField(studentId, field, value) {
  _autoSaveField(studentId, field, value);
  await saveRoutineLog(studentId, field, value);
}

export async function saveRoutineLog(studentId, field = 'notes', value = null) {
  const key = studentId + field;
  if (_saving[key]) return;
  _saving[key] = true;
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  const fieldMap  = { mood: 'mood', food: 'food', sleep: 'nap', notes: 'notes' };
  const dbField   = fieldMap[field] || field;
  try {
    await MaestraApi.upsertDailyLog({ student_id: studentId, classroom_id: classroom.id, date: today, [dbField]: value });
  } catch (_) { safeToast('Error al guardar', 'error'); }
  finally { _saving[key] = false; }
}

export async function registerIndividualEvent(sid, type, extra = {}) {
  if (_isStudentRetirado(sid)) { safeToast('Este estudiante se retiró del centro: no se registran más eventos', 'warning'); return; }
  if (!_isStudentPresent(sid)) { safeToast('Este estudiante no está presente: no se pueden registrar eventos', 'warning'); return; }
  if (type === 'temperatura' && extra.temp != null) {
    const t = parseFloat(extra.temp);
    if (isNaN(t) || t < 30 || t > 45) { safeToast('Temperatura inválida (30-45°C)', 'error'); return; }
    extra.temp = t;
  }
  if (type === 'biberon' && extra.oz != null) {
    const o = parseFloat(extra.oz);
    if (isNaN(o) || o < 0 || o > 32) { safeToast('Onzas inválidas (0-32oz)', 'error'); return; }
    extra.oz = o;
  }
  ['nombre', 'dosis', 'autorizacion', 'texto', 'obs', 'motivo'].forEach(k => {
    if (extra[k] && typeof extra[k] === 'string') extra[k] = extra[k].replace(/<[^>]*>/g, '').trim().substring(0, 200);
  });
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  const logsMap   = AppState.get('logsMap') || {};
  const currentLog = logsMap[sid] || {};
  let newEvents = [...(currentLog.events || [])];
  if (type === 'siesta') {
    newEvents = _addEventToLog(currentLog, _makeEvent('siesta', { open: true }));
  } else {
    newEvents = _addEventToLog(currentLog, _makeEvent(type, extra));
  }
  const payload = { student_id: sid, classroom_id: classroom.id, date: today, events: newEvents };
  try {
    await MaestraApi.upsertDailyLog(payload);
    await _logTimelineEvent(classroom, type, [sid], { metadata: extra });
    const meta = _getEventMeta(type) || { icon: '📋', label: type };
    const icon = meta.icon;
    const label = meta.label;
    let detail = '';
    if (type === 'temperatura' && extra.temp) detail = ` · ${extra.temp}°C${parseFloat(extra.temp) >= 37.5 ? ' 🔥' : ''}`;
    if (type === 'biberon' && extra.oz) detail = ` · ${extra.oz}oz`;
    if (type === 'medicamento') detail = [extra.nombre, extra.dosis].filter(Boolean).join(' · ');
    if (type === 'fiebre' && extra.temp) detail = ` · ${extra.temp}°C`;
    if (type === 'medicamento_extra') detail = [extra.nombre, extra.dosis].filter(Boolean).join(' · ');
    safeToast(`${icon} ${label}${detail} registrado`);
    await _refreshLogsMap(classroom.id, today);
    _reRenderTimeline();
    const tlContainer = document.getElementById(`ind-timeline-${sid}`);
    if (tlContainer) {
      const updatedLog = (AppState.get('logsMap') || {})[sid] || {};
      const updatedEvents = (updatedLog.events || []);
      tlContainer.innerHTML = updatedEvents.length ? updatedEvents.map(ev => {
        const m = _getEventMeta(ev.type) || { icon: '📋', label: ev.type };
        const ico = m.icon;
        const lbl = m.label;
        let d = '';
        if (ev.type === 'biberon') { const p = []; if (ev.oz) p.push(`${ev.oz} oz`); if (ev.milk_temp) p.push(ev.milk_temp); d = p.join(' · '); }
        if (ev.type === 'temperatura') d = ev.temp ? `${ev.temp}°C ${parseFloat(ev.temp) >= 37.5 ? '🔥' : ''}` : '';
        if (ev.type === 'medicamento') d = [ev.nombre, ev.dosis, ev.autorizacion].filter(Boolean).join(' · ');
        if (ev.type === 'siesta') d = ev.duration_min ? `${ev.duration_min} min` : (ev.open ? 'En curso...' : '');
        if (ev.type === 'fiebre') d = ev.temp ? `${ev.temp}°C` : '';
        if (ev.type === 'medicamento_extra') d = [ev.nombre, ev.dosis].filter(Boolean).join(' · ');
        if (ev.type === 'llamada_padres') d = ev.motivo || '';
        return `<div class="flex items-start gap-3"><div class="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-sm shrink-0">${ico}</div><div class="flex-1 min-w-0"><p class="text-[10px] font-black text-slate-400">${_formatTime(ev.created_at)}</p><p class="text-xs font-bold text-slate-700">${lbl}${d ? ` · ${d}` : ''}</p></div></div>`;
      }).join('') : '<p class="text-xs text-slate-400 italic">Sin eventos registrados hoy.</p>';
    }
  } catch (e) { safeToast('Error al registrar evento', 'error'); }
}

// ════════════════════════════════════════════════════════════════
// 🎯 GESTIÓN DE RUTINA — Schedule Builder
// ════════════════════════════════════════════════════════════════

async function _reRenderTimeline() {
  const wrapper = document.getElementById('routineWrapper');
  if (!wrapper) return;
  const students = AppState.get('students') || [];
  const logsMap  = AppState.get('logsMap') || {};
  const today = new Date().toISOString().split('T')[0];
  const todayLabel = _formatDate(today);
  const withReport = _countReportedStudents(logsMap, students);
  const scheduleNow = _getCurrentScheduleEvent();
  const activeSiestas = _getActiveSiestas(students, logsMap);
  const classroom = AppState.get('classroom');
  wrapper.outerHTML = _renderRoutineLayout({
    todayLabel, students, logsMap, withReport,
    scheduleNow, activeSiestas, today, classroom
  });
  _refreshStudentCards();
  if (window.lucide) window.lucide.createIcons();
}

// ════════════════════════════════════════════════════════════════
// ⚡ AUTO-REGISTRO: marca la cronología automáticamente en su hora
// de activación y la sincroniza con el panel padre (rutina / cronología).
// ════════════════════════════════════════════════════════════════
const _AUTO_SKIP_TYPES = new Set([
  'temperatura','biberon','medicamento','medicamento_extra','fiebre','malestar',
  'animo','nota','llamada_padres','otro','otro_incidente','accidente','golpe','pelea'
]);

let _autoRegisterTimer = null;
let _autoRunning = false;
let _autoLastDay = '';

function _hasEventType(log, type) {
  return Array.isArray(log?.events) && log.events.some(e => e.type === type);
}

function _startAutoRegisterClock() {
  if (_autoRegisterTimer) return;
  _checkAutoRegister();
  _autoRegisterTimer = setInterval(_checkAutoRegister, 30000);
}

export function stopAutoRegisterClock() {
  if (_autoRegisterTimer) { clearInterval(_autoRegisterTimer); _autoRegisterTimer = null; }
}

async function _checkAutoRegister() {
  if (_autoRunning) return;
  _autoRunning = true;
  try {
    const classroom = AppState.get('classroom');
    if (!classroom) return;
    const today = new Date().toISOString().split('T')[0];
    _autoLastDay = today;

    const schedule  = _classroomSchedule.length ? _classroomSchedule : DEFAULT_SCHEDULE;
    const students  = AppState.get('students') || [];
    const logsMap   = AppState.get('logsMap') || {};
    const presentIds = _getPresentStudentIds();
    if (!presentIds.length || !schedule.length) return;

    const now     = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    const toOpenSiestas = [];   // { ev, timeStr, students }
    const toCloseSiestas = [];  // { student, log, event }
    const toRegister = [];      // { ev, timeStr, students }
    let anyQueued = false;

    for (const ev of schedule) {
      if (_AUTO_SKIP_TYPES.has(ev.type)) continue;
      const start = (ev.hour ?? 0) * 60 + (ev.minute ?? 0);
      if (nowMins < start) continue;
      const duration = ev.duration || 30;
      const end = start + duration;
      const timeStr = _formatTime12(ev.hour, ev.minute);

      if (ev.type === 'siesta') {
        // Cierre automático de siestas abiertas por auto-registro cuyo horario ya terminó
        if (nowMins >= end) {
          const closing = [];
          for (const s of students) {
            if (!presentIds.includes(s.id)) continue;
            const log = logsMap[s.id];
            const openEvs = (log?.events || []).filter(e => e.type === 'siesta' && e.open && e.auto === true);
            openEvs.forEach(evt => closing.push({ student: s, log, event: evt }));
          }
          if (closing.length) toCloseSiestas.push(...closing);
        }
        // Apertura automática dentro de la ventana de inicio (primeros minutos)
        if (nowMins >= start && nowMins < start + 10) {
          const opening = students.filter(s => presentIds.includes(s.id) && !_hasEventType(logsMap[s.id], 'siesta'));
          if (opening.length) toOpenSiestas.push({ ev, timeStr, students: opening });
        }
        anyQueued = anyQueued || toCloseSiestas.length > 0 || toOpenSiestas.length > 0;
        continue;
      }

      // Ventana de activación: desde su hora hasta unos minutos después de terminar
      if (nowMins > end + 10) continue;

      const target = students.filter(s =>
        presentIds.includes(s.id) && !_hasEventType(logsMap[s.id], ev.type) && !_isStudentExitTimePassed(s)
      );
      if (!target.length) continue;
      toRegister.push({ ev, timeStr, students: target });
      anyQueued = true;
    }

    if (!anyQueued) return;
    await _applyAutoRegistration(classroom, today, toRegister, toOpenSiestas, toCloseSiestas);
  } catch (e) { /* silencioso */ }
  finally { _autoRunning = false; }
}

async function _applyAutoRegistration(classroom, today, toRegister, toOpenSiestas, toCloseSiestas) {
  const logsMap = AppState.get('logsMap') || {};
  const upserts = [];
  const summarized = [];

  // Cerrar siestas auto-abiertas que ya terminaron
  toCloseSiestas.forEach(({ log, event }) => {
    const events = [...(log.events || [])];
    const idx = events.findIndex(e => e.id === event.id);
    if (idx < 0) return;
    const dur = Math.max(0, Math.round((Date.now() - new Date(event.created_at)) / 60000));
    events[idx] = { ...event, open: false, end_at: new Date().toISOString(), duration_min: dur };
    upserts.push(MaestraApi.upsertDailyLog({ student_id: log.student_id, classroom_id: classroom.id, date: today, events }));
  });

  // Abrir siestas automáticamente en su hora
  toOpenSiestas.forEach(({ timeStr, students }) => {
    students.forEach(s => {
      const log = logsMap[s.id] || {};
      const newEvent = _makeEvent('siesta', { open: true, scheduled_time: timeStr, auto: true });
      upserts.push(MaestraApi.upsertDailyLog({ student_id: s.id, classroom_id: classroom.id, date: today, events: _addEventToLog(log, newEvent) }));
    });
  });

  // Registrar eventos normales
  toRegister.forEach(({ ev, timeStr, students }) => {
    students.forEach(s => {
      const log = logsMap[s.id] || {};
      const newEvent = _makeEvent(ev.type, { scheduled_time: timeStr, auto: true });
      upserts.push(MaestraApi.upsertDailyLog({ student_id: s.id, classroom_id: classroom.id, date: today, events: _addEventToLog(log, newEvent) }));
    });
    summarized.push({ type: ev.type, count: students.length, icon: ev.icon || _getScheduleEventIcon(ev.type), label: ev.label });
  });

  if (!upserts.length) return;
  try {
    await Promise.all(upserts);

    // Registro en el timeline del aula
    toRegister.forEach(({ ev, timeStr, students }) => {
      _logTimelineEvent(classroom, ev.type, students.map(s => s.id), {
        scheduledTime: null,
        duration: ev.duration || null,
        metadata: { auto: true, scheduled_time: timeStr }
      });
    });
    toOpenSiestas.forEach(({ timeStr, students }) => {
      _logTimelineEvent(classroom, 'siesta', students.map(s => s.id), {
        metadata: { auto: true, action: 'auto_open', scheduled_time: timeStr }
      });
    });
    if (toCloseSiestas.length) {
      const ids = [...new Set(toCloseSiestas.map(c => c.student.id))];
      _logTimelineEvent(classroom, 'siesta', ids, { metadata: { auto: true, action: 'auto_close' } });
    }

    await _refreshLogsMap(classroom.id, today);
    _reRenderTimeline();
    if (summarized.length) {
      const first = summarized[0];
      safeToast(`${first.icon} ${first.label} marcado automáticamente (${first.count} alumno${first.count > 1 ? 's' : ''})`, 'success');
    }
  } catch (e) { /* silencioso */ }
}

// ── SCHEDULE MANAGER MODAL (V8: catálogo por categorías) ───────
let _scheduleSearch = '';
let _scheduleAgeFilter = '';
let _schedulePage = 1;
let _scheduleTotal = 0;
const _schedulePageSize = 8;

const _CATEGORY_ACCENTS = {
  amber:'#f59e0b', orange:'#f97316', rose:'#f43f5e', indigo:'#6366f1', cyan:'#06b6d4',
  blue:'#3b82f6', green:'#22c55e', purple:'#a855f7', violet:'#8b5cf6', emerald:'#10b981',
  red:'#ef4444', slate:'#64748b'
};

function _renderConfigEventRow(ev, sched, accent) {
  const active = !!sched;
  const ageBadge = ev.ageGroup && AGE_GROUPS[ev.ageGroup]
    ? `<span class="text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0" style="color:${accent};background:${accent}18;" title="Edad: ${AGE_GROUPS[ev.ageGroup].label}">${AGE_GROUPS[ev.ageGroup].icon} ${AGE_GROUPS[ev.ageGroup].label}</span>`
    : '';
  if (active) {
    const time = _formatTime12(sched?.hour ?? 8, sched?.minute ?? 0);
    return `
      <div class="config-event-row flex items-center gap-2 p-2.5 rounded-2xl border-2 transition-all border-[#FF8A00]/40 bg-orange-50/50" data-type="${ev.type}" data-label="${ev.label}" data-age="${ev.ageGroup || ''}" data-active="true">
        <span class="text-lg shrink-0">${ev.icon}</span>
        <div class="flex-1 min-w-0">
          <p class="text-[10px] font-black text-slate-700 truncate">${ev.label} ${ageBadge}</p>
          <p class="text-[9px] font-bold text-[#FF8A00] uppercase mt-0.5">⏰ ${time} · ${sched?.duration ?? ev.defaultDuration ?? 30}min</p>
        </div>
        <span class="w-5 h-5 rounded-full bg-[#28B54D] text-white flex items-center justify-center text-[10px] shrink-0">✓</span>
        <button onclick="App.removeEventFromSchedule('${ev.type}')" class="p-1.5 hover:bg-red-50 rounded-lg text-slate-300 hover:text-red-500 transition-colors shrink-0" title="Quitar de la rutina">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>`;
  }
  return `
    <div class="config-event-row flex items-center gap-2 p-2.5 rounded-2xl border-2 transition-all border-slate-100 bg-white hover:border-slate-200" data-type="${ev.type}" data-label="${ev.label}" data-age="${ev.ageGroup || ''}" data-active="false">
      <span class="text-lg shrink-0">${ev.icon}</span>
      <div class="flex-1 min-w-0">
        <p class="text-[10px] font-black text-slate-700 truncate">${ev.label} ${ageBadge}</p>
      </div>
      <button onclick="App.addEventToSchedule('${ev.type}')" class="px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider border-2 transition-all active:scale-90" style="color:${accent};border-color:${accent}40;background:#f8fafc;">
        ＋ Agregar
      </button>
    </div>`;
}

// ── CRONOLOGÍA DEL DÍA (lista ordenada editable) ─────────────────────────────
function _renderScheduleOrderHTML() {
  const schedule = _classroomSchedule.length ? _classroomSchedule : [...DEFAULT_SCHEDULE];
  if (!schedule.length) return '<p class="text-center text-[10px] font-bold text-slate-300 py-4">Sin bloques. Agrega eventos desde el catálogo.</p>';
  return schedule.map((s, i) => {
    const meta = _getEventMeta(s.type) || { label: s.type, icon: '⏰', defaultDuration: 30 };
    const minutes = [0,5,10,15,20,25,30,35,40,45,50,55];
    const minuteOpts = [...new Set([...minutes, (s.minute ?? 0)])].sort((a,b) => a-b);
    const autoOn = true;
    return `
      <div class="schedule-order-row flex flex-wrap items-center gap-2 p-3 rounded-2xl border-2 bg-white transition-all" draggable="true"
        data-type="${s.type}" data-idx="${i}" data-hour="${s.hour ?? 8}" data-minute="${s.minute ?? 0}" data-auto="1"
        style="border-color:#e2e8f0;">
        <span class="drag-handle text-slate-300 text-sm shrink-0" title="Arrastrar para reordenar">⋮⋮</span>
        <span class="text-lg shrink-0">${meta.icon}</span>
        <div class="flex-1 min-w-0 basis-32 sm:basis-0">
          <p class="text-[10px] font-black text-slate-700 truncate">${meta.label}</p>
          <div class="flex flex-wrap items-center gap-2 mt-1.5">
            <select data-sched-hour="${s.type}" onchange="App.cascadeScheduleShift('${s.type}')">
              ${Array.from({length: 24}, (_, h) => `<option value="${h}" ${(s.hour ?? 8) === h ? 'selected' : ''}>${String(h).padStart(2,'0')}</option>`).join('')}
            </select>
            <span class="text-[10px] text-slate-300 font-bold">:</span>
            <select data-sched-minute="${s.type}" onchange="App.cascadeScheduleShift('${s.type}')">
              ${minuteOpts.map(m => `<option value="${m}" ${(s.minute ?? 0) === m ? 'selected' : ''}>${String(m).padStart(2,'0')}</option>`).join('')}
            </select>
            <select data-sched-duration="${s.type}" onchange="App.cascadeScheduleShift('${s.type}')" class="min-w-[64px]">
              ${[5,10,15,20,30,45,60,90,120].map(d => `<option value="${d}" ${(s.duration ?? meta.defaultDuration ?? 30) === d ? 'selected' : ''}>${d}min</option>`).join('')}
            </select>
          </div>
        </div>
        <button onclick="App.removeEventFromSchedule('${s.type}')" class="p-1.5 hover:bg-red-50 rounded-lg text-slate-300 hover:text-red-500 transition-colors shrink-0" title="Quitar">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>`;
  }).join('');
}

let _dragFromIdx = null;

function _bindScheduleDrag() {
  const list = document.getElementById('scheduleOrderList');
  if (!list || list.dataset.bound) return;
  list.dataset.bound = '1';

  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.schedule-order-row');
    if (!row) return;
    _dragFromIdx = parseInt(row.dataset.idx, 10);
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(_dragFromIdx)); } catch (_) {}
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = e.target.closest('.schedule-order-row');
    list.querySelectorAll('.schedule-order-row').forEach(r => r.classList.remove('drop-target'));
    if (row) row.classList.add('drop-target');
  });

  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const row = e.target.closest('.schedule-order-row');
    list.querySelectorAll('.schedule-order-row').forEach(r => r.classList.remove('drop-target'));
    if (row && _dragFromIdx != null) moveScheduleEvent(_dragFromIdx, parseInt(row.dataset.idx, 10));
    _dragFromIdx = null;
  });

  list.addEventListener('dragend', () => {
    list.querySelectorAll('.schedule-order-row').forEach(r => r.classList.remove('dragging','drop-target'));
    _dragFromIdx = null;
  });
}

// ── REORDENAR (drag & drop) ──────────────────────────────────────────────────
export function moveScheduleEvent(from, to) {
  const schedule = _classroomSchedule.length ? [..._classroomSchedule] : [...DEFAULT_SCHEDULE];
  if (!schedule.length) return;
  if (from < 0 || from >= schedule.length || to < 0 || to >= schedule.length) return;
  const [item] = schedule.splice(from, 1);
  schedule.splice(to, 0, item);
  _classroomSchedule = schedule;
  _refreshScheduleManagerUI();
}

// ── RECÁLCULO EN CASCADA ─────────────────────────────────────────────────────
export function cascadeScheduleShift(type) {
  const row = document.querySelector(`#scheduleOrderList .schedule-order-row[data-type="${type}"]`);
  if (!row) return;
  const idx = _classroomSchedule.findIndex(s => s.type === type);
  if (idx < 0) return;
  const block = _classroomSchedule[idx];
  const newHour = parseInt(row.querySelector('[data-sched-hour]')?.value, 10) || 0;
  const newMin  = parseInt(row.querySelector('[data-sched-minute]')?.value, 10) || 0;
  const newDuration = parseInt(row.querySelector('[data-sched-duration]')?.value, 10) || block.duration || 30;
  const oldStart = (parseInt(row.dataset.hour, 10) || 0) * 60 + (parseInt(row.dataset.minute, 10) || 0);
  const newStart = newHour * 60 + newMin;
  const delta = newStart - oldStart;

  block.hour = newHour;
  block.minute = newMin;
  block.duration = newDuration;

  if (delta && document.getElementById('cfgRecalc')?.checked) {
    for (let j = idx + 1; j < _classroomSchedule.length; j++) {
      const b = _classroomSchedule[j];
      const t = _minutesToTime((b.hour ?? 0) * 60 + (b.minute ?? 0) + delta);
      b.hour = t.hour;
      b.minute = t.minute;
    }
  }
  _refreshScheduleManagerUI();
}

function _renderScheduleConfigHTML() {
  const schedule = _classroomSchedule.length ? [..._classroomSchedule] : [...DEFAULT_SCHEDULE];
  const enabled = new Map(schedule.map(s => [s.type, s]));

  // Lista plana de eventos (orden por categoría) aplicando búsqueda y edad
  const flat = [];
  Object.entries(CATEGORIES).forEach(([catKey, cat]) => {
    const events = EVENT_CATALOG.filter(e => e.category === catKey);
    if (!events.length) return;
    const accent = _CATEGORY_ACCENTS[cat.color] || '#64748b';
    events.forEach(ev => {
      const hay = `${ev.label || ''} ${ev.type || ''}`.toLowerCase();
      const searchOk = !_scheduleSearch || hay.includes(_scheduleSearch);
      const ageOk = !_scheduleAgeFilter || !ev.ageGroup || ev.ageGroup === _scheduleAgeFilter;
      if (searchOk && ageOk) flat.push({ ev, sched: enabled.get(ev.type), cat, accent });
    });
  });

  _scheduleTotal = flat.length;
  const pageCount = Math.max(1, Math.ceil(_scheduleTotal / _schedulePageSize));
  if (_schedulePage > pageCount) _schedulePage = pageCount;
  if (_schedulePage < 1) _schedulePage = 1;
  const start = (_schedulePage - 1) * _schedulePageSize;
  const pageItems = flat.slice(start, start + _schedulePageSize);

  if (!pageItems.length) {
    return '<p class="text-center text-[10px] font-bold text-slate-300 py-4">Sin eventos que coincidan.</p>';
  }

  const rows = pageItems.map(({ ev, sched, cat, accent }) => `
    <div>
      <div class="flex items-center gap-1.5 mb-1">
        <span class="w-5 h-5 rounded-md flex items-center justify-center text-[10px] shrink-0" style="background:${accent}14;color:${accent};">${cat.icon}</span>
        <p class="text-[8px] font-black text-slate-400 uppercase tracking-widest">${cat.label}</p>
      </div>
      ${_renderConfigEventRow(ev, sched, accent)}
    </div>`).join('');

  return `
    <div class="flex items-center justify-between gap-2 mb-2.5">
      <button type="button" onclick="App.paginateScheduleCatalog(-1)" ${_schedulePage <= 1 ? 'disabled' : ''}
        class="px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider border-2 transition-all active:scale-95 disabled:opacity-30 disabled:pointer-events-none" style="color:#FF8A00;border-color:#FF8A00/40;">
        ‹ Anterior
      </button>
      <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest text-center px-1">Página ${_schedulePage} de ${pageCount} · ${_scheduleTotal} eventos</p>
      <button type="button" onclick="App.paginateScheduleCatalog(1)" ${_schedulePage >= pageCount ? 'disabled' : ''}
        class="px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider border-2 transition-all active:scale-95 disabled:opacity-30 disabled:pointer-events-none" style="color:#FF8A00;border-color:#FF8A00/40;">
        Siguiente ›
      </button>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      ${rows}
    </div>`;
}

export function filterEventCatalog(value) {
  _scheduleSearch = (value || '').trim().toLowerCase();
  _schedulePage = 1;
  _renderCatalogOnly();
}

export function filterEventsByAge(age) {
  _scheduleAgeFilter = _scheduleAgeFilter === age ? '' : (age || '');
  _schedulePage = 1;
  document.querySelectorAll('#ageFilterChips button').forEach(btn => {
    const on = btn.dataset.age === _scheduleAgeFilter;
    btn.classList.toggle('active-age', on);
  });
  _renderCatalogOnly();
}

export function paginateScheduleCatalog(dir) {
  const pageCount = Math.max(1, Math.ceil(_scheduleTotal / _schedulePageSize));
  _schedulePage = Math.min(pageCount, Math.max(1, _schedulePage + (dir > 0 ? 1 : -1)));
  _renderCatalogOnly();
}

function _renderCatalogOnly() {
  const container = document.getElementById('scheduleConfigSections');
  if (container) container.innerHTML = _renderScheduleConfigHTML();
}

export async function openScheduleManager() {
  const classroom = AppState.get('classroom');
  const modalId = 'scheduleManagerModal';
  if (!classroom) { safeToast('No hay aula seleccionada', 'error'); return; }
  _scheduleSearch = '';
  _scheduleAgeFilter = '';
  _schedulePage = 1;
  // Siempre recargar la cronología del aula activa (por si cambió de aula).
  await _loadSchedule(classroom.id);
  const schedule = _classroomSchedule.length ? _classroomSchedule : DEFAULT_SCHEDULE;

  const content = `
    <div class="bg-white w-full max-w-lg rounded-[2rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col" style="max-height:calc(100dvh - 5rem);">
      <!-- Header -->
      <div class="p-4 sm:p-5 text-white relative overflow-hidden shrink-0" style="background:linear-gradient(135deg, #FF8A00 0%, #f97316 50%, #ec4899 100%);">
        <div class="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl" style="background:rgba(255,255,255,0.1);"></div>
        <div class="relative flex items-center gap-3 sm:gap-4">
          <div class="w-10 h-10 sm:w-12 sm:h-12 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center text-xl sm:text-2xl border border-white/20 shadow-lg shrink-0">🧭</div>
          <div class="flex-1 min-w-0">
            <h3 class="text-base sm:text-lg font-black truncate">Configurar Rutina</h3>
            <p class="text-[9px] sm:text-[10px] font-bold text-orange-100 uppercase tracking-widest">Cronología personalizada por aula</p>
          </div>
          <span id="scheduleConfigCount" class="text-[9px] font-black bg-white/20 backdrop-blur-sm border border-white/20 rounded-full px-2.5 py-1.5 shrink-0">${schedule.length}/${EVENT_CATALOG.length}</span>
          <button onclick="Modal.close('${modalId}')" class="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors border border-white/20 shrink-0">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="relative mt-3">
          <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/60 pointer-events-none">🔍</span>
          <input oninput="App.filterEventCatalog(this.value)" value=""
            class="w-full py-2.5 pl-10 pr-4 bg-white/15 backdrop-blur-sm border border-white/20 rounded-2xl text-sm font-bold text-white placeholder-white/50 outline-none focus:bg-white/20 transition-all"
            placeholder="Buscar evento... (ej: siesta, agua, patio)" />
        </div>
        <div class="relative mt-2.5">
          <p class="text-[8px] sm:text-[9px] font-black text-white/60 uppercase tracking-widest mb-1.5">👶 Edad recomendada</p>
          <div id="ageFilterChips" class="flex flex-wrap gap-1.5">
            <button type="button" data-age="" onclick="App.filterEventsByAge('')"
              class="active-age text-[8px] sm:text-[9px] font-black uppercase tracking-wider px-2 py-1.5 rounded-xl border-2 border-white/20 bg-white/10 text-white/80 transition-all active:scale-95">Todas</button>
            ${Object.entries(AGE_GROUPS).map(([key, g]) => `
              <button type="button" data-age="${key}" onclick="App.filterEventsByAge('${key}')"
                title="${g.label} · ${g.hint}"
                class="text-[8px] sm:text-[9px] font-black uppercase tracking-wider px-2 py-1.5 rounded-xl border-2 border-white/20 bg-white/10 text-white/80 transition-all active:scale-95">${g.icon} ${g.label}</button>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="overflow-y-auto flex-1 p-4 sm:p-5 custom-scrollbar space-y-5">
        <div>
          <div class="flex items-center justify-between mb-2.5">
            <p class="text-[11px] font-black text-slate-500 uppercase tracking-widest">Cronología del día</p>
            <label class="flex items-center gap-1.5 cursor-pointer" title="Al cambiar la hora de un bloque, desplaza automáticamente los siguientes">
              <span class="text-[9px] font-black text-slate-400 uppercase">Recalcular en cascada</span>
              <input type="checkbox" id="cfgRecalc" checked class="w-3.5 h-3.5 accent-[#FF8A00]">
            </label>
          </div>
          <p class="text-[9px] font-bold text-slate-300 mb-2">Arrastra ⋮⋮ para reordenar · Edita hora y duración por bloque</p>
          <div id="scheduleOrderList" class="space-y-2">${_renderScheduleOrderHTML()}</div>
        </div>

        <div class="border-t border-slate-100 pt-4">
          <div class="flex items-center gap-2 mb-2.5">
            <span class="w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0" style="background:#fff7ed;color:#FF8A00;">📚</span>
            <p class="text-[11px] font-black text-slate-500 uppercase tracking-widest flex-1">Catálogo de eventos</p>
          </div>
          <div id="scheduleConfigSections" class="space-y-4">
            ${_renderScheduleConfigHTML()}
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="p-4 shrink-0 border-t border-slate-100">
        <div class="flex gap-2">
          <button onclick="App.resetScheduleToDefault()"
            class="px-4 py-3 bg-slate-100 hover:bg-slate-200 rounded-2xl text-[10px] font-black text-slate-500 uppercase tracking-widest transition-all active:scale-95">
            Restaurar
          </button>
          <button onclick="App.saveScheduleManager()" id="btnSaveSchedule"
            class="flex-1 py-3 text-white rounded-2xl font-black text-sm uppercase tracking-widest active:scale-[0.98] transition-colors flex items-center justify-center gap-2" style="background:#FF8A00 !important;border:2px solid #E67A00 !important;box-shadow:0 6px 20px rgba(255,138,0,0.4);">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Guardar Rutina
          </button>
        </div>
      </div>
    </div>`;

  Modal.open(modalId, content);
  _bindScheduleDrag();
  if (window.lucide) window.lucide.createIcons();
}

// ── ADD / REMOVE SCHEDULE EVENTS ────────────────────────────────
function _nextFreeSlot(schedule, startMin, duration) {
  let mins = startMin;
  let guard = 0;
  while (guard++ < 48) {
    const conflicts = schedule.some(s => {
      const sStart = (s.hour ?? 0) * 60 + (s.minute ?? 0);
      const sEnd   = sStart + (s.duration ?? 30);
      return mins < sEnd && sStart < mins + duration;
    });
    if (!conflicts) break;
    mins += 30;
  }
  return { hour: Math.min(Math.floor(mins / 60), 17), minute: mins % 60 };
}

export function addEventToSchedule(eventType) {
  const schedule = _classroomSchedule.length ? [..._classroomSchedule] : [...DEFAULT_SCHEDULE];
  if (schedule.some(s => s.type === eventType)) return;

  const meta = _getEventMeta(eventType) || { label: eventType, icon: '⏰', defaultDuration: 30 };

  let hour = 8, minute = 0;
  if (schedule.length) {
    const last = schedule[schedule.length - 1];
    const end = (last.hour ?? 8) * 60 + (last.minute ?? 0) + (last.duration ?? 30);
    const slot = _nextFreeSlot(schedule, Math.min(end, 17 * 60), meta.defaultDuration || 30);
    hour = slot.hour;
    minute = slot.minute;
  }

  schedule.push({
    type: eventType,
    label: meta.label || eventType,
    icon: meta.icon || '⏰',
    hour,
    minute,
    duration: meta.defaultDuration || 30,
    category: meta.category,
    autoRegister: true,
  });
  _classroomSchedule = schedule;
  _refreshScheduleManagerUI();
}

export function removeEventFromSchedule(eventType) {
  const schedule = _classroomSchedule.length ? [..._classroomSchedule] : [...DEFAULT_SCHEDULE];
  const idx = schedule.findIndex(s => s.type === eventType);
  if (idx === -1) return;
  schedule.splice(idx, 1);
  _classroomSchedule = schedule.length ? schedule : [...DEFAULT_SCHEDULE];
  _refreshScheduleManagerUI();
}

export function resetScheduleToDefault() {
  _classroomSchedule = DEFAULT_SCHEDULE.map(s => ({ ...s }));
  _refreshScheduleManagerUI();
}

export function toggleScheduleAuto(type) {
  const schedule = _classroomSchedule.length ? [..._classroomSchedule] : [...DEFAULT_SCHEDULE];
  const idx = schedule.findIndex(s => s.type === type);
  if (idx === -1) return;
  schedule[idx].autoRegister = true;
  _classroomSchedule = schedule;
  _refreshScheduleManagerUI();
  const meta = _getEventMeta(type);
  safeToast(`⚡ Auto: se marcará solo a su hora de activación — ${meta?.label || type}`);
}

function _refreshScheduleManagerUI() {
  const orderContainer = document.getElementById('scheduleOrderList');
  if (orderContainer) orderContainer.innerHTML = _renderScheduleOrderHTML();

  const container = document.getElementById('scheduleConfigSections');
  if (container) container.innerHTML = _renderScheduleConfigHTML();

  const countEl = document.getElementById('scheduleConfigCount');
  if (countEl) {
    const schedule = _classroomSchedule.length ? _classroomSchedule : DEFAULT_SCHEDULE;
    countEl.textContent = `${schedule.length}/${EVENT_CATALOG.length}`;
  }
  _bindScheduleDrag();
}

// ── PERSISTIR CRONOLOGÍA EN BD ───────────────────────────────────────────────
async function _persistSchedule(schedule) {
  const classroom = AppState.get('classroom');
  if (!classroom) return;

  await supabase
    .from('classroom_event_schedule')
    .delete()
    .eq('classroom_id', classroom.id);

  if (schedule.length) {
    const inserts = schedule.map((s, i) => ({
      classroom_id: classroom.id,
      event_type: s.type,
      event_label: s.label,
      event_icon: s.icon,
      category: s.category || 'personalizados',
      scheduled_hour: s.hour,
      scheduled_minute: s.minute,
      duration_minutes: s.duration,
      sort_order: i,
      is_active: true,
      auto_register: true,
      applies_to: 'all',
    }));
    const { error } = await supabase.from('classroom_event_schedule').insert(inserts);
    if (error) throw error;
  }
}

// ── SAVE SCHEDULE TO DB ─────────────────────────────────────────
export async function saveScheduleManager() {
  const btn = document.getElementById('btnSaveSchedule');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="animate-spin">⏳</span> Guardando...'; }

  try {
    const classroom = AppState.get('classroom');
    if (!classroom) { safeToast('No hay aula seleccionada', 'error'); return; }

    // La cronología se lee en el ORDEN de la lista (respetando drag & drop)
    const rows = [...document.querySelectorAll('#scheduleOrderList .schedule-order-row')];
    const schedule = rows.map(row => {
      const type = row.dataset.type;
      const meta = _getEventMeta(type) || { label: type, icon: '⏰', defaultDuration: 30, category: 'personalizados' };
      const hour = parseInt(row.querySelector('[data-sched-hour]')?.value, 10) || 8;
      const minute = parseInt(row.querySelector('[data-sched-minute]')?.value, 10) || 0;
      const duration = parseInt(row.querySelector('[data-sched-duration]')?.value, 10) || meta.defaultDuration || 30;
      return {
        type,
        label: meta.label || type,
        icon: meta.icon || '⏰',
        hour,
        minute,
        duration,
        category: meta.category || 'personalizados',
        autoRegister: true,
      };
    });

    await _persistSchedule(schedule);

    _classroomSchedule = schedule;
    Modal.close('scheduleManagerModal');
    safeToast('Rutina guardada exitosamente');
    await _reRenderTimeline();

  } catch (e) {
    safeToast('Error al guardar la rutina', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Guardar Rutina'; }
  }
}

// ── ALL EVENTS QUICK MENU ───────────────────────────────────────
let _allEventsFlat = [];
let _allEventsTotal = 0;
let _allEventsPage = 1;
const _allEventsPageSize = 12;

export function openAllEventsMenu() {
  const modalId = 'allEventsMenuModal';

  const flat = [];
  Object.entries(CATEGORIES).forEach(([catId, cat]) => {
    const items = EVENT_CATALOG.filter(e => e.category === catId);
    if (!items.length) return;
    const accent = _CATEGORY_ACCENTS[cat.color] || '#64748b';
    items.forEach(ev => flat.push({ ev, cat, accent }));
  });
  _allEventsFlat = flat;
  _allEventsTotal = flat.length;
  _allEventsPage = 1;

  const content = `
    <div class="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col" style="max-height:calc(100dvh - 5rem);">
      <div class="p-4 sm:p-5 text-white relative overflow-hidden shrink-0" style="background:linear-gradient(135deg, #8B5CF6 0%, #6366F1 50%, #3B82F6 100%);">
        <div class="absolute -top-8 -right-8 w-32 h-32 rounded-full blur-2xl" style="background:rgba(255,255,255,0.1);"></div>
        <div class="relative flex items-center gap-3 sm:gap-4">
          <div class="w-10 h-10 sm:w-12 sm:h-12 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center text-xl sm:text-2xl border border-white/20 shadow-lg shrink-0">📋</div>
          <div class="flex-1 min-w-0">
            <h3 class="text-base sm:text-lg font-black truncate">Todos los Eventos</h3>
            <p class="text-[9px] sm:text-[10px] font-bold text-indigo-100 uppercase tracking-widest">Catálogo completo por categoría</p>
          </div>
          <button onclick="Modal.close('${modalId}')" class="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 border border-white/20 shrink-0">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div id="allEventsList" class="p-4 flex-1 overflow-y-auto custom-scrollbar" style="-webkit-overflow-scrolling:touch;">
        ${_renderAllEventsPage()}
      </div>
    </div>`;

  Modal.open(modalId, content);
  if (window.lucide) window.lucide.createIcons();
}

export function paginateAllEvents(dir) {
  const pageCount = Math.max(1, Math.ceil(_allEventsTotal / _allEventsPageSize));
  _allEventsPage = Math.min(pageCount, Math.max(1, _allEventsPage + (dir > 0 ? 1 : -1)));
  const list = document.getElementById('allEventsList');
  if (list) list.innerHTML = _renderAllEventsPage();
}

function _renderAllEventsPage() {
  const pageCount = Math.max(1, Math.ceil(_allEventsTotal / _allEventsPageSize));
  if (_allEventsPage > pageCount) _allEventsPage = pageCount;
  if (_allEventsPage < 1) _allEventsPage = 1;
  const start = (_allEventsPage - 1) * _allEventsPageSize;
  const pageItems = _allEventsFlat.slice(start, start + _allEventsPageSize);

  if (!pageItems.length) {
    return '<p class="text-center text-[10px] font-bold text-slate-300 py-4">Sin eventos disponibles.</p>';
  }

  const grid = pageItems.map(({ ev, accent }) => `
    <button onclick="Modal.close('allEventsMenuModal'); App.openBulkEventModal('${ev.type}')"
      class="relative flex flex-col items-center gap-1 p-2 sm:p-3 bg-slate-50 hover:bg-[#FF8A00]/10 border-2 border-transparent hover:border-[#FF8A00]/30 rounded-2xl transition-all active:scale-90 group">
      <span class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style="background:${accent}80;"></span>
      <span class="text-xl group-hover:scale-110 transition-transform">${ev.icon}</span>
      <span class="text-[8px] font-black text-slate-400 uppercase text-center leading-tight truncate w-full">${ev.label}</span>
    </button>`).join('');

  return `
    <div class="flex items-center justify-between gap-2 mb-3">
      <button type="button" onclick="App.paginateAllEvents(-1)" ${_allEventsPage <= 1 ? 'disabled' : ''}
        class="px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider border-2 transition-all active:scale-95 disabled:opacity-30 disabled:pointer-events-none" style="color:#6366F1;border-color:#6366F1/40;">
        ‹ Anterior
      </button>
      <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest text-center px-1">Página ${_allEventsPage} de ${pageCount} · ${_allEventsTotal} eventos</p>
      <button type="button" onclick="App.paginateAllEvents(1)" ${_allEventsPage >= pageCount ? 'disabled' : ''}
        class="px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider border-2 transition-all active:scale-95 disabled:opacity-30 disabled:pointer-events-none" style="color:#6366F1;border-color:#6366F1/40;">
        Siguiente ›
      </button>
    </div>
    <div class="grid grid-cols-4 gap-2">
      ${grid}
    </div>`;
}
