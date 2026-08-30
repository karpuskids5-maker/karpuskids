# 📋 DOCUMENTACIÓN TÉCNICA Y ARQUITECTURA DEL SISTEMA KARPUS KIDS
**Versión de Producción V5.0 — Informe Comercial y Técnico para Elaboración de Contratos**

---

## 📄 RESUMEN EJECUTIVO
**Karpus Kids** es una plataforma web y PWA (Progressive Web App) de gestión integral para centros de educación inicial y preescolares. El sistema facilita la comunicación, administración académica, control financiero, asistencia en tiempo real y supervisión operativa entre la institución y las familias.

La plataforma se compone de una **Landing Page de Captación Comercial (`index.html`)** y **Cuatro (4) Paneles Operativos Especializados**:
1. **Panel de Padres (`panel_padres.html`)**: Experiencia móvil y de escritorio para tutores y familias.
2. **Panel de Maestra (`panel-maestra.html`)**: Gestión de aula,bitácora diaria, lista de asistencia y evidencias.
3. **Panel de Directora (`panel_directora.html`)**: Centro de comando administrativo, financiero y académico.
4. **Panel de Asistente (`panel_asistente.html`)**: Operaciones diarias, cobros en recepción, tienda y control de accesos.

---

## 🌐 1. LANDING PAGE INSTITUCIONAL (`index.html`)

### 1.1 Objetivo y Función
Pagina de presentación pública, marketing y prospección para padres de familia y futuros estudiantes. Diseñada bajo estándar SEO y PWA, libre de dependencias pesadas de BD para garantizar velocidad de carga ultrarrápida.

### 1.2 Secciones y Componentes Principales
1. **Header Fijo & Navegación Responsive (`.site-header`):**
   - Logo corporativo Karpus Kids con branding multi-color (`.karpus-kids-colored`).
   - Menú de navegación suave (Inicio, Sobre Nosotros, Programas, Servicios, Instalaciones, Testimonios, Contacto).
   - Botón de **Acceso a la App Móvil / Login** (`login.html`).
   - Menú Hamburguesa Móvil (`#mobMenu`) optimizado con área interactiva de fácil toque.

2. **Sección Hero (`#inicio`):**
   - Video en primer plano / background interactivo (`img/14.mp4` con poster de respaldo).
   - Titulares de alto impacto emocional ("El segundo hogar de tus pequeños").
   - Botones Call-To-Action (CTA): **"Agendar Visita"** y **"Solicitar Información por WhatsApp"**.

3. **Sobre Nosotros (`#nosotros`):**
   - Animación de revelado progresivo (`obs-fade`).
   - Pilares pedagógicos del centro (Educación en valores, desarrollo cognitivo, estimulación temprana).

4. **Programas Educativos (`#programas`):**
   - Tarjetas interactivas clasificadas por grupos de edad (Lactantes, Maternal, Párvulos, Kínder).

5. **Servicios & Beneficios (`#servicios`):**
   - Módulo de características principales (Cámaras/Live Stream, Mochila Digital, Menú Nutricional, Monitoreo Médico, Notificaciones Push).

6. **Galería de Instalaciones (`#instalaciones`):**
   - Visor Lightbox a pantalla completa para inspeccionar aulas, áreas de juegos y comedor.

7. **Testimonios de Familias (`#testimonios`):**
   - Carrusel con valoraciones y reseñas verificadas de padres de la comunidad.

8. **Pie de Página & Formulario de Contacto (`footer`):**
   - Integración directa con enlace oficial de WhatsApp (`+1 (829) 803-8484` / `18298038484`).
   - Enlaces legales: Política de Privacidad (`politica-privacidad.html`), Términos de Uso (`terminos-uso.html`).

---

## 👨‍👩‍👧 2. PANEL DE PADRES (`panel_padres.html`)

### 2.1 Objetivo y Función
Entorno digital privado para que los padres y tutores supervisen en tiempo real el cuidado, salud, rendimiento, rutina diaria y estado financiero de sus hijos desde cualquier dispositivo.

### 2.2 Secciones y Componentes
1. **Inicio & Resumen Diario (`#sec-home`):**
   - Selector de estudiante activo (para familias con múltiples hermanos inscritos).
   - Tarjeta de salud/estado del día (Comida, Siesta, Biberón, Esfínter).
   - Anuncios destacados y recordatorios del colegio.

