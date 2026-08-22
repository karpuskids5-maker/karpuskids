# DOCUMENTACIÓN TÉCNICA — KARPUS KIDS
## Sistema de Gestión de Estancias Infantiles

**Propietario:** Luis Alfredo Cabrera Reyes  
**Empresa:** Impulso Digital  
**Versión del Sistema:** 4.0 — Agosto 2026  
**Plataforma:** Web PWA (Progressive Web App)  
**Backend:** Supabase (PostgreSQL 15 + Auth + Storage + Realtime)  

---

## 1. VISIÓN GENERAL

Karpus Kids es un sistema integral de gestión para estancias infantiles que conecta en tiempo real a cuatro actores: **Directora**, **Asistente**, **Maestra** y **Padre/Madre**. Opera como PWA instalable en iOS y Android, sin necesidad de tienda de aplicaciones.

---

## 2. ARQUITECTURA GENERAL

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (PWA)                        │
│  ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Directora │ │Asistente │ │ Maestra  │ │  Padre   │  │
│  │  Panel    │ │  Panel   │ │  Panel   │ │  Panel   │  │
│  └───────────┘ └──────────┘ └──────────┘ └──────────┘  │
│                    ↕ REST / Realtime (WebSocket)         │
├─────────────────────────────────────────────────────────┤
│                  SUPABASE BACKEND                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │   Auth   │ │PostgreSQL│ │ Storage  │ │Realtime  │  │
│  │  (JWT)   │ │  (RLS)   │ │(Archivos)│ │(Canales) │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. STACK TECNOLÓGICO

| Capa | Tecnología |
|------|-----------|
| Frontend | HTML5 + JavaScript ES Modules (sin framework) |
| Estilos | Tailwind CSS (compilado) + CSS custom |
| Iconos | Lucide Icons |
| Gráficos | Chart.js |
| PDF | jsPDF + AutoTable |
| QR | html5-qrcode, qrcode.min.js |
| Videollamada | Jitsi Meet (iframe API) |
| Push Notifications | OneSignal |
| Backend | Supabase (PostgreSQL + Auth + Storage + Realtime) |
| PWA | Service Worker + Web App Manifest |

---

## 4. MÓDULOS COMPARTIDOS (`js/shared/`)

Usados por todos los paneles:

| Archivo | Función |
|---------|---------|
| `supabase.js` | Cliente Supabase, autenticación, roles, OneSignal, session timeout |
| `chat.js` | Lógica completa de conversaciones, mensajes en tiempo real, presencia online, tipeo |
| `chat-render.js` | HTML de burbujas WhatsApp, separadores de fecha, listas de contactos |
| `chat-view.js` | Control de vistas lista ↔ conversación; `ChatListState` (scroll/filtro persistente) |
| `chat-actions.js` | Acciones sobre mensajes: responder, reaccionar, eliminar, reenviar |
| `back-navigation.js` | Historial PWA: botón atrás físico del móvil sin recargar la app |
| `wall.js` | Muro escolar V4: posts, reacciones, comentarios, multimedia 30s, álbumes |
| `payment-service.js` | Cálculo de mora: `calcMora()`, `getMoraBreakdown()`, `daysUntilDue()` |
| `school-engine.js` | Motor del ciclo escolar: año activo, períodos, fechas de apertura/cierre |
| `helpers.js` | Utilidades: toast, skeleton, formato de moneda, escape HTML, vibración |
| `image-loader.js` | Lazy loading de imágenes, compresión a WebP, upload a Supabase Storage |
| `realtime-manager.js` | Gestor centralizado de canales Supabase Realtime |
| `query-cache.js` | Caché de queries con TTL, persistencia en IndexedDB |
| `rate-limiter.js` | Límite de tasa para mensajes y acciones sensibles |
| `offline-cache.js` | Caché offline con Service Worker |
| `offline-queue.js` | Cola de operaciones pendientes sin conexión; se sincronizan al reconectar |
| `boletin-pdf.js` | Generación de boletines académicos en PDF con jsPDF |
| `carnets.module.js` | Generación de carnets/credenciales de estudiantes |
| `student-record-modal.js` | Modal universal de ficha de estudiante (CRUD completo) |
| `incoming-banner.js` | Banner global de mensajes entrantes visible en cualquier sección |
| `notify-permission.js` | Solicitud de permisos de notificaciones push |
| `calendar-view.js` | Vista de calendario del año escolar y períodos |
| `videocall.js` / `videocall-ui.js` | Integración de videollamadas Jitsi Meet |
| `ui-premium.js` | Transiciones animadas entre secciones |
| `badges.js` | Sistema de badges de notificaciones en la navegación |
| `confetti.min.js` | Animación de confeti para confirmaciones de éxito |

