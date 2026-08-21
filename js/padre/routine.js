/**
 * ============================================================
 * PANEL PADRE — ANÁLISIS DE RUTINA DIARIA V2
 * Transparencia analítica: date picker, timeline, resumen semanal/mensual
 * ============================================================
 */
import { supabase } from '../shared/supabase.js';
import { Api } from './api.js';
import { Helpers } from './helpers.js';
import { AppState } from './appState.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const EVENT_META = {
  biberon:           { icon: '🍼', label: 'Biberón'          },
  panal_humedo:      { icon: '💧', label: 'Pañal mojado'     },
  panal_sucio:       { icon: '💩', label: 'Pañal sucio'      },
  siesta:            { icon: '😴', label: 'Siesta'            },
  temperatura:       { icon: '🌡️', label: 'Temperatura'      },
  medicamento:       { icon: '💊', label: 'Medicamento'      },
  bano:              { icon: '🚽', label: 'Baño'              },
  animo:             { icon: '😊', label: 'Ánimo'             },
  desayuno:          { icon: '🥐', label: 'Desayuno'          },
  almuerzo:          { icon: '🍽️', label: 'Almuerzo'         },
  merienda:          { icon: '🍎', label: 'Merienda'          },
  nota:              { icon: '📝', label: 'Nota'               },
  milk:              { icon: '🍼', label: 'Biberón'           },
  structured_entry:  { icon: '📋', label: 'Registro'          },
  fiebre:            { icon: '🤒', label: 'Fiebre'            },
  accidente:         { icon: '🩹', label: 'Accidente'        },
  golpe:             { icon: '🤕', label: 'Golpe'             },
  llamada_padres:    { icon: '📞', label: 'Llamada a padres'  },
  medicamento_extra: { icon: '💊', label: 'Medicamento extra' },
  otro:              { icon: '📋', label: 'Otro evento'       },
  // Catálogo V8
  bienvenida:        { icon: '👋', label: 'Bienvenida'        },
  actividad:         { icon: '📚', label: 'Actividad'         },
  patio:             { icon: '🌳', label: 'Patio'             },
  cepillado:         { icon: '🪥', label: 'Cepillado'         },
  lavado_manos:      { icon: '🧼', label: 'Lavado de manos'   },
  agua:              { icon: '💧', label: 'Agua'              },
  fruta:             { icon: '🍌', label: 'Fruta'             },
  picada:            { icon: '🥪', label: 'Picada'            },
  descanso_corto:    { icon: '😪', label: 'Descanso breve'    },
  crema:             { icon: '🧴', label: 'Crema / Solar'     },
  manualidad:        { icon: '🎨', label: 'Manualidad'        },
  musica:            { icon: '🎵', label: 'Música'            },
  baile:             { icon: '💃', label: 'Baile'             },
  gimnasia:          { icon: '🤸', label: 'Gimnasia'          },
  juego_libre:       { icon: '🧸', label: 'Juego libre'       },
  juegos_mesa:       { icon: '🎲', label: 'Juegos de mesa'    },
  construccion:      { icon: '🧱', label: 'Bloques'           },
  convivencia:       { icon: '🤝', label: 'Convivencia'       },
  compartir:         { icon: '💬', label: 'Compartir'         },
  emociones:         { icon: '💛', label: 'Emociones'         },
  proyecto:          { icon: '🎯', label: 'Proyecto'          },
  lectura:           { icon: '📖', label: 'Cuento'            },
  escritura:         { icon: '✏️', label: 'Escritura'         },
  matematicas:       { icon: '🔢', label: 'Matemáticas'       },
  ciencias:          { icon: '🔬', label: 'Ciencias'          },
  idiomas:           { icon: '🗣️', label: 'Idiomas'           },
  paseo:             { icon: '🚶', label: 'Paseo'             },
  huerta:            { icon: '🌱', label: 'Huerta'            },
  juegos_agua:       { icon: '💦', label: 'Juegos de agua'    },
  malestar:          { icon: '🤢', label: 'Malestar'          },
  curacion:          { icon: '🩹', label: 'Curaciones'        },
  pelea:             { icon: '🤜', label: 'Pelea'             },
  otro_incidente:    { icon: '⚠️', label: 'Incidente'         },
  cumpleanos:        { icon: '🎂', label: 'Cumpleaños'        },
  evento_especial:   { icon: '🎉', label: 'Evento especial'   },
  // Catálogo V9
  gateo:             { icon: '🚼', label: 'Gateo y Desplazamiento' },
  masaje_infantil:   { icon: '💆', label: 'Masaje Infantil'   },
  texturas_sensoriales: { icon: '🧊', label: 'Exploración Sensorial' },
  recortado_ensamble:   { icon: '✂️', label: 'Motricidad Fina' },
  puzzles:           { icon: '🧩', label: 'Rompecabezas'      },
  circuito_motor:    { icon: '🎪', label: 'Circuito Psicomotor' },
  modelado:          { icon: '🧱', label: 'Modelado (Arcilla)' },
  juego_motor_agil:  { icon: '🏃', label: 'Correr / Persecución' },
  asamblea_matutina: { icon: '💬', label: 'Asamblea de Aula'  },
  dramatizacion:     { icon: '🎭', label: 'Juego Simbólico'   },
  mediacion_conflicto: { icon: '🤝', label: 'Resolución de Conflictos' },
  logro_destacado:   { icon: '👏', label: 'Refuerzo Positivo' },
  objeto_apego:      { icon: '🧸', label: 'Objeto de Transición' },
  terapia_lenguaje:  { icon: '🗣️', label: 'Terapia de Lenguaje' },
  pantalla_interactiva: { icon: '💻', label: 'Tecnología Educativa' },
  observacion_insectos_plantas: { icon: '🌿', label: 'Exploración de la Naturaleza' },
  mini_cocina:       { icon: '🍳', label: 'Taller de Mini Cocina' },
  balanza_medidas:   { icon: '⚖️', label: 'Peso y Medidas'    },
  tesoro_mapa:       { icon: '🧭', label: 'Orientación y Mapas' },
  simulacro_evacuacion: { icon: '🚨', label: 'Simulacro de Evacuación' },
  entrega_mochila:   { icon: '🧳', label: 'Entrega de Pertenencias' },
  transporte_escolar: { icon: '🚌', label: 'Abordaje de Transporte' },
  recorrido_salida:  { icon: '👤', label: 'Identificación de Tutor' },
  lonchera_sana:     { icon: '🎒', label: 'Revisión de Lonchera' },
  distintivo_salida: { icon: '🦺', label: 'Chaleco / Distintivo' },
  exposicion_arte:   { icon: '🎨', label: 'Galería de Arte'   },
  orquesta_infantil: { icon: '🎶', label: 'Concierto de Instrumentos' },
  show_talentos:     { icon: '👑', label: 'Show de Talentos'  },
  foto_escolar:      { icon: '📸', label: 'Sesión Fotográfica' },
  fiesta_tematica:   { icon: '🎉', label: 'Fiesta Temática'   },
  yoga_infantil:     { icon: '🕊️', label: 'Yoga Infantil'     },
  intercambio_detalles: { icon: '🎁', label: 'Intercambio de Detalles' },
  cine_foro:         { icon: '🎬', label: 'Cine Infantil'     },
  limpieza_colaborativa: { icon: '🧹', label: 'Cuidado del Aula' },
  biblioteca_rincon: { icon: '📖', label: 'Biblioteca'         },
  cuento_siesta:     { icon: '💤', label: 'Cuento para dormir' },
  salida:            { icon: '👋', label: 'Salida'              },
  // Actividades por edad
  estimulacion_visual:       { icon: '👀', label: 'Estimulación visual' },
  seguimiento_objetos:       { icon: '🎈', label: 'Seguimiento de objetos' },
  estimulacion_auditiva:     { icon: '👂', label: 'Estimulación auditiva' },
  sonidos_voces:             { icon: '🗣️', label: 'Sonidos y voces' },
  canciones_bebe:            { icon: '🎵', label: 'Canciones para bebés' },
  sonajeros:                 { icon: '🪇', label: 'Sonajeros' },
  exploracion_texturas_bebe: { icon: '🖐️', label: 'Exploración de texturas' },
  causa_efecto:              { icon: '🔘', label: 'Causa y efecto' },
  alcanzar_objetos:          { icon: '🤲', label: 'Alcanzar objetos' },
  agarre_objetos:            { icon: '✋', label: 'Agarre de objetos' },
  transferencia_objetos:     { icon: '🔄', label: 'Transferencia de objetos' },
  tummy_time:                { icon: '👶', label: 'Tummy Time' },
  rodar:                     { icon: '↩️', label: 'Rodar' },
  estimulacion_gateo:        { icon: '🚼', label: 'Estimulación para gateo' },
  gateo_libre:               { icon: '🐾', label: 'Gateo libre' },
  juego_espejo:              { icon: '🪞', label: 'Juego con espejo' },
  escondidas_bebe:           { icon: '🫥', label: 'Juego de escondidas' },
  balbuceo:                  { icon: '👄', label: 'Balbuceo / Vocalización' },
  pintura_dedos:             { icon: '🎨', label: 'Pintura con dedos' },
  pintura_esponja:           { icon: '🧽', label: 'Pintura con esponja' },
  garabateo:                 { icon: '✏️', label: 'Garabateo libre' },
  rasgado_papel:             { icon: '📄', label: 'Rasgado de papel' },
  pegado_figuras:            { icon: '🟦', label: 'Pegado de figuras' },
  plastilina:                { icon: '🟣', label: 'Juego con plastilina' },
  clasificacion_objetos:     { icon: '🔵', label: 'Clasificación de objetos' },
  encaje:                    { icon: '🧩', label: 'Juego de encajar' },
  torre_bloques:             { icon: '🧱', label: 'Torre de bloques' },
  colores_basicos:           { icon: '🌈', label: 'Introducción a colores' },
  animales_basicos:          { icon: '🐶', label: 'Identificación de animales' },
  sonidos_animales:          { icon: '🐮', label: 'Sonidos de animales' },
  canciones_movimiento:      { icon: '🎵', label: 'Canciones con movimientos' },
  juegos_imitacion:          { icon: '🪞', label: 'Juegos de imitación' },
  esconder_objetos:          { icon: '🙈', label: 'Juego de esconder objetos' },
  buscar_objetos:            { icon: '🔎', label: 'Buscar objetos' },
  trasvasar_agua:            { icon: '💧', label: 'Trasvasar agua' },
  arena:                     { icon: '🏖️', label: 'Juegos con arena' },
  circuito_motor_sencillo:   { icon: '🤸', label: 'Circuito motor sencillo' },
  caminar_lineas:            { icon: '➖', label: 'Caminar sobre líneas' },
  nombrar_objetos:           { icon: '🗣️', label: 'Nombrar objetos' },
  partes_cuerpo:             { icon: '👃', label: 'Identificar partes del cuerpo' },
  repetir_palabras:          { icon: '🔤', label: 'Repetición de palabras' },
  canciones_palabras:        { icon: '🎵', label: 'Canciones de palabras' },
  cuento_imagenes:           { icon: '📖', label: 'Cuento con imágenes' },
  senalar_imagenes:          { icon: '👆', label: 'Señalar imágenes' },
  preguntas_simples:         { icon: '❓', label: 'Preguntas simples' },
  imitacion_sonidos:         { icon: '🔊', label: 'Imitación de sonidos' },
  reconocimiento_colores:    { icon: '🌈', label: 'Reconocimiento de colores' },
  reconocimiento_formas:     { icon: '🔺', label: 'Reconocimiento de formas' },
  clasificacion_color:       { icon: '🎨', label: 'Clasificación por color' },
  clasificacion_tamano:      { icon: '📏', label: 'Clasificación por tamaño' },
  conteo_objetos:            { icon: '🔢', label: 'Conteo de objetos' },
  asociacion_imagenes:       { icon: '🖼️', label: 'Asociación de imágenes' },
  memoria_visual:            { icon: '🧠', label: 'Memoria visual' },
  rompecabezas_sencillos:    { icon: '🧩', label: 'Rompecabezas sencillos' },
  secuencias_simples:        { icon: '🔢', label: 'Secuencias simples' },
  grande_pequeno:            { icon: '↕️', label: 'Grande y pequeño' },
  arriba_abajo:              { icon: '⬆️', label: 'Arriba y abajo' },
  dentro_fuera:              { icon: '📦', label: 'Dentro y fuera' },
  trazos_verticales:         { icon: '✏️', label: 'Trazos verticales' },
  trazos_horizontales:       { icon: '➖', label: 'Trazos horizontales' },
  trazos_circulares:         { icon: '⭕', label: 'Trazos circulares' },
  enhebrado:                 { icon: '🧵', label: 'Enhebrado' },
  pinzas_objetos:            { icon: '🤏', label: 'Pinzas y objetos' },
  modelado_plastilina:       { icon: '🟣', label: 'Modelado con plastilina' },
  rasgado_pegado:            { icon: '📄', label: 'Rasgado y pegado' },
  pintura_libre:             { icon: '🎨', label: 'Pintura libre' },
  pintura_dirigida:          { icon: '🖌️', label: 'Pintura dirigida' },
  conversacion_guiada:       { icon: '💬', label: 'Conversación guiada' },
  nombrar_imagenes:          { icon: '🖼️', label: 'Nombrar imágenes' },
  completar_frases:          { icon: '🗣️', label: 'Completar frases' },
  cuento_participativo:      { icon: '📖', label: 'Cuento participativo' },
  rimas:                     { icon: '🎵', label: 'Rimas infantiles' },
  canciones_educativas:      { icon: '🎶', label: 'Canciones educativas' },
  adivinanzas:               { icon: '❓', label: 'Adivinanzas sencillas' },
  reconocimiento_letras:     { icon: '🔤', label: 'Reconocimiento de letras' },
  letra_dia:                 { icon: '🔠', label: 'Letra del día' },
  trazado_letras:            { icon: '✏️', label: 'Trazado de letras' },
  identificacion_nombre:     { icon: '🪪', label: 'Identificación del nombre' },
  escritura_nombre:          { icon: '✍️', label: 'Escritura del nombre' },
  sonido_inicial:            { icon: '🔊', label: 'Sonido inicial de palabras' },
  letra_imagen:              { icon: '🖼️', label: 'Asociación letra-imagen' },
  cuento_comprension:        { icon: '📖', label: 'Cuento y comprensión' },
  ordenar_historia:          { icon: '📚', label: 'Ordenar una historia' },
  crear_historia:            { icon: '📝', label: 'Crear una historia' },
  conteo_10:                 { icon: '🔢', label: 'Conteo hasta 10' },
  conteo_20:                 { icon: '🔢', label: 'Conteo hasta 20' },
  reconocimiento_numeros:    { icon: '🔢', label: 'Reconocimiento de números' },
  numero_cantidad:           { icon: '🔢', label: 'Número-cantidad' },
  series_simples:            { icon: '🔴', label: 'Series simples' },
  comparacion_cantidades:    { icon: '⚖️', label: 'Comparación de cantidades' },
  formas_geometricas:        { icon: '🔺', label: 'Formas geométricas' },
  secuencias_numericas:      { icon: '🔢', label: 'Secuencias numéricas' },
  problemas_sencillos:       { icon: '🧠', label: 'Problemas sencillos' },
  animales_domesticos:       { icon: '🐶', label: 'Animales domésticos' },
  animales_salvajes:         { icon: '🦁', label: 'Animales salvajes' },
  partes_planta:             { icon: '🌱', label: 'Partes de una planta' },
  cuidado_plantas:           { icon: '🌿', label: 'Cuidado de plantas' },
  clima:                     { icon: '☀️', label: 'El clima' },
  los_sentidos:              { icon: '👀', label: 'Los sentidos' },
  cuerpo_humano:             { icon: '🧍', label: 'El cuerpo humano' },
  experimento_agua:          { icon: '💧', label: 'Experimento con agua' },
  experimento_colores:       { icon: '🌈', label: 'Experimento con colores' },
  observacion_insectos:      { icon: '🐜', label: 'Observación de insectos' },
  lectura_palabras:          { icon: '📖', label: 'Lectura de palabras' },
  silabas:                   { icon: '🔤', label: 'Reconocimiento de sílabas' },
  formacion_palabras:        { icon: '📝', label: 'Formación de palabras' },
  escritura_palabras:        { icon: '✏️', label: 'Escritura de palabras' },
  dictado_palabras:          { icon: '🗣️', label: 'Dictado de palabras' },
  comprension_cuentos:       { icon: '📚', label: 'Comprensión de cuentos' },
  crear_cuentos:             { icon: '📝', label: 'Crear cuentos' },
  exposicion_oral:           { icon: '🎤', label: 'Exposición oral' },
  conversacion_grupal:       { icon: '💬', label: 'Conversación grupal' },
  conteo_50:                 { icon: '🔢', label: 'Conteo hasta 50' },
  sumas:                     { icon: '➕', label: 'Sumas sencillas' },
  restas:                    { icon: '➖', label: 'Restas sencillas' },
  mayor_menor:               { icon: '⚖️', label: 'Mayor y menor' },
  orden_numerico:            { icon: '🔢', label: 'Orden numérico' },
  series_numericas:          { icon: '🔢', label: 'Series numéricas' },
  patrones:                  { icon: '🔵', label: 'Patrones' },
  figuras_geometricas:       { icon: '🔺', label: 'Figuras geométricas' },
  medicion:                  { icon: '📏', label: 'Medición' },
  clasificacion:             { icon: '🔢', label: 'Clasificación' },
  resolucion_problemas:      { icon: '🧠', label: 'Resolución de problemas' },
  ciclo_planta:              { icon: '🌱', label: 'Ciclo de una planta' },
  germinacion:               { icon: '🌱', label: 'Germinación' },
  animales_habitats:         { icon: '🐘', label: 'Animales y hábitats' },
  cinco_sentidos:            { icon: '👁️', label: 'Los cinco sentidos' },
  estados_agua:              { icon: '💧', label: 'Estados del agua' },
  mezcla_colores:            { icon: '🎨', label: 'Mezcla de colores' },
  experimentos:              { icon: '🧪', label: 'Experimentos científicos' },
  observacion_clima:         { icon: '☀️', label: 'Observación del clima' },
  medioambiente:             { icon: '🌎', label: 'Cuidado del medioambiente' },
};

