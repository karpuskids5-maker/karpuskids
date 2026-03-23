/**
 * 📦 CONSTANTES GLOBALES (PRO - ESCALABLE)
 */

// ============================
// 🗄️ TABLAS BD
// ============================
export const TABLES = Object.freeze({
  PROFILES: 'profiles',
  STUDENTS: 'students',
  TASKS: 'tasks',
  TASK_EVIDENCES: 'task_evidences',
  ATTENDANCE: 'attendance',
  ATTENDANCE_REQUESTS: 'attendance_requests',
  POSTS: 'posts',
  LIKES: 'likes',
  COMMENTS: 'comments',
  GRADES: 'grades',
  MESSAGES: 'messages',
  PAYMENTS: 'payments',
  CLASSROOMS: 'classrooms',
  NOTIFICATIONS: 'notifications',
  INQUIRIES: 'inquiries' // ✅ AGREGADO
});

// ============================
// 👥 ROLES
// ============================
export const ROLES = Object.freeze({
  DIRECTORA: 'directora',
  ASISTENTE: 'asistente',
  MAESTRA: 'maestra',
  PADRE: 'padre'
});

export const ROLE_LIST = Object.freeze(Object.values(ROLES));

// ============================
// 📊 ESTADOS
// ============================

// 📅 Asistencia
export const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: 'present',
  LATE: 'late',
  ABSENT: 'absent'
});

// 📚 Tareas
export const TASK_STATUS = Object.freeze({
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CLOSED: 'closed'
});

// 💰 Pagos
export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled'
});

// 📩 Incidencias
export const INQUIRY_STATUS = Object.freeze({
  RECEIVED: 'received',
  REVIEW: 'review',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  CLOSED: 'closed'
});

// 🔔 Notificaciones
export const NOTIFICATION_TYPES = Object.freeze({
  TASK: 'task',
  ATTENDANCE: 'attendance',
  MESSAGE: 'message',
  SYSTEM: 'system'
});

// 🎯 Filtros globales
export const FILTERS = Object.freeze({
  ALL: 'all'
});

// ============================
// 📅 MESES
// ============================
export const MONTHS = Object.freeze([
  "Enero", "Febrero", "Marzo", "Abril",
  "Mayo", "Junio", "Julio", "Agosto",
  "Septiembre", "Octubre", "Noviembre", "Diciembre"
]);

// ============================
// 🛠️ HELPERS
// ============================

/**
 * ✅ Valida rol
 */
export function isValidRole(role) {
  return ROLE_LIST.includes(role);
}

/**
 * 🔐 Normaliza texto seguro
 */
export function normalize(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

/**
 * ✅ Valida estado de pago
 */
export function isValidPaymentStatus(status) {
  return Object.values(PAYMENT_STATUS).includes(status);
}

/**
 * ✅ Valida estado de incidencia
 */
export function isValidInquiryStatus(status) {
  return Object.values(INQUIRY_STATUS).includes(status);
}