---

## 5. PANELES DE USUARIO

### 5.1 Panel Maestra (`panel-maestra.html`)

**Propósito:** Herramienta de trabajo diario del docente para gestionar su aula asignada.

| Módulo | Descripción |
|--------|-------------|
| **Mis Clases (Home)** | Vista de aulas asignadas, estadísticas del día (alumnos, asistencia, incidentes), widget de actividad próxima y alertas de inasistencia |
| **Detalle de Aula** | Barra de tabs deslizable para acceder a: Muro, Rutina, Alumnos, Asistencia, Tareas, Videollamada |
| **Muro del Aula** | Publicaciones con texto, imágenes, videos (hasta 30s) y álbumes. Reacciones, comentarios anidados, fijar posts, programar publicaciones |
| **Rutina Diaria V4** | Timeline cronológico del día; registro individual y colectivo de 100+ tipos de eventos (comida, siesta, pañal, biberón, temperatura, actividades…); tarjetas de alumno con swipe gestures |
| **Alumnos** | Lista de estudiantes del aula con ficha rápida e incidentes |
| **Asistencia** | Pase de lista: Presente, Tardanza, Ausente, Retirado. Compatible con escaneo QR |
| **Tareas** | Crear, editar y calificar tareas. Sistema V2 con actividades por áreas y materias |
| **Calificaciones** | Notas por materia y período, promedios automáticos, generación de boletín PDF |
| **Chat** | Mensajería estilo WhatsApp con padres, directora y asistente |
| **Videollamada** | Sala Jitsi en vivo para clases virtuales |
| **Mis Permisos** | Solicitar y ver estado de permisos laborales |
| **Mi Perfil** | Datos personales, avatar, código QR de acceso |

**Archivos JS principales:**
- `js/maestra/main.js` — Inicialización, autenticación, navegación, BackNavigation PWA
- `js/maestra/modules/routine.js` — Rutina Diaria V4 (~3 500 líneas)
- `js/maestra/modules/attendance.js` — Asistencia
- `js/maestra/modules/tasks.js` — Tareas y calificaciones V2
- `js/maestra/modules/chat_app.js` — Chat WhatsApp
- `js/maestra/modules/students.js` — Ficha del alumno
- `js/maestra/modules/permits.js` — Permisos laborales
- `js/maestra/modules/boletin.js` — Boletines
- `js/maestra/modules/ui.js` — Modal, Skeleton, helpers UI
- `js/maestra/api.js` — Capa de acceso a Supabase

---

### 5.2 Panel Asistente (`panel_asistente.html`)

**Propósito:** Gestión operativa del centro: estudiantes, pagos, inscripciones, accesos, comunicación.

| Módulo | Descripción |
|--------|-------------|
| **Dashboard** | KPIs del día: alumnos, asistencia, pagos pendientes, ingresos del mes. Gráfico anual de ingresos. Alertas de pagos vencidos y cumpleaños próximos |
| **Estudiantes** | CRUD completo con matrícula, aula, tutor, avatar. Paginación, búsqueda en tiempo real, ficha detallada |
| **Inscripciones** | Revisión de preinscripciones, aprobación/rechazo, conversión a estudiante activo, sincronización automática |
| **Maestros** | CRUD de docentes: asignación de aula, datos de contacto, credenciales QR |
| **Aulas** | Gestión de salones: nombre, nivel, capacidad, maestra asignada, ocupación |
| **Calendario Escolar** | Visualización del año escolar y períodos académicos |
| **Muro Escolar** | Crear publicaciones generales para todos los padres |
| **Chat** | Centro de comunicación con todos los perfiles del sistema |
| **Videollamadas** | Sala virtual para reuniones |
| **Permisos y Faltas** | Gestión de permisos del personal |
| **Accesos QR** | Escáner de entrada/salida de estudiantes; historial de ponches con fecha, hora y tipo |
| **Pagos** | Registro, aprobación, rechazo de comprobantes; cálculo de mora; recordatorios; ciclo anual de 12 pagos |
| **Calificaciones** | Acceso de solo lectura a calificaciones por aula |
| **Mi Perfil** | Perfil personal con QR de acceso |

