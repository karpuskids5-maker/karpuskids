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
  INQUIRIES: 'inquiries',
  STAFF_PERMITS: 'staff_permits'
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

// ============================
// 📊 ESTADOS
// ============================

// 💰 Pagos
export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled'
});

