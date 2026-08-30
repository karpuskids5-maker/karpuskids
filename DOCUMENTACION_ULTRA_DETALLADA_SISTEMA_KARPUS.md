# 📘 DOCUMENTACIÓN TÉCNICA Y ARQUITECTURA ULTRA DETALLADA — SISTEMA KARPUS KIDS
**Especificación Maestra para la Elaboración de Contratos Comerciales, Manuales Operativos y Auditorías Técnicas**

---

## 📄 1. RESUMEN EJECUTIVO Y ARQUITECTURA GENERAL

**Karpus Kids** es una suite de software de gestión integral y comunicación en tiempo real diseñada exclusivamente para centros de educación preescolar, estancias infantiles y colegios de primera infancia. La plataforma combina la potencia de una aplicación web progresiva (**PWA**) instalable en dispositivos móviles (iOS y Android) con una infraestructura backend Serverless construida sobre **Supabase (PostgreSQL 15)**, **Edge Functions Deno** y el motor de notificaciones push **OneSignal**.

El ecosistema está estructurado en **Una (1) Landing Page Pública Comercial (`index.html`)** y **Cuatro (4) Paneles Operativos Especializados**:

```
                                  ┌──────────────────────────┐
                                  │   index.html             │
                                  │   Landing Page Comercial │
                                  └────────────┬─────────────┘
                                               │
                                       ┌───────┴───────┐
                                       │  login.html   │
                                       │  Autenticación│
                                       └───────┬───────┘
                                               │
               ┌───────────────────────┬───────┴───────────────┬───────────────────────┐
               ▼                       ▼                       ▼                       ▼
     ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
     │ panel_padres.html│    │panel-maestra.html│    │panel_directora.h │    │panel_asistente.h │
     │ Panel de Padres  │    │ Panel de Maestra │    │ Panel Directora  │    │ Panel Asistente  │
     └──────────────────┘    └──────────────────┘    └──────────────────┘    └──────────────────┘
```

---

## 🌐 2. DESGLOSE DETALLADO: LANDING PAGE INSTITUCIONAL (`index.html`)

### 2.1 Objetivo y Filosofía de Diseño
La Landing Page es el portal de atracción comercial y prospección de clientes. Diseñada sin dependencias de frameworks pesados (Pure HTML5, CSS3 vanilla, Tailwind CSS compilado y Vanilla JS), garantiza un tiempo de carga inferior a **1.2 segundos** y puntuaciones de **95+ en Google Lighthouse**.

### 2.2 Componentes y Estructura Sección por Sección