**Archivos JS principales:**
- `js/asistente/main.js` — Inicialización completa y chat (~1 336 líneas)
- `js/asistente/modules/students.js` — Gestión de estudiantes
- `js/asistente/modules/rooms.js` — Aulas
- `js/asistente/modules/dashboard.js` — KPIs
- `js/asistente/payments.js` — Módulo de pagos
- `js/asistente/teachers.js` — Maestros
- `js/asistente/access.js` — Escáner QR de accesos

---

### 5.3 Panel Padre (`panel_padres.html`)

**Propósito:** Vista familiar del progreso del hijo, comunicación con la escuela y gestión de pagos.

| Módulo | Descripción |
|--------|-------------|
| **Inicio (Home)** | Tarjetas resumen: asistencia de hoy, tareas pendientes, calificación actual, saldo. Indicador de clase en vivo |
| **Muro** | Publicaciones del aula con reacciones y comentarios |
| **Tareas (Mochila)** | Ver tareas asignadas, entregar evidencias (foto/archivo), ver calificaciones y estrellas |
| **Rutina Diaria** | Reporte del día del hijo: humor, comida, siesta, eventos registrados por la maestra |
| **Asistencia** | Calendario mensual de asistencia. Reportar ausencias anticipadas con motivo y nota |
| **Calificaciones** | Notas por materia y período. Boletín descargable en PDF |
| **Pagos** | Historial, envío de comprobantes, cálculo automático de mora con 1 clic, estado de revisión |
| **Chat** | Mensajería directa con la maestra y directora |
| **Videollamada** | Entrar a la sala de clase en vivo |
| **Reinscripción** | Formulario habilitado durante el período de reinscripción |
| **Mi Perfil** | Datos del padre/madre, foto del estudiante, cambio de contraseña |

**Archivos JS principales:**
- `js/padre/main.js` — Inicialización, autenticación, navegación, BackNavigation PWA
- `js/padre/chat.js` — Chat módulo completo
- `js/padre/payments.js` — Pagos con mora automática
- `js/padre/attendance.js` — Asistencia y reporte de ausencias
- `js/padre/tasks.js` — Tareas y evidencias
- `js/padre/grades.js` — Calificaciones
- `js/padre/routine.js` — Rutina diaria del hijo
- `js/padre/feed.js` — Muro del aula
- `js/padre/profile.js` — Perfil familiar
- `js/padre/reinscripcion.js` — Reinscripción
- `js/padre/appState.js` — Estado global del panel padre

---

## 6. AUTENTICACIÓN Y ROLES

### Roles del sistema

| Rol | Nivel de acceso |
|-----|----------------|
| `directora` | Acceso total a todos los módulos |
| `asistente` | Gestión operativa completa (estudiantes, pagos, inscripciones, accesos) |
| `maestra` | Gestión exclusiva de su aula asignada |
| `padre` | Vista de su hijo, pagos, chat, tareas, asistencia |
| `admin` | Equivalente a `directora` (acceso técnico total) |

### Flujo de autenticación
1. Login con email/contraseña vía `supabase.auth.signInWithPassword()`
2. `ensureRole(allowedRoles)` valida el rol antes de cargar el panel
3. JWT almacenado automáticamente por el Supabase SDK
4. Session timeout por inactividad (30 min en panel maestra)
5. OneSignal vincula el `user.id` al `onesignal_player_id` para push notifications

---

## 7. BASE DE DATOS SUPABASE

### 7.1 Tablas Principales

