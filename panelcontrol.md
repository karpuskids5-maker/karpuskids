# 🛡️ INFORME TÉCNICO Y PLAN MAESTRO DE REDISEÑO Y REESTRUCTURACIÓN
## PANEL DE CONTROL (CONTROL CENTER) — KARPUS KIDS V5.0

---

### 1. RESUMEN EJECUTIVO Y ANÁLISIS DEL ESTADO ACTUAL

Actualmente, el **Control Center (Panel de Control)** de Karpus Kids presenta deficiencias organizativas, estéticas y ergonómicas que limitan la eficiencia de uso del equipo administrativo y directivo:

1. **Paleta de Colores Básica y Poco Distintiva:** Uso intensivo de tonos de índigo/morado genéricos (`#070c1a`, `#6366f1`) que resultan visualmente fatigantes en jornadas prolongadas y carecen de identidad propia.
2. **Problemas Severos de Desplazamiento (Scroll):** Contenedores de tablas, tarjetas y paneles carecen de propiedades explícitas `overflow-y: auto`, `max-height` o scrollbars sutiles. En pantallas de laptop (1366x768) o tablets, el contenido se corta o fuerza un scroll global no deseado.
3. **Organización Visual Rígida:** Falta de jerarquía clara en tarjetas KPI, filtros apretados sin espaciado respirable, y tablas con exceso de datos horizontales sin indicación de desbordamiento.
4. **Experiencia Móvil Deficiente:** Botones pequeños de acción táctil (< 44px), modales rigidos que no aprovechan la altura de pantalla en smartphones, y falta de barra de acciones inferiores (*Thumb-Zone*).

La presente propuesta establece una **reestructuración integral UI/UX** basada en una paleta de alto impacto (Verde Azulado + Azul Cielo + Amarillo Sol), solución definitiva de scroll en contenedores, navegación fluida en escritorio y experiencia *Mobile-First*.

---

### 2. SISTEMA DE DISEÑO VISUAL Y NUEVA PALETA DE COLORES

Se sustituye la estética actual por un **Sistema de Vidrio Templado Marino & Dorado (Oceanic Dark Glass & Gold)**:

```css
/* ═══════════════════════════════════════════════════════════════════════════
   SISTEMA DE COLORES V5.0 — VERDE AZULADO + AZUL CIELO + AMARILLO SOL
   ═══════════════════════════════════════════════════════════════════════════ */
:root {
  /* Fondos Base (Deep Ocean & Dark Teal) */
  --bg-primary: #061523;          /* Verde azulado abisal profundo */
  --bg-surface-1: #0b2236;        /* Verde azulado contenedor */
  --bg-surface-2: #112d47;        /* Verde azulado elevación media */
  --bg-surface-3: #183859;        /* Verde azulado interactivo */

  /* Bordes y Vidrio (Glassmorphism sutil) */
  --border-subtle: rgba(56, 189, 248, 0.12);
  --border-highlight: rgba(56, 189, 248, 0.35);
  --glass-bg: rgba(11, 34, 54, 0.82);
  --glass-blur: blur(16px) saturate(180%);

  /* Acentos Principales */
  --teal-primary: #0e7490;        /* Verde azulado corporativo */
  --teal-accent: #06b6d4;         /* Verde azulado brillante / Cian */
  --sky-primary: #38bdf8;         /* Azul Cielo (Sky Blue) vibrante */
  --sky-light: #7dd3fc;           /* Azul Cielo claro para textos destacados */
  --sun-yellow: #facc15;          /* Amarillo Sol para resaltados y KPIs */
  --amber-gold: #fbbf24;          /* Amarillo dorado para notificaciones y alertas */

  /* Colores Semánticos de Estado */
  --status-success: #10b981;      /* Esmeralda / Operativo */
  --status-warning: #f59e0b;      /* Ámbar / Alerta */
  --status-danger: #ef4444;       /* Carmesí / Fraude y Errores */
  --status-info: #0ea5e9;         /* Azul brillante / Info */

  /* Tipografía */
  --text-main: #f0f9ff;           /* Blanco azulado de alto contraste (WCAG AAA) */
  --text-subtle: #94a3b8;         /* Gris azulado secundario */
  --text-muted: rgba(240, 249, 255, 0.5);

  /* Sombras y Luces Neón */
  --shadow-card: 0 10px 30px -5px rgba(0, 0, 0, 0.5);
  --glow-sky: 0 0 20px rgba(56, 189, 248, 0.25);
  --glow-yellow: 0 0 20px rgba(250, 204, 21, 0.25);
}
```

