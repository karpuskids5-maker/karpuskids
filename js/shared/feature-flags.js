// ═══════════════════════════════════════════════════════════════
// Feature Flags compartidos — Karpus Kids
// Fuente única de MODULES para el panel de control y los paneles.
//
// Uso en cualquier panel:
//   import { loadFlags, isEnabled, onFlagsChange } from '../shared/feature-flags.js';
//   await loadFlags();
//   isEnabled('wall', 'padre', userId)  // → boolean
//   onFlagsChange((flags) => { ... })   // sync en vivo entre dispositivos
// ═══════════════════════════════════════════════════════════════
import { supabase } from './supabase.js';

export const ROLES = ['padre', 'maestra', 'asistente', 'directora'];

export const ROLE_LABELS = {
  padre:      'Padre 👨‍👩‍👧',
  maestra:    'Maestra 👩‍🏫',
  asistente:  'Asistente 🧑‍💼',
  directora:  'Directora 🏫',
};

export const MODULES = [
  { key: 'wall',         label: 'Muro Escolar',        icon: 'bi-columns-gap',       color: '#6366f1' },
  { key: 'chat',         label: 'Chat & Mensajería',   icon: 'bi-chat-dots-fill',    color: '#3b82f6' },
  { key: 'store',        label: 'Tienda Escolar',      icon: 'bi-bag-heart-fill',    color: '#f97316' },
  { key: 'payments',     label: 'Pagos & Cobros',      icon: 'bi-credit-card-fill',  color: '#22c55e' },
  { key: 'routine',      label: 'Rutina Diaria',       icon: 'bi-clock-history',     color: '#8b5cf6' },
  { key: 'grades',       label: 'Calificaciones',      icon: 'bi-award-fill',        color: '#eab308' },
  { key: 'qr_access',    label: 'Control Accesos QR',  icon: 'bi-qr-code-scan',      color: '#ef4444' },
  { key: 'video_calls',  label: 'Videollamadas',       icon: 'bi-camera-video-fill', color: '#06b6d4' },
  { key: 'reenrollment', label: 'Reinscripción',       icon: 'bi-arrow-repeat',      color: '#ec4899' },
  // ── Módulos adicionales controlables desde el Panel de Control ──
  { key: 'tasks',             label: 'Tareas & Evidencias',   icon: 'bi-list-check',          color: '#14b8a6' },
  { key: 'attendance_live',   label: 'Asistencia en Vivo',    icon: 'bi-broadcast-pin',       color: '#84cc16' },
  { key: 'reports',           label: 'Boletines & Reportes',  icon: 'bi-file-earmark-text-fill', color: '#a78bfa' },
  { key: 'incidents',         label: 'Incidencias',           icon: 'bi-exclamation-octagon-fill', color: '#f43f5e' },
  { key: 'meetings',          label: 'Reuniones & Citas',     icon: 'bi-calendar-event-fill', color: '#0ea5e9' },
  { key: 'gallery',           label: 'Galería del Aula',      icon: 'bi-images',              color: '#f59e0b' },
  { key: 'push_notifications',label: 'Notificaciones Push',   icon: 'bi-bell-fill',           color: '#fb7185' },
  { key: 'preregistration',   label: 'Preinscripciones',      icon: 'bi-person-plus-fill',    color: '#2dd4bf' },
  { key: 'carnets',           label: 'Carnet Digital',        icon: 'bi-person-badge',        color: '#c084fc' },
];

let _cache = null;
let _channel = null;
const _subs = new Set();

export function moduleDefault() {
  return {
    enabled: true,
    roles: { padre: true, maestra: true, asistente: true, directora: true },
  };
}

export function normalizeFlags(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    modules:
      src.modules && typeof src.modules === 'object' && !Array.isArray(src.modules) ? src.modules : {},
    overrides:
      src.overrides && typeof src.overrides === 'object' && !Array.isArray(src.overrides) ? src.overrides : {},
  };
}

export async function loadFlags(force = false) {
  if (_cache && !force) return _cache;
  try {
    const { data, error } = await supabase
      .from('school_settings')
      .select('feature_flags')
      .eq('id', 1)
      .maybeSingle();
    if (!error && data) _cache = normalizeFlags(data.feature_flags);
    else if (!_cache) _cache = normalizeFlags(null);
  } catch (_) {
    if (!_cache) _cache = normalizeFlags(null);
  }
  startRealtime();
  return _cache;
}

export function getFlags() {
  return _cache || normalizeFlags(null);
}

// Reemplaza la caché local (usado por el panel de control tras guardar)
export function setLocalFlags(flags) {
  _cache = normalizeFlags(flags);
}

// Resolución: override individual > enabled global > permiso de rol > default ON
export function isEnabled(key, role, userId) {
  if (!_cache) return true; // fail-open hasta que cargue
  const ov = userId && _cache.overrides?.[userId]?.[key];
  if (ov === 'allow') return true;
  if (ov === 'deny') return false;
  const mod = _cache.modules?.[key];
  if (!mod) return true; // módulo sin config → visible para todos
  if (mod.enabled === false) return false;
  if (role && mod.roles && mod.roles[role] === false) return false;
  return true;
}

export function onFlagsChange(cb) {
  _subs.add(cb);
  return () => _subs.delete(cb);
}

function startRealtime() {
  if (_channel) return;
  try {
    _channel = supabase
      .channel('feature-flags')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'school_settings', filter: 'id=eq.1' },
        (payload) => {
          _cache = normalizeFlags(payload.new?.feature_flags);
          _subs.forEach((cb) => {
            try { cb(_cache); } catch (_) {}
          });
        }
      )
      .subscribe();
  } catch (_) {}
}