| Tabla | Descripción | Columnas Clave |
|-------|-------------|----------------|
| `profiles` | Usuarios del sistema | `id`, `role`, `name`, `email`, `avatar_url`, `access_code`, `onesignal_player_id` |
| `classrooms` | Aulas del centro | `id`, `name`, `level`, `capacity`, `teacher_id`, `is_live` |
| `students` | Estudiantes | `id`, `name`, `classroom_id`, `parent_id`, `monthly_fee`, `due_day`, `p1_name`, `p1_phone`, `p1_email`, `qr_code` |
| `school_years` | Años escolares | `id`, `name`, `start_date`, `end_date`, `status` (draft/enrollment/reenrollment/active/closed) |
| `academic_periods` | Períodos académicos | `id`, `school_year_id`, `name`, `start_date`, `end_date`, `is_active` |
| `attendance` | Asistencia diaria | `student_id`, `date`, `status` (present/absent/late/retirado), `check_in`, `check_out` |
| `attendance_requests` | Solicitudes de ausencia de padres | `student_id`, `date`, `reason`, `note`, `status` |
| `tasks` | Tareas asignadas | `id`, `classroom_id`, `teacher_id`, `title`, `due_date`, `grading_system` |
| `task_evidences` | Entregas de tareas | `task_id`, `student_id`, `file_url`, `grade_letter`, `stars`, `score_v2` |
| `posts` | Publicaciones del muro | `id`, `classroom_id`, `teacher_id`, `content`, `media_url`, `is_pinned`, `comments_enabled`, `scheduled_at`, `views_count` |
| `comments` | Comentarios en posts | `post_id`, `user_id`, `user_name`, `content`, `parent_comment_id` |
| `likes` | Reacciones en posts | `post_id`, `user_id`, `reaction_type` |
| `conversations` | Conversaciones de chat | `id`, `type` (direct_message/classroom/group) |
| `messages` | Mensajes individuales | `conversation_id`, `sender_id`, `content`, `is_read`, `read_at`, `reactions`, `deleted_at` |
| `payments` | Mensualidades | `student_id`, `amount`, `status`, `month_paid`, `due_date`, `evidence_url`, `method`, `bank` |
| `payment_audit_log` | Auditoría de cambios en pagos | `payment_id`, `action`, `old_status`, `new_status`, `changed_by` |
| `payment_plans` | Planes anuales de pago | `student_id`, `year`, `monthly_amount`, `total_amount` |
| `grades` | Calificaciones | `student_id`, `activity_id`, `score_v2`, `period_id`, `subject` |
| `activities` | Actividades evaluables | `config_id`, `title`, `activity_number`, `max_score` |
| `subjects` | Catálogo de materias | `id`, `name`, `education_level` |
| `subject_averages` | Promedios calculados | `student_id`, `period_id`, `subject_id`, `average` |
| `report_cards` | Boletines finales | `student_id`, `period_id`, `task_avg`, `final_score`, `teacher_comment` |
| `daily_logs` | Bitácora de rutina infantil | `student_id`, `date`, `mood`, `food`, `nap`, `events` (jsonb), `infant_data` (jsonb) |
| `door_punches` | Entrada/salida por QR | `student_id`, `punch_type`, `punched_at` |
| `incidents` | Incidentes del aula | `student_id`, `classroom_id`, `severity`, `status`, `description` |
| `staff_permits` | Permisos laborales | `user_id`, `type`, `start_date`, `end_date`, `status`, `reason` |
| `inquiries` | Preinscripciones | `name`, `parent_name`, `phone`, `email`, `status`, `classroom_id` |
| `classroom_event_schedule` | Cronograma de rutina por aula | `classroom_id`, `event_type`, `scheduled_hour`, `duration_minutes`, `sort_order` |
| `notifications` | Notificaciones in-app | `user_id`, `title`, `message`, `type`, `is_read` |
| `audit_logs` | Registro de auditoría general | `action`, `user_id`, `metadata` |
| `wall_notifications` | Notificaciones del muro | `user_id`, `actor_id`, `type`, `post_id` |

---

### 7.2 Funciones RPC de PostgreSQL