---

### 3. SOLUCIÓN INTEGRAL AL PROBLEMA DE SCROLL EN CONTENEDORES

Para erradicar la falta de scroll y el desbordamiento indeseado en pantallas fijas:

1. **Layout Principal Inflexible de Altura (100vh Layout Lock):**
   - Se fija `body { height: 100vh; overflow: hidden; }` y `#main { height: 100vh; display: flex; flex-direction: column; }`.
   - El área `#content` opera con `flex: 1; overflow-y: auto; overflow-x: hidden; scroll-behavior: smooth;`.

2. **Scroll Interno Independiente en Tablas y Tarjetas (Independent Scroll Containers):**
   - Todas las tablas se envuelven en un contenedor `.table-responsive-container` configurado con:
     ```css
     .table-responsive-container {
       max-height: calc(100vh - 320px);
       min-height: 250px;
       overflow-y: auto;
       overflow-x: auto;
       border-radius: 12px;
       scrollbar-width: thin;
       scrollbar-color: var(--sky-primary) var(--bg-surface-2);
     }
     ```
   - Encabezados de tabla pegajosos (`th { position: sticky; top: 0; z-index: 10; background: var(--bg-surface-2); backdrop-filter: blur(8px); }`) para mantener contexto de columnas durante el despliegue.

3. **Scrollbar Estilizada Ultra-Fina de Marca:**
   ```css
   ::-webkit-scrollbar { width: 6px; height: 6px; }
   ::-webkit-scrollbar-track { background: rgba(6, 21, 35, 0.5); }
   ::-webkit-scrollbar-thumb {
     background: linear-gradient(180deg, var(--teal-accent), var(--sky-primary));
     border-radius: 10px;
   }
   ::-webkit-scrollbar-thumb:hover { background: var(--sun-yellow); }
   ```

4. **Indicador Visual de Desbordamiento (*Scroll Affordance Shadows*):**
   - Transiciones de sombra superior e inferior en contenedores que indican al usuario que existe más contenido navegable hacia abajo.

---

### 4. RESTRUCTURACIÓN MÓVIL Y ESCRITORIO (UX & RESPONSIVE DESIGN)

#### 🖥️ Optimización para Escritorio (Monitores 1080p y 4K)
- **Sidebar Dinámico Colapsable:** Modo "solo iconos" (68px de ancho) con expansión al pasar el cursor o botón toggle en topbar, maximizando la superficie de análisis.
- **Grilla Adaptativa KPI de 4 Columnas:** Tarjetas con micro-gráficos (*sparklines*) integrados y efectos de iluminación *Spotlight Hover*.
- **Modo Pantalla Completa y Enfoque:** Atajo universal `Ctrl + K` para búsqueda rápida e iluminación focales de módulos activos.

#### 📱 Experiencia Móvil de Primera Clase (*Mobile-First*)
- **Drawer de Navegación Deslizable:** Desplazamiento mediante gestos (*swipe-to-close*) con capas de desenfoque *backdrop-blur* de alta densidad.
- **Botonera Flotante Inferior (*Thumb-Zone Toolbar*):** Acceso rápido con pulgar a:
  - 🔍 Búsqueda rápida global.
  - 🔄 Recargar datos en vivo.
  - 🚨 Centro de Alertas.
  - 👤 Menú de usuario.
- **Transformación de Tablas a Tarjetas Visuales (Mobile Cards):** En pantallas menores a 640px, las filas de tablas horizontales complejas se convierten automáticamente en tarjetas verticales apilables con distintivos de color.
- **Modales Tipo *Bottom Sheets*:** Modales que se despliegan desde la parte inferior de la pantalla cubriendo el 90% de la altura táctil en iOS y Android.

---