const MOOD_MAP  = { feliz:'😊 Contento/a', bien:'😊 Bien', normal:'😐 Normal', triste:'😢 Triste', inquieto:'😫 Inquieto/a', enojado:'😡 Molesto/a' };
const FOOD_MAP  = { todo:'Comió todo 🌟', poco:'Comió poco 🍲', nada:'No quiso comer 🙅', all:'Comió todo 🌟', half:'Comió la mitad 🥣', little:'Comió poco 🍲', none:'No quiso comer 🙅' };
const SLEEP_MAP = { si:'Durmió su siesta 💤', no:'No durmió ☀️' };

let _selectedDate   = _todayStr();
let _realtimeChannel = null;
let _scheduleChannel = null;

function _todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _formatDateLong(dateStr) {
  const [y,m,d] = dateStr.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

function _formatTime(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
}

function _minsToDuration(mins) {
  if (!mins || mins < 0) return '–';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`;
}

// ── INIT ──────────────────────────────────────────────────────────────────────
export async function initRoutinePanel(studentId) {
  const container = document.getElementById('routineSection');
  if (!container) return;
  _selectedDate = _todayStr();

  container.innerHTML = _renderSkeleton();

  await _loadAndRender(studentId, _selectedDate);
  _initRealtime(studentId);
}

async function _loadAndRender(studentId, date) {
  const container = document.getElementById('routineSection');
  if (!container) return;

  try {
    // Cargar log del día seleccionado y rango para analytics
    const today = _todayStr();
    const monthStart = date.substring(0, 8) + '01';
    const weekAgo    = (() => { const d = new Date(date); d.setDate(d.getDate() - 6); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();

    // Obtener classroom_id del estudiante actual para cargar el horario
    const student = AppState.get('currentStudent') || {};
    const classroomId = student?.classroom_id;

    const [log, weekLogs, rawSchedule] = await Promise.all([
      Api.getDailyLog(studentId, date),
      Api.getDailyLogsRange(studentId, monthStart < weekAgo ? weekAgo : monthStart, today),
      classroomId ? Api.getClassroomSchedule(classroomId).catch(() => []) : Promise.resolve([])
    ]);

    // Normalizar formato del horario (DB usa scheduled_hour/scheduled_minute, internamente usamos hour/minute)
    const schedule = (rawSchedule || []).map(s => ({
      type: s.event_type,
      label: s.event_label,
      icon: s.event_icon,
      hour: s.scheduled_hour,
      minute: s.scheduled_minute,
      duration: s.duration_minutes,
    }));

    container.innerHTML = _renderFullPanel(log, weekLogs || [], date, studentId, schedule);
    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="p-10 text-center text-rose-500 font-bold">Error al cargar el reporte. Intenta de nuevo.</div>`;
  }
}