| Función | Descripción |
|---------|-------------|
| `get_my_role()` | Devuelve el rol del usuario autenticado |
| `calc_mora(due_date)` | Calcula la mora en RD$ según días de atraso (tramos progresivos) |
| `calculate_mora_v2()` | Versión extendida con desglose por tramos |
| `approve_payment(payment_id, actor_id)` | Aprueba un pago y registra auditoría |
| `delete_payment(payment_id)` | Elimina pago con soft-delete |
| `waive_payment_mora(payment_id)` | Condona la mora de un pago |
| `reset_payment_to_pending(payment_id)` | Revierte un pago a estado pendiente |
| `generate_annual_payments(student_id, year)` | Genera los 12 registros de pago de un año escolar |
| `pay_full_year(student_id, year, amount)` | Marca todo el año como pagado |
| `run_payment_cycle()` | Ciclo mensual: crea cargos, aplica mora automática |
| `mark_overdue_payments()` | Marca como vencidos los pagos pasados de fecha |
| `process_door_punch(qr_code, punch_type)` | Procesa entrada/salida por código QR |
| `process_student_punch(student_id, type)` | Variante de ponche por ID de estudiante |
| `find_or_create_private_conversation(user_a, user_b)` | Crea o devuelve conversación privada |
| `get_direct_messages(other_user_id, limit, offset)` | Obtiene mensajes paginados de una conversación |
| `get_unread_counts(user_id)` | Conteo de mensajes no leídos por conversación |
| `mark_messages_read(conversation_id)` | Marca mensajes como leídos |
| `increment_post_views(post_id)` | Incrementa el contador de vistas de un post |
| `get_activities_with_grades(classroom_id, period_id)` | Actividades con calificaciones por aula/período |
| `get_student_grades_v2(student_id, period_id)` | Calificaciones completas de un estudiante |
| `get_student_subject_averages(student_id, period_id)` | Promedios por materia |
| `get_student_boletin(student_id, period_id)` | Datos completos del boletín académico |
| `save_boletin_notes(student_id, period_id, notes)` | Guarda observaciones del boletín |
| `close_period(period_id)` | Cierra un período y consolida promedios |
| `create_school_year(data)` | Crea un nuevo año escolar |
| `advance_school_year_state(year_id, new_status)` | Cambia el estado del año escolar |
| `promote_students(year_id)` | Promueve estudiantes al siguiente año |
| `get_active_school_year()` | Devuelve el año escolar activo |
| `get_school_year_status()` | Estado completo del ciclo escolar |
| `get_period_stats(period_id)` | Estadísticas de un período |
| `search_students(query, limit)` | Búsqueda full-text de estudiantes |
| `log_timeline_event(classroom_id, event_type, target_students, ...)` | Registra evento en la cronología de rutina |
| `audit_report_change(report_id, changes)` | Registra cambios en boletines |

---

### 7.3 Triggers Automáticos

| Trigger | Función |
|---------|---------|
| `handle_new_user()` | Crea perfil automáticamente al registrar un usuario en `auth.users` |
| `set_updated_at()` | Actualiza el campo `updated_at` automáticamente en cualquier UPDATE |
| `fn_audit_payment()` | Audita todos los cambios en la tabla `payments` |
| `fn_audit_role_change()` | Audita cambios de rol en `profiles` |
| `fn_validate_role_change()` | Previene cambios de rol no autorizados |
| `fn_protect_paid_records()` | Protege pagos ya aprobados de modificación |
| `fn_on_payment_evidence_uploaded()` | Notifica al staff cuando el padre sube un comprobante |

---

### 7.4 Cron Jobs (pg_cron)

| Job | Frecuencia | Función |
|-----|-----------|---------|
| Ciclo de pagos | Mensual (día 1) | `run_payment_cycle()` |
| Marcar vencidos | Diario | `mark_overdue_payments()` |

---

### 7.5 Row Level Security (RLS)

Todas las tablas tienen RLS activo. Políticas principales:

| Tabla | Política |
|-------|---------|
| `profiles` | Cada usuario ve/edita solo su perfil. Staff ve todos |
| `students` | Padre ve solo sus hijos. Maestra ve su aula. Staff ve todos |
| `attendance` | Padre ve solo sus hijos. Maestra gestiona su aula |
| `payments` | Padre ve sus pagos. Staff crea/edita/aprueba |
| `messages` | Solo los participantes de la conversación |
| `posts` | Padres ven posts de su aula. Staff crea/edita/elimina |
| `grades` | Padre ve sus hijos. Maestra gestiona su aula |
| `daily_logs` | Padre ve sus hijos. Maestra gestiona su aula |
| `incidents` | Padre ve los de sus hijos. Maestra crea en su aula |