### 5. MEJORAS RESTRUCTURADAS POR SECCIÓN (300 MEJORAS EN TOTAL)

#### 📊 5.1 Dashboard (Panel Principal)
1. KPI de Salud de Pagos con micro-gráficos en amarillo sol.
2. Termómetro de asistencia diaria con barra de progreso fluida.
3. Botonera rápida de rango temporal (Hoy, 7d, Mes, Año) con efecto neón azul cielo.
4. Modo Privacidad (*Blur Money*) para ocultar montos expuestos ante clientes.
5. Tarjetas de contención de alertas de fraude con animación *pulse* roja/amarilla.
6. Comparador interanual de inscripciones en azul cielo.
7. Reloj institucional en tiempo real sincronizado con servidor.
8. Monitor de estado de Edge Functions en verde esmeralda.
9. Accesos directos personalizables por el administrador.
10. Indicador de carga útil de Supabase Storage.
11. Resumen de usuarios activos en vivo (WebSockets).
12. Widget de cumpleaños e hitos del día.
13. Estado de notificaciones push de OneSignal.
14. Termómetro de retención de estudiantes.
15. Resumen de incidentes médicos registrados.
16. Indicador de versión PWA en dispositivos conectados.
17. Capacidad ocupacional por salón de clases.
18. Monitor de salas de videoconferencia activas.
19. Exportador PDF interactivo del cuadro de mando en 1 clic.
20. Indicador de ausentismo docente.
21. Botón de pánico y notificaciones de emergencia escolar.
22. Clima local para salidas al patio.
23. Estado del cronjob de ciclo de pagos.
24. Widget de preinscripciones en espera.
25. Métrica de tareas entregadas por alumnos.

#### 📓 5.2 Auditoría
1. Tabla con scroll interno fijado a un máximo de 500px y encabezados pegajosos.
2. Filtro por rango de fechas preciso (Date Range Picker).
3. Visualizador de payload JSON desplegable en código formateado.
4. Filtro por rol con etiquetas distintivas (Verde Azulado / Azul Cielo / Amarillo).
5. Búsqueda con resaltado de sintaxis (*search highlight*) en tiempo real.
6. Filtro por nivel de severidad (Info, Warning, Critical).
7. Exportador CSV con codificación UTF-8 BOM y separadores configurables.
8. Rastreo de descargas de boletines y documentos sensibles.
9. Geolocalización e inspección de IP de origen.
10. Alertas por borrado masivo de registros (>5 por minuto).
11. Filtro por métodos HTTP/RPC.
12. Paginación flotante (25, 50, 100, 500 filas).
13. Historial auditado por estudiante en modal dedicado.
14. Búsqueda por expresiones regulares (Regex).
15. Registro de cambios de calificaciones.
16. Registro de ediciones en rutina diaria de alimentos/siesta.
17. Marcado manual de registros sospechosos (Flagging).
18. Generador de reporte legal firmado digitalmente.
19. Configuración de retención de logs (30, 90, 365 días).
20. Notas de auditoría entre administradores.
21. Trazabilidad de subida de evidencias y fotos.
22. Log de exoneraciones de mora bancaria.
23. Rastreo de elevación de privilegios de usuario.
24. Vista preliminar de restauración de datos alterados.
25. Indicador visual de IP en lista blanca o negra.