2. **Muro Escolar (`#sec-feed`):**
   - Muro interactivo de fotos y comunicados del aula.
   - Botones de reacción ("Me gusta") y comentarios entre padres y docentes.
   - Visor Lightbox para fotos y reproducción de video con límite estricto de 30s.

3. **Bitácora y Rutina Diaria (`#sec-routine`):**
   - Cronograma detallado de actividades por hora.
   - Registro de ingesta de alimentos, horarios de siesta y medicamentos administrados.

4. **Chat & Mensajería Directa (`#sec-chat`):**
   - Canal directo de mensajería con la maestra del aula y la administración.
   - Envío de notas de voz, fotos y notificaciones de lectura.

5. **Asistencia (`#sec-attendance`):**
   - Historial de ponches de entrada y salida con hora exacta.
   - Visualización del Carnet Digital con Código QR dinámico para retiro del alumno.

6. **Tareas y Calificaciones (`#sec-tasks`, `#sec-grades`):**
   - Cuaderno de tareas pendientes con carga de evidencias (fotos de trabajos).
   - Boletín de calificaciones por periodos académicos.

7. **Estado Financiero y Pagos (`#sec-payments`):**
   - Monto a pagar, fecha de vencimiento e historial de cuotas.
   - Reporte de transferencias mediante subida de comprobantes con validación de recibo.

8. **Tienda Escolar (`#sec-store`):**
   - Catálogo de uniformes, materiales y actividades extracurriculares con carrito de compras.

9. **Programa de Embajadores / Referidos (`#sec-referrals`):**
   - Código único de recomendación para obtener descuentos por recomendar el colegio a nuevas familias.

---

## 👩‍🏫 3. PANEL DE MAESTRA (`panel-maestra.html`)

### 3.1 Objetivo y Función
Herramienta de trabajo para las docentes en el aula. Diseñada para operar rápidamente desde tablets o teléfonos inteligentes durante la jornada escolar.

### 3.2 Secciones y Componentes
1. **Control de Asistencia del Salón (`#sec-attendance`):**
   - Lista interactiva del día con marcado rápido de *Presente*, *Ausente*, *Tardanza* o *Excusa*.

2. **Bitácora de Rutina Diaria (`#sec-routine`):**
   - Registro masivo o individual de eventos infantiles: Alimentos (porcentaje consumido), Siesta (minutos dormidos), Baño/Pañal y Estado de ánimo.

3. **Muro y Comunicados del Aula (`#sec-feed`):**
   - Creador de publicaciones para compartir fotos y videos de actividades diarias con los padres del grupo.

4. **Gestión de Tareas (`#sec-tasks`):**
   - Asignación de deberes y revisión de evidencias enviadas por las familias.

5. **Evaluación y Calificaciones (`#sec-grades`):**
   - Registro de notas e indicadores de logros según la malla curricular preescolar.

6. **Chat Docente-Padre (`#sec-chat`):**
   - Canal oficial de conversación para atender inquietudes de los padres del aula.

---

## 🏫 4. PANEL DE DIRECTORA (`panel_directora.html`)

### 4.1 Objetivo y Función
Centro de mando ejecutivo para la dirección general de la institución. Centraliza la visión financiera, supervisión docente, expedientes estudiantiles y gobernanza académica.

### 4.2 Secciones y Componentes
1. **Dashboard General de Gestión (`#sec-dashboard`):**
   - Indicadores KPI: Matrícula total, Asistencia global del día, Ingresos del mes, Cuentas por cobrar y Mora activa.
   - Gráficos comparativos de ingresos y métricas de retención escolar.

2. **Módulo Financiero y Cierre de Pagos (`#sec-payments`):**
   - Aprobación/Rechazo de comprobantes de pago recibidos.
   - Aplicación de descuentos por hermanos, becas y condonaciones justificadas de mora.
   - Emisión de recibos electrónicos y facturación.

3. **Expediente 360° de Estudiantes (`#sec-students`):**
   - Ficha médica, contactos de emergencia, tutores autorizados para retiro y asignación de aulas.

4. **Gestión de Personal y Docentes (`#sec-teachers`):**
   - Evaluación de desempeño, puntualidad de asistencia de maestras y control de salones asignados.