---

### 7.6 Storage (Buckets)

| Bucket | Contenido |
|--------|-----------|
| `posts` | Imágenes y videos del muro escolar |
| `karpus-uploads` | Avatares de usuarios y estudiantes |
| `classroom_media` | Media del aula (actividades, rutina) |
| *(evidencias de pagos)* | URLs guardadas en `payments.evidence_url` |
| *(evidencias de tareas)* | URLs guardadas en `task_evidences.file_url` |

---

## 8. FUNCIONALIDADES TRANSVERSALES

### Sistema de Chat (WhatsApp-style)
- Conversaciones privadas entre cualquier par de usuarios del sistema
- Burbujas diferenciadas con avatar, nombre del remitente y hora
- Indicador de "escribiendo…" en tiempo real vía Supabase Realtime
- Doble tilde (✓✓) de lectura en tiempo real
- Reacciones con emojis sobre mensajes (selector con long-press)
- Responder mensajes (citas anidadas)
- Reenviar mensajes a otros contactos
- Eliminar mensajes (marcado como eliminado, no borrado físico)
- Paginación scroll-arriba (cargar mensajes históricos)
- Estado "en línea" (presence) en lista de contactos
- Persistencia de scroll y búsqueda entre navegaciones (`ChatListState`)
- Botón atrás físico del móvil sin recargar (`BackNavigation`)

### Muro Escolar V4
- Posts con texto, imagen única, álbum de fotos (hasta 5), video (hasta 30 s)
- Compresión automática de imágenes a WebP en el cliente
- Generación de thumbnail de video en canvas
- Grabación de video directo desde el panel (30 s max)
- Recortador de video (Video Trimmer Modal)
- Reacciones animadas con picker de largo-press
- Comentarios anidados (replies)
- Fijar hasta 2 publicaciones
- Programar publicaciones a futuro
- Filtros por tipo: Videos, Fotos, Anuncios
- Scroll infinito con Intersection Observer
- Registro de vistas por post (throttled)
- Moderación: activar/desactivar comentarios por post

### Rutina Diaria V4 (Panel Maestra)
- Timeline cronológico del día con horario configurable por aula
- 100+ tipos de eventos categorizados (alimentación, higiene, salud, actividades, etc.)
- Registro colectivo (todos los alumnos a la vez) con modal tipo sheet
- Registro individual por alumno con modal completo
- Modo bebé/infantil con campos especializados (biberón en onzas, pañales)
- Cronómetro de siesta en tiempo real
- Auto-registro por horario (cron de la app)
- Swipe gestures en tarjetas de alumnos (izq = ausente, der = comió todo)
- Filtros rápidos: Sin Reportar, Durmiendo, Próx. Salir, Retirados
- Guardado de borradores en localStorage
- Publicación masiva de todos los reportes del día

### Sistema de Pagos
- Historial deduplicado por mes (muestra el estado más relevante)
- Cálculo automático de mora según tramos configurados en BD
- Botón "Aplicar mora" con 1 clic precarga el total con recargo
- Subida de comprobante con barra de progreso de upload
- Confeti de celebración al confirmar envío exitoso
- Banner de alerta contextual (vencido / próximo / al día)
- Aprobación/rechazo por asistente con auditoría completa
- Generación de ciclo anual de 12 pagos
- Condonar (waive) mora
- Gestión de planes de pago

### Notificaciones Push (OneSignal)
- Push para todos los roles en eventos clave
- Banners in-app de mensajes entrantes (visibles en cualquier sección)
- Badges numéricos en ítems de navegación
- Notificaciones de: nuevo mensaje, ausencia reportada, pago subido, tarea entregada, incidente

### PWA (Progressive Web App)
- Instalable en iOS y Android sin tienda de aplicaciones
- Botón atrás físico del móvil manejado por `BackNavigation` (sin recargar la app)
- Caché offline con Service Worker
- Cola de operaciones offline (se sincronizan al recuperar conexión)
- Actualizaciones automáticas del SW con banner de aviso
- Soporte de safe-area (`env(safe-area-inset)`) para iPhone X+

---