#### 🕵️‍♂️ 5.3 Alertas de Fraude
1. Indicadores de riesgo con semáforo cromático (Verde Azulado = Bajo, Amarillo Sol = Medio, Carmesí = Alto).
2. Tarjetas de reglas de fraude interactivas con filtros de 1 clic.
3. Detección de comprobantes bancarios duplicados por hash MD5.
4. Monitor volumétrico de transacciones (alertas por pagos > RD$50,000).
5. Identificador de múltiples cuentas registradas bajo el mismo teléfono.
6. Registro de modificación manual de estados de pago.
7. Alerta por intentos de acceso fuera del horario escolar (3:00 AM).
8. Scoring dinámico de riesgo acumulado (0 a 100).
9. Mapa térmico (*Heatmap*) de intentos fallidos de autenticación.
10. Detección de cambios de correo masivos en tutores.
11. Integración de contención automática (autobloqueo de cuenta de alto riesgo).
12. Envío de notificación push y e-mail prioritario a la Directora.
13. Consola de resolución de alertas (Aprobar, Descartar, Investigar).
14. Marcador de falsos positivos para entrenamiento del motor.
15. Archivo histórico de alertas resueltas con notas de seguimiento.
16. Alerta por alteración de código de matrícula de alumno.
17. Monitor de clonación de carnets QR.
18. Alertas por cambios en alergias o medicamentos infantiles.
19. Diagnóstico de reputación de IP.
20. Registro de bloqueos RLS en Postgres.
21. Exportador de expedientes de evidencia judicial.
22. Exigencia de re-autenticación 2FA ante riesgo medio.
23. Reordenamiento de tarjetas de alerta por orden de gravedad.
24. Simulador de reglas de fraude contra historial de datos.
25. Asignación de caso a asistente o director específico.

#### 👥 5.4 Usuarios
1. Importación masiva de familias y docentes desde archivos Excel/CSV.
2. Ficha 360° en modal expansivo con pestañas de Pagos, Hijos y Logs.
3. Switch instantáneo para inactivación/bloqueo de acceso.
4. Filtros combinados por Rol, Estado de Cuenta y Salón Asignado.
5. Envíos directos de invitación y credenciales vía WhatsApp Web API.
6. Generador e impresor de carnet digital QR.
7. Asignación multi-tutor para familias con padres divorciados.
8. Indicador visual de instalación PWA en el smartphone del padre.
9. Registro del último acceso físico y digital (Punch vs. Login).
10. Carga rápida de fotos de perfil desde cámara o archivo local.
11. Descarga del directorio escolar en formato Excel enriquecido.
12. Indicador de aceptación de términos y políticas v4.0.
13. Generador de contraseñas temporales seguras de 14 caracteres.
14. Notas privadas de administración en la ficha del usuario.
15. Verificador de sintaxis de correo y formato de teléfono.
16. Estado de token push activo (OneSignal ID).
17. Cronología de ascensos/cambios de rol del usuario.
18. Confirmación manual de e-mail institucional.
19. Filtro por fecha de registro en el sistema.
20. Verificador de permisos de retiro de alumnos firmados.
21. Indicador de saldo moroso directo en la fila del padre.
22. Vista en cuadrícula de tarjetas con fotos de perfil (*Grid View*).
23. Transferencia de tutela de estudiantes entre cuentas.
24. Enlace SSO de integración con Google Workspace.
25. Reenviador de código de verificación en 1 clic.

#### 🖼️ 5.5 Muro Escolar
1. Visor en cuadrícula de galería multimedia con scroll infinito.
2. Lightbox expansivo con soporte para imágenes WebP en alta resolución.
3. Moderación y eliminación rápida de comentarios de padres.
4. Filtro por publicaciones con fotos vs. solo texto.
5. Estadísticas de lectura (Vistas totales por aula).
6. Conteo de reacciones (Me gusta / Corazones) por publicación.
7. Indicador de publicaciones fijadas en la parte superior.
8. Reproductor de video integrado para formatos MP4/WebM.
9. Descarga directa de álbumes fotográficos en ZIP.
10. Filtro por maestra o autor de la publicación.
11. Workflow de aprobación previa de noticias.
12. Desactivación de comentarios en noticias oficiales.
13. Editor de texto enriquecido para nuevas publicaciones.
14. Programación de comunicados con fecha y hora.
15. Etiquetado de alumnos específicos en fotos.
16. Protección de marca de agua con logo Karpus Kids en imágenes.
17. Notificación push masiva personalizada al publicar.
18. Métrica de engagement (interacciones / audiencia total).
19. Adjunto de documentos en formato PDF/Word.
20. Búsqueda por palabras clave en comunicados pasados.
21. Clonación de comunicados para eventos anuales repetitivos.
22. Filtro por nivel (Maternal, Párvulos, Kínder).
23. Control de visibilidad de noticias por tipo de rol.
24. Historial de ediciones registradas en posts.
25. Generador del anuario digital PDF con imágenes del muro.