function _initRealtime(studentId) {
  if (_realtimeChannel) { supabase.removeChannel(_realtimeChannel); }
  _realtimeChannel = supabase
    .channel('padre_routine_' + studentId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_logs' }, (payload) => {
      if (String(payload.new?.student_id) !== String(studentId) &&
          String(payload.old?.student_id) !== String(studentId)) return;
      _loadAndRender(studentId, _selectedDate);
    })
    .subscribe();

  const student = AppState.get('currentStudent') || {};
  const classroomId = student?.classroom_id;
  if (classroomId) {
    if (_scheduleChannel) supabase.removeChannel(_scheduleChannel);
    _scheduleChannel = supabase
      .channel('padre_schedule_' + classroomId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classroom_event_schedule' }, (payload) => {
        if (String(payload.new?.classroom_id) !== String(classroomId) &&
            String(payload.old?.classroom_id) !== String(classroomId)) return;
        _loadAndRender(studentId, _selectedDate);
      })
      .subscribe();
  }
}

export function changeRoutineDate(studentId, delta) {
  const d = new Date(_selectedDate);
  d.setDate(d.getDate() + delta);
  const next = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if (next > _todayStr()) return; // No navegar al futuro
  _selectedDate = next;
  document.getElementById('routineSection').innerHTML = _renderSkeleton();
  _loadAndRender(studentId, _selectedDate);
}