## 9. ACCESO Y CONFIGURACIÓN TÉCNICA

### Variables de entorno (públicas por diseño Supabase)
```javascript
SUPABASE_URL      = 'https://wwnfonkvemimwiqjpkij.supabase.co'
SUPABASE_ANON_KEY = '[JWT público de solo lectura anónima]'
```

### Jornadas Escolares
| Jornada | Entrada | Salida |
|---------|---------|--------|
| Matutina | 08:00 | 11:45 |
| Extendida | 07:00 | 14:00 |
| Completa | 07:00 | 18:00 |

### Cálculo de Mora
- Referencia: día 5 de cada mes
- Tramos progresivos configurados en la función `calc_mora()` de PostgreSQL
- Aplicable con 1 clic desde el formulario de pago del padre

---

## 10. ESTRUCTURA DE ARCHIVOS

```
karpus/
├── panel_padres.html           # Panel del padre/madre
├── panel-maestra.html          # Panel de la maestra
├── panel_asistente.html        # Panel del asistente
├── login.html                  # Página de autenticación
├── preinscripcion.html         # Formulario público de preinscripción
├── attendance-live.html        # Asistencia en vivo (pantalla TV)
├── index.html                  # Página de inicio / landing
├── css/
│   ├── layout.css              # Sistema de layout global (chat, sidebar, secciones)
│   ├── panel-padre.css         # Estilos específicos del panel padre
│   ├── karpus-modern.css       # Componentes modernos compartidos
│   ├── karpus-tailwind.css     # Utilidades Tailwind compiladas
│   ├── premium-mobile.css      # Mejoras móvil premium
│   └── theme.css               # Tokens de color y tipografía
├── js/
│   ├── shared/                 # Módulos compartidos
│   ├── padre/                  # Lógica del panel padre
│   ├── maestra/                # Lógica del panel maestra
│   ├── asistente/              # Lógica del panel asistente
│   ├── login.js
│   ├── preinscripcion.js
│   └── pwa-install.js / pwa-updater.js
├── logo/                       # Íconos PWA y favicon
├── img/                        # Imágenes del sistema
├── data/                       # Base de datos SQLite local (desarrollo)
├── migraciones/                # Historial de migraciones SQL
└── karpus_schema_completo.sql  # Esquema maestro de base de datos
```

---

## 11. MATRIZ DE CAPACIDADES POR ROL

| Capacidad | Directora | Asistente | Maestra | Padre |
|-----------|:---------:|:---------:|:-------:|:-----:|
| Ver todos los estudiantes | ✅ | ✅ | Solo su aula | Solo su hijo |
| Crear/editar estudiantes | ✅ | ✅ | ❌ | ❌ |
| Gestionar pagos | ✅ | ✅ | ❌ | Ver / enviar comprobante |
| Aprobar pagos | ✅ | ✅ | ❌ | ❌ |
| Publicar en el muro | ✅ | ✅ | Solo su aula | ❌ |
| Ver el muro | ✅ | ✅ | Su aula | Solo su aula |
| Registrar rutina | ✅ | ❌ | Solo su aula | ❌ |
| Ver rutina del hijo | ✅ | ✅ | Su aula | Solo su hijo |
| Asistencia QR | ✅ | ✅ | Su aula | Reportar ausencia |
| Calificaciones (editar) | ✅ | Solo lectura | Su aula | ❌ |
| Calificaciones (ver) | ✅ | ✅ | Su aula | Solo su hijo |
| Chat | ✅ | ✅ | ✅ | ✅ |
| Videollamada | ✅ | ✅ | Crear sala | Entrar a sala |
| Gestionar usuarios | ✅ | ✅ | ❌ | ❌ |
| Accesos QR (escanear) | ✅ | ✅ | ✅ | ❌ |
| Boletín PDF | ✅ | Solo lectura | Su aula | Descargar de su hijo |
| Inscripciones | ✅ | ✅ | ❌ | ❌ |
| Permisos laborales | ✅ (aprobar) | ✅ (aprobar) | Solicitar | ❌ |

---

*Documentación generada desde el código fuente — Agosto 2026*  
*Sistema Karpus Kids — desarrollado por Impulso Digital*  
*Propietario: Luis Alfredo Cabrera Reyes*