#### 💬 5.6 Chat & Mensajería
1. Vista de lista de conversaciones con avatars de color azul cielo y verde azulado.
2. Indicador de mensajes sin leer con badges amarillos de alta visibilidad.
3. Filtro de chat por tipo (Directo, Grupal de Aula, Privado Staff).
4. Galería centralizada de fotos y archivos compartidos en conversaciones.
5. Despliegue de hora del último mensaje enviado y enviado/leído status.
6. Filtro de palabras clave sensibles para supervisión institucional.
7. Horario de desconexión nocturna para protección de docentes.
8. Respuestas automáticas fuera de horario laboral.
9. Buscador global de texto en el historial de mensajería.
10. Emisión de comunicados directos masivos.
11. Biblioteca de plantillas de respuesta frecuente.
12. Indicador de doble check azul de lectura.
13. Exportación del historial de conversación en PDF para expedientes.
14. Canal de soporte técnico directo Admin ↔ Familia.
15. Transcripción de audios mediante IA.
16. Traductor automático de mensajes en tiempo real.
17. Bloqueo temporal de chat ante desacuerdos.
18. Fijado de avisos importantes en la parte superior del chat.
19. Clasificación por etiquetas (Urgente, Pago, Consulta, Resuelto).
20. Consola de supervisión multicanal para la Directora.
21. Reenvío por e-mail si el mensaje no se lee en 2 horas.
22. Soporte para envío de ubicación GPS para excursiones.
23. Margen de 10 segundos para deshacer envío (*Undo Send*).
24. Encuestas rápidas integradas en el hilo del chat.
25. Conexión con WhatsApp Business API.

#### 💳 5.7 Pagos
1. Cuadro de mandos con totales aprobados, pendientes y rechazados en amarillo sol.
2. Gráfico de ingresos mensuales en barras con colores de verde azulado a azul cielo.
3. Contenedor de historial de pagos con scroll horizontal y vertical suave.
4. Filtro por banco receptor (BHD, Popular, Banreservas, Scotiabank).
5. Visor de comprobante de pago subido por el padre en Lightbox con zoom.
6. Indicador de mora acumulada y días de retraso.
7. Exoneración de recargos por mora con justificación obligatoria.
8. Notificación automatizada de cobro por WhatsApp y correo.
9. Descarga de recibo oficial de pago en PDF formateado.
10. Conciliación bancaria rápida mediante importación de extractos CSV.
11. Registro manual de ingresos en efectivo en la recepción del centro.
12. Filtro por estudiante o tutor moroso.
13. Dashboard de recaudación por aula de clase.
14. Configuración del motor de mora progresiva.
15. Pasarela de cobro integrada con tarjeta de crédito/débito.
16. Emisión de Comprobantes Fiscales (NCF) validados.
17. Asignador de becas y porcentajes de descuento por hermanos.
18. Suscripción de cobro recurrente a tarjeta.
19. Planes de pago flexibles en cuotas.
20. Manejo de saldo a favor o crédito de tutores.
21. Restricción de servicios secundarios por mora activa.
22. Banner de cobro persistente en el panel del padre moroso.
23. Reversión de pagos con log inmutable de auditoría.
24. Mapeo de cuentas bancarias según tipo de concepto.
25. Exportador contable compatible con QuickBooks y Xero.

#### 📅 5.8 Asistencia
1. Gráfica de asistencia de los últimos 14 días con gradiente en azul cielo.
2. Registro de ponches de hoy con foto, hora de entrada, salida y salón.
3. Kiosco de escaneo rápido de carnet QR.
4. Distintivo de llegada con retardo (*Late check-in*) en amarillo sol.
5. Alertas inmediatas al padre cuando el niño es ingresado al centro.
6. Módulo de justificación de inasistencias con subida de excusa médica.
7. Control de horas laboradas y ponches del personal docente.
8. Registro de salidas anticipadas de alumnos con motivo.
9. Mapa térmico de asistencia por salón de clases.
10. Geolocalización (*Geofencing*) para ponche de maestras.
11. Exportador de registro de asistencia en formato del Ministerio de Educación.
12. Alertas por 3 inasistencias consecutivas sin justificar.
13. Generador de QR dinámico anti-capturas de pantalla.
14. Registro de asistencia offline para excursiones.
15. Expediente anual acumulado del alumno.
16. Registro de visitas y proveedores externos.
17. Control de personas autorizadas para el retiro del niño con foto.
18. Categorización de tardanzas por severidad de minutos.
19. Recordatorio automático a la docente para pasar lista a las 8:30 AM.
20. Control de asistencia a actividades extracurriculares.
21. Conteo de evacuación en tiempo real para emergencias.
22. Filtro por jornada (Matutina, Extendida, Completa).
23. Confirmación cruzada para retiro de niños.
24. Integración con torniquetes y cerraduras magnéticas.
25. Reconocimiento facial opcional.