export function selectRoutineDate(studentId, date) {
  if (!date || date > _todayStr()) return;
  _selectedDate = date;
  document.getElementById('routineSection').innerHTML = _renderSkeleton();
  _loadAndRender(studentId, _selectedDate);
}

function _renderSkeleton() {
  return `<div class="animate-pulse space-y-4 p-4">
    <div class="h-8 bg-green-50 rounded-2xl w-2/3"></div>
    <div class="h-32 bg-slate-100 rounded-[1.5rem]"></div>
    <div class="grid grid-cols-3 gap-3"><div class="h-20 bg-slate-100 rounded-[1.5rem]"></div><div class="h-20 bg-slate-100 rounded-[1.5rem]"></div><div class="h-20 bg-slate-100 rounded-[1.5rem]"></div></div>
    <div class="h-40 bg-slate-100 rounded-[1.5rem]"></div>
  </div>`;
}

// ── RENDER PANEL COMPLETO ────────────────────────────────────────────────────
function _renderFullPanel(log, weekLogs, date, studentId, schedule = []) {
  const events    = log ? (log.events || log.infant_data || []) : [];
  const lastUpdate = log?.created_at ? `Actualizado ${_formatTime(log.created_at)}` : '';
  const isToday   = date === _todayStr();
  const canGoNext = !isToday;

  // Calcular stats del día
  const totalNapMins  = _calcTotalNapMins(events);
  const totalOz       = _calcTotalOz(events, log);
  const wetDiapers    = events.filter(e => e.type === 'panal_humedo').length;
  const dirtyDiapers  = events.filter(e => e.type === 'panal_sucio').length;

  return `
  <div class="space-y-5 pb-10" id="routinePanelInner">

    <!-- DATE PICKER / NAVEGACIÓN -->
    <div class="bg-white rounded-[1.5rem] border border-green-100 shadow-sm p-4">
      <div class="flex items-center justify-between gap-3">
        <button onclick="window.RoutineModule?.changeRoutineDate('${studentId}', -1)"
          class="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center hover:bg-green-100 hover:text-[#28B54D] transition-all active:scale-90">
          <i data-lucide="chevron-left" class="w-5 h-5"></i>
        </button>
        <div class="flex-1 text-center">
          <p class="text-xs font-black text-[#28B54D] uppercase tracking-widest mb-0.5">
            ${isToday ? 'Hoy' : 'Historial'}
          </p>
          <h3 class="text-sm font-black text-slate-800 capitalize leading-tight">${_formatDateLong(date)}</h3>
          ${lastUpdate ? `<p class="text-[10px] text-slate-400 font-bold mt-0.5">${lastUpdate}</p>` : ''}
        </div>
        <button onclick="window.RoutineModule?.changeRoutineDate('${studentId}', 1)"
          class="w-10 h-10 rounded-xl flex items-center justify-center transition-all ${canGoNext ? 'bg-slate-100 hover:bg-green-100 hover:text-[#28B54D] active:scale-90' : 'bg-slate-50 text-slate-300 cursor-not-allowed'}">
          <i data-lucide="chevron-right" class="w-5 h-5"></i>
        </button>
      </div>
      <!-- Mini input de fecha -->
      <div class="mt-3 flex justify-center">
        <input type="date" max="${_todayStr()}" value="${date}"
          onchange="window.RoutineModule?.selectRoutineDate('${studentId}', this.value)"
          class="text-[11px] font-bold text-slate-500 border border-slate-200 rounded-xl px-3 py-1.5 outline-none focus:border-[#28B54D] bg-slate-50 cursor-pointer">
      </div>
    </div>

    ${!log ? _renderNoReport(isToday) : `

    <!-- 3 INDICADORES RÁPIDOS -->
    <div class="grid grid-cols-3 gap-3">
      ${_renderQuickIndicator('Ánimo', log.mood ? (MOOD_MAP[log.mood.toLowerCase()] || log.mood) : '–', 'bg-orange-50 border-orange-100')}
      ${_renderQuickIndicator('Comida', log.food ? (FOOD_MAP[log.food.toLowerCase()] || log.food) : '–', 'bg-green-50 border-green-100')}
      ${(() => {
        const siestaEvs = events.filter(e => e.type === 'siesta');
        const active = siestaEvs.find(e => e.open);
        if (active) return _renderQuickIndicator('Siesta', '😴 En curso', 'bg-purple-50 border-purple-200');
        if (totalNapMins > 0) return _renderQuickIndicator('Siesta', `💤 ${_minsToDuration(totalNapMins)}`, 'bg-indigo-50 border-indigo-100');
        if (log.nap) return _renderQuickIndicator('Siesta', SLEEP_MAP[log.nap.toLowerCase()] || log.nap, 'bg-indigo-50 border-indigo-100');
        return _renderQuickIndicator('Siesta', '–', 'bg-indigo-50 border-indigo-100');
      })()}
    </div>

    <!-- ESTADÍSTICAS ACUMULADAS -->
    ${_renderDayStats(totalNapMins, totalOz, wetDiapers, dirtyDiapers, events)}

    <!-- OBSERVACIONES DE LA MAESTRA -->
    ${log.notes ? `
    <div class="bg-gradient-to-br from-[#28B54D]/5 to-green-50 border border-green-200 rounded-[1.5rem] p-5">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-lg">✏️</span>
        <p class="text-[11px] font-black text-[#28B54D] uppercase tracking-widest">Nota de la maestra</p>
      </div>
      <p class="text-sm font-medium text-slate-700 italic leading-relaxed">&ldquo;${Helpers.escapeHTML ? Helpers.escapeHTML(log.notes) : log.notes}&rdquo;</p>
    </div>` : ''}

    <!-- TIMELINE DE EVENTOS -->
    ${_renderTimeline(events, schedule, date)}

    `}

    <!-- ANALYTICS SEMANAL/MENSUAL -->
    ${weekLogs.length ? _renderWeeklyAnalytics(weekLogs, log, date) : ''}
  </div>`;
}