1. **Cabecera Institucional Fija (`.site-header`):**
   - **Logotipo Corporativo:** Renderizado dinámico con la clase `.karpus-kids-colored` que aplica colores institucionales (Naranja #FF9800, Azul #2196F3, Rosa #E91E63, Verde #4CAF50, Púrpura #9C27B0, Violeta #7C3AED).
   - **Barra de Navegación Fija:** Enlaces de desplazamiento suave (*smooth scroll*) hacia `#inicio`, `#nosotros`, `#programas`, `#servicios`, `#instalaciones`, `#testimonios` y `#contacto`.
   - **Efecto de Desplazamiento (`.scrolled`):** Transición automática al hacer scroll (>40px) de un fondo transparente a un fondo blanco translúcido (`rgba(255,255,255,0.97)`) con desenfoque de fondo (*backdrop-blur*).
   - **Botón Acceso App (`login.html`):** Acceso directo para usuarios registrados.
   - **Menú Móvil Desplegable (`#mobMenu`):** Configurado con `top: 70px`, `max-height: calc(100vh - 70px)` y `overflow-y: auto`, garantizando accesibilidad total en pantallas de formato vertical.

2. **Sección Hero Impacto (`#inicio`):**
   - **Video de Fondo Interactivo (`.video-bg`):** Archivo `img/14.mp4` con reproducción automática, bucle y silenciado, usando `img/karpus.jpg` como imagen de póster de respaldo.
   - **Capa de Superposición (*Overlay*):** Gradiente oscuro con opacidad calibrada para garantizar contraste de lectura WCAG AAA.
   - **Call-To-Action Dual:** Botón primario para **"Agendar una Visita Presencial"** y botón secundario para **"Contactar por WhatsApp"**.

3. **Sobre Nosotros / Filosofía Pedagógica (`#nosotros`):**
   - **Efecto Reveal (`obs-fade`):** Animación basada en `IntersectionObserver` que activa la visibilidad del contenido cuando el usuario entra en la sección.
   - **Tarjetas de Valores:** Desarrollo emocional, estimulación sensorial, nutrición balanceada y aprendizaje basado en el juego.

4. **Programas por Nivel Educativo (`#programas`):**
   - **Maternal / Lactantes (3 a 12 meses):** Cuidado asistido, registro de siestas e hitos madurativos.
   - **Párvulos (1 a 2 años):** Desarrollo del lenguaje, motricidad fina y socialización.
   - **Pre-Kínder (2 a 3 años):** Razonamiento lógico temprano, expresión artística y autonomía.
   - **Kínder (3 a 5 años):** Lectoescritura inicial, lógica matemática y bilingüismo.

5. **Servicios & Diferenciadores Tecnológicos (`#servicios`):**
   - **Mochila Digital:** Seguimiento de tareas e hitos sin uso de papel.
   - **Monitoreo de Salud & Menú:** Control diario de alimentos y alergias.
   - **Cámaras en Vivo / Eventos:** Acceso supervisado para padres.
   - **Notificaciones Push:** Avisos instantáneos al móvil.

6. **Galería de Instalaciones (`#instalaciones`):**
   - Rejilla responsiva con imágenes de alta definición de aulas, patios, cunas y comedor escolar.
   - Visor Lightbox (`#lb`) a pantalla completa con navegación entre fotografías.

7. **Testimonios de Familias (`#testimonios`):**
   - Tarjetas de opinión de padres activos con estrellas de calificación y fotos de perfil.

8. **Pie de Página & Información Legal (`footer`):**
   - Datos de contacto directo, teléfono directo `18298038484` (`+1 (829) 803-8484`).
   - Botón flotante de WhatsApp (`.btn-whatsapp`).
   - Enlaces a Política de Privacidad (`politica-privacidad.html`) y Términos de Uso (`terminos-uso.html`).

---

## 👨‍👩‍👧 3. PANEL DE PADRES (`panel_padres.html`)

### 3.1 Objetivo y Arquitectura Técnica
Modulo modularizado en `js/padre/` que permite a los tutores estar informados de todo lo relacionado con sus hijos. Administra el estado global mediante `appState.js` y expone 9 módulos clave.

```
js/padre/
├── api.js            # Consultas a Supabase
├── appState.js       # Estado reactivo del estudiante activo
├── attendance.js     # Asistencia y Carnet QR
├── chat.js           # Mensajería instantánea
├── feed.js           # Muro interactivo
├── grades.js         # Boletines académicos
├── payments.js       # Cuentas por cobrar y recibos
├── profile.js        # Datos familiares y emergencias
├── routine.js        # Bitácora diaria (alimentos, siesta, esfínter)
├── store.js          # Tienda de uniformes y servicios
└── tasks.js          # Tareas y evidencias
```

### 3.2 Desglose de Secciones y Componentes

1. **Pantalla Principal / Dashboard (`#sec-home`):**
   - **Selector de Estudiante Activo:** Permite alternar la vista entre hermanos sin cerrar sesión.
   - **Tarjeta Resumen del Día (*Daily Status Card*):** Muestra de forma visual el porcentaje de alimentos ingeridos, minutos de siesta, cambios de pañal/esfínter y estado de ánimo.
   - **Alertas Pendientes:** Banner persistente en rojo si el padre registra facturas vencidas o morosidad activa.

2. **Muro Escolar / Feed (`#sec-feed`):**
   - **Publicaciones del Aula:** Stream con comunicados, fotos y videos cortos de las maestras.
   - **Sistema de Reacciones & Comentarios:** Permite dar "Me gusta" e interactuar en las publicaciones con moderación.
   - **Visor Multimedia:** Reproductor de video de alta eficiencia con límite de reproducción y lightbox.

3. **Bitácora y Rutina Diaria (`#sec-routine`):**
   - **Línea de Tiempo (*Timeline*):** Cronograma hora por hora registrado por la docente.
   - **Detalle de Medicamentos:** Confirmación de dosis administradas por el personal médico o la docente.

4. **Chat & Mensajería Directa (`#sec-chat`):**
   - **Canal Directo Maestro-Padre:** Conversación privada en tiempo real con confirmación de lectura (*double check*).
   - **Audio y Adjuntos:** Soporte para notas de voz y fotos de justificativos.

5. **Asistencia y Carnet Digital (`#sec-attendance`):**
   - **Historial de Ponches:** Registro exacto de hora de entrada y hora de salida.
   - **Carnet Digital con QR Dinámico:** Generación de código QR único e infalsificable para presentar en recepción al retirar al estudiante.

6. **Tareas y Evidencias (`#sec-tasks`):**
   - Lista de deberes asignados con fecha de entrega.
   - Formulario de subida de fotos de tareas completadas por el estudiante.

7. **Calificaciones y Boletín (`#sec-grades`):**
   - Visualización de la libreta académica por periodos (Trimestres/Bimestres).
   - Indicadores cualitativos de desarrollo (A logrado, B en proceso, C requiere apoyo).

8. **Estado Financiero y Pagos (`#sec-payments`):**
   - **Balance General:** Desglose de colegiatura mensual, reinscripción, materiales y mora.
   - **Cargador de Comprobantes:** Formulario para adjuntar foto o PDF de la transferencia bancaria (BHD, Popular, Banreservas, Scotiabank).
   - **Descarga de Recibos:** Emisión automática de recibo digital tras aprobación de la administración.

9. **Tienda Escolar (`#sec-store`):**
   - Catálogo de uniformes, libros, mochilas y excursiones.
   - Carrito de compras y pasarela de pedido con aprobación administrativa.

10. **Programa de Embajadores / Referidos (`#sec-referrals`):**
    - Módulo de recomendación para compartir código único de referido y obtener descuentos en cuotas mensuales.

---

## 👩‍🏫 4. PANEL DE MAESTRA (`panel-maestra.html`)

### 4.1 Objetivo y Arquitectura Técnica
Herramienta operativa diseñada para uso en movimiento (*Mobile-First*) modularizada en `js/maestra/`. Optimiza el tiempo en el aula automatizando la toma de asistencia y el llenado de rutinas.

### 4.2 Desglose de Secciones y Componentes

1. **Pase de Lista / Asistencia del Aula (`#sec-attendance`):**
   - **Cuadrícula de Estudiantes:** Tarjetas táctiles con foto del niño para marcar *Presente* (verde), *Ausente* (rojo), *Tardanza* (amarillo) o *Excusa* (azul).
   - **Notificación Automática:** Al guardar la lista, se dispara un evento que notifica a los padres.

2. **Registro de Rutina Diaria (`#sec-routine`):**
   - **Generador de Eventos en Lote:** Carga simultánea de siesta o alimentos para todo el salón o ajuste individual.
   - **Mapeo de Alimentos:** Selección visual de consumo (100%, 75%, 50%, 25%, Nada).
   - **Control de Medicamentos:** Módulo especial para marcar la hora exacta en que se administró una medicina autorizada por el padre.

3. **Muro Escolar / Comunicados (`#sec-feed`):**
   - **Publicador de Actividades:** Permite a la maestra tomar fotos o grabar videos desde la tablet/móvil y publicarlos para los padres del aula.
   - **Etiquetado de Alumnos:** Notificar a familias específicas al etiquetar a sus hijos en una foto.

4. **Asignación de Tareas (`#sec-tasks`):**
   - Creador de deberes escolares con fecha límite y descripción de materiales necesarios.
   - Revisión y retroalimentación de tareas enviadas por los alumnos.

5. **Libreta de Calificaciones (`#sec-grades`):**
   - Matriz de evaluación para ingresar calificaciones por asignatura o dimensión madurativa.

6. **Chat Oficial con Familias (`#sec-chat`):**
   - Consola de mensajes con los padres de su salón con restricción de horarios de descanso para evitar mensajes nocturnos.

---

## 🏫 5. PANEL DE DIRECTORA (`panel_directora.html`)

### 5.1 Objetivo y Arquitectura Técnica
Centro de comando administrativo y ejecutivo. Maneja la visión global del colegio, auditoría de ingresos, control de mora y configuración del año escolar.

### 5.2 Desglose de Secciones y Componentes

1. **Executive Dashboard (`#sec-dashboard`):**
   - **KPIs de Alto Nivel:** Matrícula total activa, porcentaje de asistencia diaria, proyección de ingresos vs. cobrado real, total de mora activa.
   - **Graficador interactivo:** Tendencia de cobros y retención escolar mediante Chart.js.

2. **Gestión Financiera & Cierre de Cobros (`#sec-payments`):**
   - **Consola de Validación de Pagos (`js/directora/payments_clean.js`):** Interfaz para auditar transferencias recibidas, verificar la foto del volante bancario y presionar *Aprobar* o *Rechazar*.
   - **Calculadora de Mora:** Algoritmo de cálculo de recargos automático a partir del día 6 de cada mes.
   - **Exoneración de Mora:** Módulo para condonar recargos con justificación administrativa obligatoria.
   - **Descuentos y Becas:** Configuración de % de beca por rendimiento o descuento por múltiples hermanos.

3. **Expediente 360° de Estudiantes (`#sec-students`):**
   - Padrón general de alumnos, asignación de aula, tutores vinculados, historial médico y estatus de pago.

4. **Administración de Personal & Maestras (`#sec-teachers`):**
   - Registro de personal docente, horarios de ponche de entrada, evaluación de desempeño y asignación de aulas.

5. **Aprobación de Contenidos del Muro (`#sec-feed-approval`):**
   - Módulo de moderación opcional para revisar publicaciones de las maestras antes de salir a la app de los padres.

6. **Año Escolar y Periodos Académicos (`#sec-academic`):**
   - Apertura y cierre de periodos lectivos, configuración de bimestres/trimestres y promoción de grado.

---

## 🧑‍💼 6. PANEL DE ASISTENTE (`panel_asistente.html`)

### 6.1 Objetivo y Arquitectura Técnica
Diseñado para la recepción y coordinación operativa diaria. Modularizado en `js/asistente/` para una ejecución ágil en caja y puerta de acceso.

### 6.2 Desglose de Secciones y Componentes

1. **Kiosco de Accesos QR (`#sec-kiosk`):**
   - Pantalla de escaneo rápido de carnets digitales para registrar ponches de entrada (8:00 AM) y salida (4:00 PM).
   - Alerta visual y sonora si la persona que retira no está en la lista de tutores autorizados.

2. **Caja Chica y Recepción de Pagos (`#sec-payments`):**
   - Registro de cobros presenciales en efectivo, tarjeta de crédito o cheque con impresión inmediata de comprobante.

3. **Gestión de la Tienda Escolar (`#sec-store-orders`):**
   - Recepción de pedidos realizados desde la app del padre, armado de paquetes de uniformes y marcado de entregas.

4. **Admisiones y Preinscripciones (`#sec-admissions`):**
   - Registro de nuevas familias interesadas, agendamiento de recorridos por el colegio y seguimiento de prospección.

---

## ⚡ 7. INFRAESTRUCTURA DE BASE DE DATOS Y PROCEDIMIENTOS ALMACENADOS (RPC)

El sistema opera sobre **Supabase PostgreSQL 15** utilizando Row Level Security (RLS) y procedimientos almacenados para máxima seguridad y rendimiento:

```sql
-- Principales Procedimientos Almacenados (RPCs)
1. check_payment_cycle_health()
   - Monitorea la salud del ciclo de cobros y valida consistencia de fechas.

2. run_payment_cycle()
   - Genera automáticamente las facturas del siguiente mes los días 25 de cada mes.

3. admin_reset_password(user_id, new_password)
   - Permite la actualización de credenciales con registro obligatorio en audit_logs.

4. calculate_student_mora()
   - Aplica recargos por mora progresiva a cuentas no saldadas después del día 5.

5. get_classroom_schedule(classroom_id)
   - Retorna el calendario y cronograma de rutina por defecto del aula.

6. register_door_punch(student_id, tutor_id, type)
   - Almacena inmutablemente los ponches de entrada y salida mediante QR.
```

---

## 🔔 8. ARQUITECTURA DE NOTIFICACIONES PUSH & WORKERS

1. **OneSignal Push Notifications:**
   - Enlace oficial mediante `safari_web_id: "web.onesignal.auto.63402434-7a0e-473d-9d21-f095166311e9"`.
   - Archivos de service worker en la raíz: `OneSignalSDKWorker.js` y `OneSignalSDKUpdaterWorker.js`.

2. **Edge Functions Deno (`/supabase/functions/`):**
   - **`send-push`**: Envío instantáneo de notificaciones push a móviles Android e iOS.
   - **`send-email`**: Envío de reportes institucionales, estados de cuenta y facturas PDF vía SMTP.
   - **`process-event`**: Procesamiento de Webhooks de pasarelas de pago.
   - **`payment-reminders`**: Tarea programada para enviar recordatorios de cobro los días 3 y 5 de cada mes.

---

## 🔐 9. SEGURIDAD Y CUMPLIMIENTO REGULATORIO

1. **Políticas de Privacidad y Términos:**
   - Cumplimiento de leyes de protección de datos de menores (`politica-privacidad.html` y `terminos-uso.html`).
2. **Control de Accesos:**
   - Desconexión e inactivación inmediata mediante el atributo `is_active = false` en la tabla `profiles`.
3. **Auditoría Inmutable:**
   - La tabla `audit_logs` registra cada inicio de sesión, cambio de rol, aprobación de pago y modificación de calificación con dirección IP y User-Agent.

---
*Este documento constituye la memoria técnica descriptiva oficial del software Karpus Kids para respaldar contratos de licencia SaaS, acuerdos de nivel de servicio (SLA) y auditorías tecnológicas.*