#### 🐛 5.9 Errores del Sistema
1. Log consolidado de excepciones con pila de ejecución (*Stack Trace*).
2. Botón de limpieza de registros con confirmación de seguridad.
3. Clasificación de errores por origen (Pagos, Rutina, Autenticación, Chat).
4. Indicador del sistema operativo, navegador y resolución del cliente afecto.
5. Filtro de fallas por versión de cliente PWA.
6. Notificación inmediata de fallas críticas a Telegram/Slack.
7. Reintentador automático de peticiones fallidas (*Retry Button*).
8. Agrupador inteligente de excepciones duplicadas.
9. Gráfico de frecuencia temporal de errores en 24h.
10. Asignación de fallas a desarrolladores del equipo.
11. Limpieza programada de logs antiguos (Mantenimiento de 1,000 registros).
12. Exportación de informes de error en formato JSON para depuración local.
13. Captura de pantalla adjunta enviada por el usuario al reportar el problema.
14. Diagnóstico de tiempos de respuesta de la API de Supabase.
15. Filtro por usuario afectado.
16. Conector con servicios de monitoreo Sentry / LogRocket.
17. Métrica de Tiempo Medio entre Fallos (MTBF).
18. Diagnóstico de Edge Functions Deno.
19. Diagnóstico de memoria RAM en dispositivos móviles.
20. Monitoreo de Service Worker y caché PWA.
21. Filtro por nivel de severidad del bug.
22. Correlación entre nuevos despliegues de código y picos de errores.
23. Modo de depuración remota (*Remote Debug*) para cuentas específicas.
24. Conversión de log de error en ticket de trabajo técnico.
25. Botón de prueba de conectividad y salud de API en 1 clic.

#### 🎛️ 5.10 Módulos & Visibilidad (Feature Flags Matrix)
1. Matriz de permisos por Rol y Módulo con interruptores verde/rojo.
2. Control individualizado de *overrides* por usuario específico.
3. Sincronización WebSocket en tiempo real en todos los clientes abiertos.
4. Buscador de usuario con autocompletado para asignación de reglas únicas.
5. Interruptor global maestro (*Emergency Switch*) para pausas del sistema.
6. Programación de activación de módulos por fecha límite.
7. Modo mantenimiento personalizado con mensaje explicativo para el usuario.
8. Plantillas de configuración rápida ("Vacaciones", "Mantenimiento").
9. Historial de cambios realizados en la matriz de visibilidad.
10. Restricción de funciones exclusivas para la app PWA instalada.
11. Backup y restauración de configuración de visibilidad en JSON.
12. Simulador de rol ("Ver panel como Maestra" / "Ver como Padre").
13. Desactivación de submódulos (ej. solo desactivar comentarios en el Muro).
14. Indicador de módulos deprecados.
15. Buscador rápido en la lista de permisos.
16. Control por nivel educativo (ej. Tareas solo para Kínder).
17. Verificación de dependencias entre módulos.
18. Control de calidad de transmisión de videos según ancho de banda.
19. Diferenciación de visibilidad entre Tutor Principal y Secundario.
20. Alertas por reglas contradictorias en el sistema.
21. Control de idioma por módulo.
22. Lanzamiento gradual de funciones (*Rollout* por % de usuarios).
23. Diagnóstico de consumo de recursos por módulo.
24. Bloqueo de matriz mediante contraseña maestra.
25. Botón de restablecimiento de visibilidad a parámetros de fábrica.