function _renderNoReport(isToday) {
  return `
  <div class="bg-white rounded-[1.5rem] border border-slate-100 shadow-sm p-10 text-center">
    <span class="text-5xl block mb-4">${isToday ? '⏳' : '📭'}</span>
    <p class="text-sm font-black text-slate-500">${isToday ? 'El reporte de hoy aún no ha sido publicado.' : 'No hay reporte para este día.'}</p>
    ${isToday ? `<p class="text-xs text-slate-400 mt-1">La maestra lo publicará durante la jornada.</p>` : ''}
  </div>`;
}

function _renderQuickIndicator(title, value, colorCls) {
  return `
  <div class="bg-white border ${colorCls} rounded-[1.5rem] p-4 text-center shadow-sm">
    <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">${title}</p>
    <p class="text-xs font-black text-slate-700 leading-snug">${value}</p>
  </div>`;
}

function _renderDayStats(napMins, totalOz, wetDiapers, dirtyDiapers, events) {
  // Calcular hora que despertó (última siesta cerrada)
  const closedSiestas = (events || []).filter(e => e.type === 'siesta' && !e.open && e.end_at);
  const lastWake      = closedSiestas.length ? closedSiestas[closedSiestas.length - 1] : null;
  const lastSleepStart = (() => {
    const s = (events || []).filter(e => e.type === 'siesta');
    return s.length ? s[0] : null;
  })();

  const stats = [
    { icon: '😴', label: 'Sueño total',    value: napMins  > 0 ? _minsToDuration(napMins) : '–' },
    { icon: '🛌', label: 'Se durmió',      value: lastSleepStart ? _formatTime(lastSleepStart.created_at) : '–' },
    { icon: '☀️', label: 'Despertó',       value: lastWake ? _formatTime(lastWake.end_at) : (lastSleepStart?.open ? 'En curso' : '–') },
    { icon: '🍼', label: 'Leche total',    value: totalOz  > 0 ? `${totalOz} oz`          : '–' },
    { icon: '💧', label: 'Pañales 💧',     value: String(wetDiapers) },
    { icon: '💩', label: 'Pañales 💩',     value: String(dirtyDiapers) },
  ].filter(s => s.value !== '–' || ['Sueño total','Leche total'].includes(s.label));

  return `
  <div class="bg-white border border-slate-100 rounded-[1.5rem] shadow-sm p-5">
    <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">Estadísticas del día</p>
    <div class="grid grid-cols-2 gap-3">
      ${stats.map(s => `
      <div class="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl">
        <span class="text-xl shrink-0">${s.icon}</span>
        <div>
          <p class="text-[9px] font-black text-slate-400 uppercase">${s.label}</p>
          <p class="text-sm font-black text-slate-800">${s.value}</p>
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

// ── TIMELINE DE EVENTOS ───────────────────────────────────────────────────────
const _DEFAULT_SCHEDULE = [
  { type: 'bienvenida', label: 'Bienvenida', hour: 7,  minute: 30, duration: 30, icon: '👋' },
  { type: 'desayuno',   label: 'Desayuno',   hour: 8,  minute: 0,  duration: 60, icon: '🍞' },
  { type: 'actividad',  label: 'Actividad',  hour: 9,  minute: 0,  duration: 30, icon: '📚' },
  { type: 'bano',       label: 'Baño',       hour: 9,  minute: 30, duration: 30, icon: '🚽' },
  { type: 'patio',      label: 'Patio',      hour: 10, minute: 0,  duration: 90, icon: '🌳' },
  { type: 'almuerzo',   label: 'Almuerzo',   hour: 11, minute: 30, duration: 60, icon: '🥗' },
  { type: 'siesta',     label: 'Siesta',     hour: 12, minute: 30, duration: 90, icon: '😴' },
  { type: 'merienda',   label: 'Merienda',   hour: 14, minute: 0,  duration: 60, icon: '🍎' },
  { type: 'biberon',    label: 'Biberón',    hour: 15, minute: 0,  duration: 30, icon: '🍼' },
];

function _formatTime12(h, m) {
  const hh = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${hh}:${String(m).padStart(2,'0')} ${ampm}`;
}

function _timeToMins(isoStr) {
  if (!isoStr) return -1;
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return -1;
  return d.getHours() * 60 + d.getMinutes();
}

function _renderTimeline(events, schedule = [], date = '') {
  const student = AppState.get('currentStudent') || {};
  const exitTimeStr = student.exit_time || '';
  const exitMins = exitTimeStr ? parseInt(exitTimeStr.split(':')[0], 10) * 60 + parseInt(exitTimeStr.split(':')[1], 10) : 0;
  const hasExitTime = !!exitTimeStr;

  const sched = schedule.length ? schedule : _DEFAULT_SCHEDULE;
  const isToday = date === _todayStr();
  const now = isToday ? new Date() : null;
  const nowMins = now ? now.getHours() * 60 + now.getMinutes() : -1;

  // Mapear eventos logueados por tipo para saber cuáles ya tienen registro
  const loggedByType = {};
  events.forEach(ev => {
    if (!loggedByType[ev.type]) loggedByType[ev.type] = [];
    loggedByType[ev.type].push(ev);
  });

  // Detectar si el estudiante ya fue retirado (salida real por ponchador)
  const salidaEvent = events.find(e => e.type === 'salida');
  const wasPickedUp = !!salidaEvent;

  // Último slot del horario que ya comenzó (hoy)
  let activeIdx = -1;
  if (isToday) {
    for (let i = sched.length - 1; i >= 0; i--) {
      const slotMins = sched[i].hour * 60 + sched[i].minute;
      if (nowMins >= slotMins) { activeIdx = i; break; }
    }
  }

  const scheduleTypes = new Set(sched.map(s => s.type));
  const timeline = [];

  // ── Bloques del horario programado ──
  sched.forEach((ev, i) => {
    const timeMins = ev.hour * 60 + ev.minute;
    const timeStr = _formatTime12(ev.hour, ev.minute);
    const endMins = timeMins + (ev.duration || 30);
    const endTimeStr = _formatTime12(Math.floor(endMins / 60), endMins % 60);
    const isPast = i < activeIdx;
    const isActive = i === activeIdx;
    const isFuture = i > activeIdx;

    // Si el estudiante tiene hora de salida, no mostrar eventos que empiecen después de esa hora
    if (hasExitTime && timeMins >= exitMins) return;

    // Verificar si este tipo de evento tiene registros
    const evType = ev.type;
    const logged = loggedByType[evType] || [];
    const hasSchedMark = logged.some(e => e.scheduled_time);
    const hasLogged = hasSchedMark
      ? logged.some(e => (e.scheduled_time || '') === timeStr)
      : logged.length > 0;
    const detailLogged = hasSchedMark ? logged.filter(e => (e.scheduled_time || '') === timeStr) : logged;

    // Para biberón, también checar structured_entry y milk
    const hasMilkLogged = (loggedByType['biberon'] || []).length > 0 ||
                          (loggedByType['milk'] || []).length > 0 ||
                          (loggedByType['structured_entry'] || []).length > 0;

    const isLogged = evType === 'biberon' ? hasMilkLogged : hasLogged;

    // Revelación progresiva: hoy solo aparecen los eventos ya vividos
    // (el resto de la jornada queda oculto hasta que llegue su hora)
    if (isToday && isFuture && !isLogged) return;

    // Icono del schedule o del EVENT_META
    const icon = ev.icon || EVENT_META[evType]?.icon || '⏰';

    // Construir detalle
    let detail = '';
    if (isLogged && evType === 'biberon') {
      const totalOz = (loggedByType['biberon'] || [])
        .concat(loggedByType['milk'] || [])
        .reduce((sum, e) => sum + parseFloat(e.oz || e.milk || e.value || 0), 0);
      detail = totalOz > 0 ? `${totalOz} oz` : '';
    } else if (isLogged && evType === 'siesta') {
      const siestaEvs = loggedByType['siesta'] || [];
      const totalMins = siestaEvs.reduce((sum, e) => sum + (e.duration_min || 0), 0);
      if (totalMins > 0) detail = _minsToDuration(totalMins);
    } else if (isLogged && detailLogged[0]) {
      // Tomar detalle del primer evento logueado de este tipo
      const firstEv = detailLogged[0];
      if (firstEv.comment) detail = firstEv.comment;
      else if (firstEv.value) detail = String(firstEv.value);
    }

    // Color/estilo según estado
    let statusBadge = '';
    if (isActive) {
      statusBadge = '<span class="px-2 py-0.5 bg-[#FF8A00] text-white text-[7px] font-black uppercase rounded-lg animate-pulse">AHORA</span>';
    } else if (isLogged) {
      statusBadge = '<span class="px-2 py-0.5 bg-green-100 text-[#28B54D] text-[7px] font-black uppercase rounded-lg">✓ Hecho</span>';
    } else if (isToday && isPast) {
      statusBadge = '<span class="px-2 py-0.5 bg-slate-100 text-slate-400 text-[7px] font-black uppercase rounded-lg">—</span>';
    }

    const borderCls = isActive
      ? 'border-2 border-[#FF8A00]/30 bg-gradient-to-r from-[#FF8A00]/5 to-orange-50/50 shadow-sm'
      : isLogged
        ? 'border-2 border-green-100 bg-green-50/30'
        : 'border-2 border-transparent';

    timeline.push({
      timeMins: ev.hour * 60 + ev.minute,
      html: `
    <div class="relative flex items-start gap-4 p-3 rounded-2xl ${borderCls}">
      <div class="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 z-10 ${isActive ? 'shadow-md' : ''}"
        style="${isActive ? 'background:linear-gradient(135deg, #FF8A00, #f97316);color:white;box-shadow:0 4px 12px rgba(255,138,0,0.3);' : 'background:white;border:2px solid #f1f5f9;'}">
        ${icon}
      </div>
      <div class="flex-1 pb-1">
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-[11px] font-black ${isActive ? 'text-[#FF8A00]' : isLogged || isPast ? 'text-slate-500' : 'text-slate-400'}">${timeStr}</span>
          ${statusBadge}
        </div>
        <p class="text-xs font-black ${isPast ? 'text-slate-600' : 'text-slate-700'} leading-tight">${ev.label}</p>
        <div class="flex items-center gap-2 mt-0.5">
          <span class="text-[9px] font-bold text-slate-300">${endTimeStr}</span>
          <span class="text-[9px] font-bold text-slate-300">·</span>
          <span class="text-[9px] font-bold text-slate-300">${ev.duration || 30}min</span>
        </div>
        ${detail ? `<p class="text-[10px] font-medium text-slate-500 mt-0.5 leading-snug">${detail}</p>` : ''}
      </div>
    </div>`,
    });
  });

  // ── Evento de Salida (automático desde ponchador) ──
  if (wasPickedUp && salidaEvent) {
    const salTime = _timeToMins(salidaEvent.created_at);
    const salTimeStr = salidaEvent.created_at
      ? _formatTime(salidaEvent.created_at)
      : (hasExitTime ? _formatTime12(Math.floor(exitMins / 60), exitMins % 60) : '');
    const salDetail = salidaEvent.comment || 'Entrega registrada desde ponchador';
    timeline.push({
      timeMins: salTime >= 0 ? salTime : exitMins,
      html: `
    <div class="relative flex items-start gap-4 p-3 rounded-2xl border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-sky-50/50">
      <div class="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 z-10" style="background:linear-gradient(135deg,#2563eb,#3b82f6);color:white;box-shadow:0 4px 12px rgba(37,99,235,0.3);">
        👋
      </div>
      <div class="flex-1 pb-1">
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-[11px] font-black text-blue-600">${salTimeStr}</span>
          <span class="px-2 py-0.5 bg-blue-100 text-blue-600 text-[7px] font-black uppercase rounded-lg">👋 Salida</span>
        </div>
        <p class="text-xs font-black text-slate-700 leading-tight">Entrega del estudiante</p>
        ${salDetail ? `<p class="text-[10px] font-medium text-slate-500 mt-0.5 leading-snug">${salDetail}</p>` : ''}
      </div>
    </div>`,
    });
  }

  // ── Eventos reales no programados (fiebre, accidente, golpe, medicamento, nota, etc.) ──
  events.filter(ev => !scheduleTypes.has(ev.type) && ev.type !== 'salida').forEach(ev => {
    // Si tiene hora de salida, no mostrar eventos después de esa hora
    if (hasExitTime && ev.created_at) {
      const evMins = _timeToMins(ev.created_at);
      if (evMins >= exitMins) return;
    }
    const meta = EVENT_META[ev.type] || { icon: '📋', label: ev.type };
    let detail = '';
    let alertCls = '';

    if (ev.type === 'temperatura') {
      const temp = ev.temp;
      if (temp) {
        const isFever = parseFloat(temp) >= 37.5;
        detail = `${temp}°C`;
        alertCls = isFever ? 'bg-rose-50 border-rose-200' : '';
        if (isFever) detail += ' 🔥 Fiebre';
      }
    } else if (ev.type === 'medicamento') {
      detail = [ev.nombre, ev.dosis].filter(Boolean).join(' · ');
    } else if (ev.type === 'fiebre') {
      const temp = ev.temp;
      if (temp) { detail = `${temp}°C 🔥 Fiebre`; alertCls = 'bg-rose-50 border-rose-200'; }
    } else if (ev.type === 'accidente') {
      detail = ev.descripcion || ev.comment || '';
      alertCls = 'bg-rose-50 border-rose-200';
    } else if (ev.type === 'golpe') {
      detail = ev.descripcion || ev.comment || '';
      alertCls = 'bg-rose-50 border-rose-200';
    } else if (ev.type === 'llamada_padres') {
      detail = ev.motivo || ev.comment || 'La maestra llamó';
      alertCls = 'bg-amber-50 border-amber-200';
    } else if (ev.type === 'medicamento_extra') {
      detail = [ev.nombre, ev.dosis, ev.obs].filter(Boolean).join(' · ');
    } else if (ev.type === 'nota' || ev.type === 'note') {
      detail = ev.texto || ev.value || ev.comment || '';
    } else if (ev.comment) {
      detail = ev.comment;
    }

    timeline.push({
      timeMins: _timeToMins(ev.created_at),
      html: `
    <div class="relative flex items-start gap-4 p-3 rounded-2xl border-2 ${alertCls || 'border-slate-100/80 bg-slate-50/40'}">
      <div class="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 z-10" style="background:white;border:2px solid #f1f5f9;">
        ${meta.icon}
      </div>
      <div class="flex-1 pb-1">
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-[11px] font-black text-slate-500">${_formatTime(ev.created_at)}</span>
        </div>
        <p class="text-xs font-black text-slate-700 leading-tight">${meta.label}</p>
        ${detail ? `<p class="text-[10px] font-medium text-slate-500 mt-0.5 leading-snug">${detail}</p>` : ''}
      </div>
    </div>`,
    });
  });

  // Ordenar cronológicamente por la hora real en que ocurrió cada evento
  timeline.sort((a, b) => (a.timeMins < 0 ? 1441 : a.timeMins) - (b.timeMins < 0 ? 1441 : b.timeMins));

  const shown = timeline.length;
  const startedSlots = isToday ? Math.max(0, activeIdx + 1) : sched.length;
  const pct = sched.length ? Math.min(100, Math.round(startedSlots / sched.length * 100)) : 0;

  const timelineBody = shown
    ? `<div class="relative">
        <div class="absolute left-[18px] top-5 bottom-5 w-0.5 bg-gradient-to-b from-slate-200 via-slate-100 to-transparent"></div>
        <div class="space-y-1">${timeline.map(t => t.html).join('')}</div>
      </div>`
    : `<div class="text-center py-8 px-4">
        <span class="text-3xl block mb-2">${isToday ? '⏳' : '📭'}</span>
        <p class="text-xs font-black text-slate-400">${isToday ? 'Aún no hay eventos registrados hoy.' : 'No hay eventos registrados este día.'}</p>
        <p class="text-[10px] font-medium text-slate-300 mt-1">${isToday ? 'Aquí verás la cronología del día a medida que la maestra registre cada actividad.' : ''}</p>
      </div>`;

  return `
  <div class="bg-white border border-slate-100 rounded-[1.5rem] shadow-sm overflow-hidden">
    <div class="px-5 pt-4 pb-3 border-b border-slate-100" style="background:linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%);">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-8 h-8 bg-[#28B54D]/10 rounded-xl flex items-center justify-center text-base shrink-0">⏱️</span>
          <div class="min-w-0">
            <p class="text-[11px] font-black text-slate-700 uppercase tracking-widest">Historial del día</p>
            <p class="text-[9px] font-bold text-slate-400 truncate">${isToday ? 'Cronología en tiempo real' : _formatDateLong(date)}</p>
          </div>
        </div>
        ${isToday
          ? `<span class="flex items-center gap-1.5 px-2.5 py-1 bg-green-100 text-[#28B54D] text-[9px] font-black uppercase tracking-wider rounded-full shrink-0">
               <span class="w-1.5 h-1.5 bg-[#28B54D] rounded-full animate-pulse"></span>
               En vivo
             </span>`
          : `<span class="px-2.5 py-1 bg-slate-100 text-slate-500 text-[9px] font-black uppercase tracking-wider rounded-full shrink-0">${shown} evento${shown !== 1 ? 's' : ''}</span>`}
      </div>
      ${isToday && sched.length ? `
      <div class="mt-3">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[8px] font-black text-slate-400 uppercase tracking-widest">Avance del día</span>
          <span class="text-[8px] font-black text-[#28B54D]">${Math.min(startedSlots, sched.length)}/${sched.length} actividades</span>
        </div>
        <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-all duration-700" style="width:${pct}%;background:linear-gradient(90deg,#28B54D,#4ade80);"></div>
        </div>
      </div>` : ''}
    </div>
    <div class="p-4 sm:p-5">${timelineBody}</div>
  </div>`;
}

// ── ANALYTICS SEMANAL/MENSUAL ─────────────────────────────────────────────────
function _renderWeeklyAnalytics(logs, todayLog, date) {
  const totalDays = logs.length;
  if (!totalDays) return '';

  // Sueño
  const napData = logs.map(l => _calcTotalNapMins(l.events || l.infant_data || [], l));
  const avgNap  = napData.filter(v => v > 0).length
    ? Math.round(napData.filter(v=>v>0).reduce((a,b)=>a+b,0) / napData.filter(v=>v>0).length) : 0;
  const todayNap = todayLog ? _calcTotalNapMins(todayLog.events || todayLog.infant_data || []) : 0;
  const napTrend = napData.length >= 2
    ? (napData[0] >= napData[1] ? 'Mejorando ↑' : 'Variando ↓') : 'Sin datos';

  // Biberón
  const ozData  = logs.map(l => _calcTotalOz(l.events || l.infant_data || [], l));
  const avgOz   = ozData.filter(v=>v>0).length
    ? Math.round(ozData.filter(v=>v>0).reduce((a,b)=>a+b,0) / ozData.filter(v=>v>0).length) : 0;
  const todayOz = todayLog ? _calcTotalOz(todayLog.events || todayLog.infant_data || [], todayLog) : 0;

  // Comidas sólidas — porcentaje promedio
  const foodScore = (food) => ({ todo:100, all:100, poco:50, little:50, half:50, nada:0, none:0 }[food?.toLowerCase()] ?? null);
  const foodScores = logs.map(l => foodScore(l.food)).filter(v => v !== null);
  const avgFood   = foodScores.length ? Math.round(foodScores.reduce((a,b)=>a+b,0) / foodScores.length) : null;
  const todayFood = foodScore(todayLog?.food);

  // Ánimo predominante
  const moodCounts = {};
  logs.forEach(l => { if (l.mood) moodCounts[l.mood] = (moodCounts[l.mood] || 0) + 1; });
  const topMood = Object.entries(moodCounts).sort((a,b)=>b[1]-a[1])[0];

  // Temperatura — último valor
  const allTempEvents = logs.flatMap(l => (l.events || []).filter(e => e.type === 'temperatura'));
  const lastTemp = allTempEvents.length ? allTempEvents[allTempEvents.length-1] : null;

  // Pañales promedio
  const avgDiapers = totalDays > 0
    ? Math.round(logs.reduce((sum,l) => sum + (l.events||[]).filter(e=>e.type==='panal_humedo'||e.type==='panal_sucio').length, 0) / totalDays)
    : 0;

  // Eventos de salud (fiebre, accidente, golpe, llamada_padres)
  const healthAlerts = logs.reduce((sum, l) => sum + (l.events||[]).filter(e => ['fiebre','accidente','golpe','llamada_padres','medicamento_extra'].includes(e.type)).length, 0);

  return `
  <div class="bg-white border border-slate-100 rounded-[1.5rem] shadow-sm p-5 space-y-5">
    <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Análisis ${totalDays <= 7 ? 'semanal' : 'mensual'} (${totalDays} días)</p>

    <!-- Sueño -->
    <div class="p-4 bg-indigo-50 rounded-2xl border border-indigo-100 space-y-3">
      <div class="flex items-center gap-2">
        <span class="text-xl">😴</span>
        <p class="text-sm font-black text-indigo-900">Análisis de Sueño</p>
      </div>
      <div class="grid grid-cols-3 gap-2 text-center">
        ${_analyticsCell('Hoy', todayNap > 0 ? _minsToDuration(todayNap) : '–', 'text-indigo-700')}
        ${_analyticsCell('Promedio', avgNap > 0 ? _minsToDuration(avgNap) : '–', 'text-slate-600')}
        ${_analyticsCell('Tendencia', napTrend, napTrend.includes('Mejor') ? 'text-[#28B54D]' : 'text-amber-500')}
      </div>
    </div>

    <!-- Biberón -->
    ${avgOz > 0 || todayOz > 0 ? `
    <div class="p-4 bg-blue-50 rounded-2xl border border-blue-100 space-y-3">
      <div class="flex items-center gap-2">
        <span class="text-xl">🍼</span>
        <p class="text-sm font-black text-blue-900">Análisis de Leche</p>
      </div>
      <div class="grid grid-cols-2 gap-2 text-center">
        ${_analyticsCell('Hoy', todayOz > 0 ? `${todayOz} oz` : '–', 'text-blue-700')}
        ${_analyticsCell('Promedio', avgOz > 0 ? `${avgOz} oz` : '–', 'text-slate-600')}
      </div>
    </div>` : ''}

    <!-- Comidas sólidas -->
    ${avgFood !== null ? `
    <div class="p-4 bg-green-50 rounded-2xl border border-green-100 space-y-3">
      <div class="flex items-center gap-2">
        <span class="text-xl">🍽️</span>
        <p class="text-sm font-black text-green-900">Análisis de Comidas</p>
      </div>
      <div class="grid grid-cols-2 gap-2 text-center">
        ${_analyticsCell('Hoy', todayFood !== null ? `${todayFood}%` : '–', 'text-green-700')}
        ${_analyticsCell('Promedio', `${avgFood}%`, 'text-slate-600')}
      </div>
      <div class="w-full bg-green-200 rounded-full h-2">
        <div class="bg-[#28B54D] h-2 rounded-full transition-all" style="width:${avgFood}%"></div>
      </div>
    </div>` : ''}

    <!-- Salud y bienestar -->
    <div class="p-4 bg-rose-50 rounded-2xl border border-rose-100 space-y-3">
      <div class="flex items-center gap-2">
        <span class="text-xl">❤️</span>
        <p class="text-sm font-black text-rose-900">Salud y Bienestar</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        ${lastTemp ? `
        <div class="bg-white rounded-2xl p-3 border border-rose-100">
          <p class="text-[9px] font-black text-slate-400 uppercase">Últ. Temperatura</p>
          <p class="text-sm font-black ${parseFloat(lastTemp.temp) >= 37.5 ? 'text-rose-600' : 'text-slate-700'}">${lastTemp.temp}°C ${parseFloat(lastTemp.temp) >= 37.5 ? '🔥' : '✅'}</p>
        </div>` : ''}
        <div class="bg-white rounded-2xl p-3 border border-slate-100">
          <p class="text-[9px] font-black text-slate-400 uppercase">Pañales / día</p>
          <p class="text-sm font-black text-slate-700">~${avgDiapers}</p>
        </div>
        ${topMood ? `
        <div class="bg-white rounded-2xl p-3 border border-slate-100 col-span-${lastTemp ? '1' : '2'}">
          <p class="text-[9px] font-black text-slate-400 uppercase">Ánimo frecuente</p>
          <p class="text-sm font-black text-slate-700">${MOOD_MAP[topMood[0]] || topMood[0]}</p>
        </div>` : ''}
        ${healthAlerts > 0 ? `
        <div class="bg-white rounded-2xl p-3 border border-rose-100 col-span-2">
          <p class="text-[9px] font-black text-slate-400 uppercase">Eventos de salud</p>
          <p class="text-sm font-black text-rose-600">${healthAlerts} registro${healthAlerts > 1 ? 's' : ''} esta semana (fiebre, golpes, accidentes)</p>
        </div>` : ''}
      </div>
    </div>
  </div>`;
}

function _analyticsCell(label, value, colorCls) {
  return `
  <div class="bg-white rounded-2xl p-2 border border-white/80 shadow-sm">
    <p class="text-[9px] font-black text-slate-400 uppercase">${label}</p>
    <p class="text-xs font-black ${colorCls}">${value}</p>
  </div>`;
}

// ── CÁLCULOS ──────────────────────────────────────────────────────────────────
function _calcTotalNapMins(events, log) {
  let mins = 0;
  (events || []).forEach(e => {
    if (e.type === 'siesta' && e.duration_min) mins += e.duration_min;
  });
  return mins;
}

function _calcTotalOz(events, log) {
  let total = 0;
  (events || []).forEach(e => {
    if (e.type === 'biberon' || e.type === 'milk')      total += parseFloat(e.oz || e.value || 0);
    if (e.type === 'structured_entry' && e.milk)        total += parseFloat(e.milk || 0);
  });
  return Math.round(total * 10) / 10;
}

// ── EXPORTS GLOBALES (para onclick en HTML) ────────────────────────────────────
export const RoutineModule = { initRoutinePanel, changeRoutineDate, selectRoutineDate };