5. **Aprobación de Contenidos (`#sec-feed-approval`):**
   - Flujo de revisión previa para validar publicaciones y anuncios antes de salir al muro público de las familias.

6. **Año Escolar y Periodos Academicos (`#sec-academic`):**
   - Configuración de fechas de inicio/cierre de trimestres, bimestres o semestres.

---

## 🧑‍💼 5. PANEL DE ASISTENTE (`panel_asistente.html`)

### 5.1 Objetivo y Función
Diseñado para la recepción y coordinación operativa diaria. Maneja la atención presencial, cobros en caja, entrada/salida de alumnos y pedidos de la tienda.

### 5.2 Secciones y Componentes
1. **Kiosco de Ponche & Accesos QR (`#sec-kiosk`):**
   - Escáner de códigos QR de carnets para validar la persona autorizada a retirar al alumno.

2. **Caja Chica y Cobros en Recepción (`#sec-payments`):**
   - Registro de pagos recibidos en efectivo, cheque o tarjeta de crédito en la recepción.

3. **Despacho de Tienda Escolar (`#sec-store-orders`):**
   - Gestión de órdenes de compra de uniformes y materiales, marcado de estado *Entregado* o *Pendiente*.

4. **Inscripciones y Preinscripciones (`#sec-admissions`):**
   - Recepción de solicitudes de nuevas familias y gestión de tours/visitas al centro.

---

## ⚡ 6. INFRAESTRUCTURA DE BASE DE DATOS Y SUPABASE (RPC / DB FUNCTIONS)

El sistema utiliza **Supabase PostgreSQL** equipado con Row Level Security (RLS) y procedimientos almacenados (RPC) para garantizar integridad y rapidez de procesamiento:

1. **`check_payment_cycle_health()`**: Verifica el estado operativo de los cobros recurrentes y alerta sobre inconsistencias en fechas de facturación.
2. **`run_payment_cycle()`**: Función automatizada que corre los días 25 de cada mes para generar los cargos del mes siguiente.
3. **`admin_reset_password(user_id, new_password)`**: Permite la actualización segura de claves administrativas con registro obligatorio en auditoría.
4. **`calculate_student_mora()`**: Aplica el porcentaje o monto fijo de recargo por mora a facturas no saldadas pasadas la fecha límite (día 5).
5. **`get_classroom_schedule(classroom_id)`**: Retorna la cronología y rutina por defecto asociada a cada salón de clases.
6. **`register_door_punch()`**: Almacena de forma inmutable los registros de entrada y salida mediante escáner QR.

---

## 🔔 7. SISTEMA DE NOTIFICACIONES PUSH & WORKERS

1. **Integración con OneSignal Web Push SDK:**
   - Carga diferida (`defer`) con soporte para navegadores de escritorio, Android PWA y dispositivos Apple iOS (`safari_web_id`).
2. **Service Workers:**
   - **`OneSignalSDKWorker.js`** y **`OneSignalSDKUpdaterWorker.js`**: Ubicados en la raíz para recibir alertas en segundo plano incluso con la app cerrada.
3. **Edge Functions Deno (`/supabase/functions/`):**
   - **`send-push`**: Dispara alertas masivas o individuales al móvil del padre al publicar en el muro, enviar un chat o recibir un pago.
   - **`send-email`**: Envía reportes institucionales, facturas en PDF y alertas de seguridad vía SMTP.
   - **`process-event`**: Procesa webhook de pasarelas de pago externas.
   - **`payment-reminders`**: Ejecuta el envío de recordatorios automáticos de cobro.

---

## 🔐 8. ARQUITECTURA PWA Y SEGURIDAD

1. **Service Worker PWA:**
   - Caché de activos estáticos para arranque instantáneo.
   - Manifest oficial (`manifest.json`) configurado para instalación en la pantalla de inicio de teléfonos inteligentes.

2. **Seguridad y Control de Acceso:**
   - Bloqueo inmediato de cuenta vía campo `is_active = false` en la tabla `profiles`.
   - Cierre de sesión automático si un usuario bloqueado intenta navegar.
   - Registro inmutable de acciones críticas en la tabla `audit_logs`.

---
*Este documento sirve como anexo técnico oficial para respaldar la propuesta de servicios, alcance de desarrollo y términos de contratación del ecosistema Karpus Kids.*