#### 🛡️ 5.11 Seguridad & Brute Force
1. Monitor de intentos de acceso fallidos en 24h con alerta de riesgo.
2. Bloqueo automático de IP tras 5 intentos fallidos consecutivos.
3. Integración de Autenticación de Dos Factores (2FA / TOTP).
4. Monitor de salud de base de datos y ciclo de cobros en tiempo real.
5. Cierre de sesión remoto en todas las sesiones activas del usuario.
6. Expiración forzada de sesiones inactivas tras 15 minutos.
7. Gestión de listas blancas y negras de direcciones IP.
8. Verificador de fortaleza de contraseñas de usuarios.
9. Firma criptográfica para boletines y certificaciones oficiales.
10. Escáner e higienizador de entradas contra inyecciones SQL/XSS.
11. Alertas por cambios imprevistos en políticas RLS.
12. Panel de rotación de llaves API de Supabase y OneSignal.
13. Descarga y borrado de expediente para cumplimiento de privacidad.
14. Diagnóstico de certificado SSL/TLS HTTPS.
15. Autenticación rápida vía código OTP SMS.
16. Diagnóstico de ataques a Edge Functions.
17. Visor de encabezados de seguridad HTTP (CSP, CORS, HSTS).
18. Alertas por cambio sospechoso de *User-Agent* en sesión activa.
19. Integración con reCAPTCHA v3 invisible.
20. Protección contra ataques de temporización (*Timing Attacks*).
21. Cifrado de datos médicos y sensibles con `pgcrypto`.
22. Higienización de LocalStorage.
23. Reporte semanal de vulnerabilidades.
24. Certificado digital para el diario escolar.
25. Auditoría de tokens de acceso concedidos a terceros.

#### ⚙️ 5.12 Configuración
1. Editor de perfil de administrador (Nombre, Email, Biografía).
2. Probador integrado de envío de e-mail a través de Edge Functions.
3. Alertas por e-mail automatizadas configurables (Resumen diario de fraude).
4. Ajuste de datos institucionales (Logo, Nombre, Moneda RD$, Teléfono).
5. Gestor de copias de seguridad de la base de datos (Descarga de SQL dump).
6. Ajuste de parámetros del año escolar y periodos de evaluación.
7. Configuración de credenciales de OneSignal y Web Push.
8. Personalización del aviso legal, términos y políticas del centro.
9. Enlace con dominio personalizado (`colegio.edu.do`).
10. Configuración del servidor SMTP emisor.
11. Ajuste de tolerancias de horarios de entrada y tardanzas.
12. Configuración de cuentas bancarias receptoras de transferencias.
13. Ajustes de compresión de imágenes WebP (0.5 a 0.95).
14. Gestor de firma digital de la Directora para certificados PDF.
15. Asistente paso a paso para apertura del nuevo año escolar.
16. Configuración de límites de capacidad de niños por salón.
17. Personalización de la pantalla de mantenimiento.
18. Integraciones mediante Webhooks externos.
19. Configuración del manifest PWA (Theme Color, Splash Screen).
20. Motor de ajuste de escalas de calificación (A-B-C-D o 0-100).
21. Conexión con almacenamiento externo AWS S3 / Google Cloud.
22. Localización de zona horaria (`America/Santo_Domingo`).
23. Estado de suscripción SaaS Karpus Kids.
24. Enlaces a redes sociales oficiales del colegio.
25. Reinicio del panel de control a valores predeterminados.

---

### 6. PLAN DE ACCIÓN Y CONCLUSIÓN

La implementación de este rediseño resolverá de forma definitiva:
1. **El aspecto visual básico:** transformándolo en un panel ejecutivo de alta tecnología en verde azulado, azul cielo y amarillo.
2. **El problema de scroll:** garantizando que cada contenedor de tabla, lista y tarjeta tenga un límite de altura proporcional con scrollbar elegante.
3. **La experiencia móvil:** permitiendo a la administración operar eficientemente desde smartphones y tablets con gestos táctiles y layouts adaptativos.

Este documento sirve como la guía técnica de referencia para el desarrollo e integración de la **Versión 5.0 del Control Center de Karpus Kids**.
