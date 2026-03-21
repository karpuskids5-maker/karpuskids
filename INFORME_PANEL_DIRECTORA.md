# Informe de Funcionamiento y Flujo: Panel de la Directora — Karpus Kids

Este informe describe cómo opera cada sección de la plataforma administrativa de Karpus Kids, integrando la base de datos Supabase con las herramientas visuales para un control total de la estancia.

## 1. Centro de Control (Dashboard)
Es la pantalla de bienvenida y el resumen ejecutivo de la operación.
*   **Métricas Críticas (KPIs):** Visualiza de inmediato el número de estudiantes activos, docentes, aulas, y lo más importante: la asistencia del día y el dinero pendiente por cobrar.
*   **Gráficos de Análisis:**
    *   **Tendencia de Asistencia:** Muestra si la asistencia está subiendo o bajando en los últimos 7 días.
    *   **Estado Financiero:** Un gráfico circular que separa lo que ya entró a caja de lo que aún está pendiente de pago en el mes corriente.
*   **Flujo:** La directora usa esta sección para detectar anomalías (ej. muchas incidencias abiertas o baja recaudación) al iniciar su jornada.

## 2. Gestión Académica (Estudiantes y Aulas)
### Sección: Estudiantes
*   **Alta y Edición:** Permite registrar alumnos con su foto, historial médico (alergias, sangre) y datos de los padres.
*   **Validación de Correo:** Al registrar al padre, el sistema verifica si ya tiene cuenta para evitar duplicados y centralizar la información familiar.
*   **Ficha de Perfil:** Un modal detallado donde puedes ver quién está autorizado para recoger al niño y sus contactos de emergencia.

### Sección: Aulas
*   **Organización:** Permite crear grupos (Pequeños, Medianos, Grandes, etc.), asignarles un docente titular y definir una capacidad máxima.
*   **Semáforo de Cupos:** El sistema indica visualmente qué aulas están llenas y cuáles tienen espacio disponible para nuevos ingresos.

### Sección: Asistencia
*   **Auditoría de Entrada:** Filtro por fecha para revisar la puntualidad. Al hacer clic en un aula, se despliega la lista de alumnos con su estado (Presente/Ausente/Tardanza) y la hora exacta del registro.

## 3. Gestión de Personal (Maestros y Asistentes)
*   **Control de Staff:** Creación y gestión de perfiles para Docentes y Asistentes.
*   **Seguridad:** La directora puede resetear contraseñas y actualizar datos de contacto del personal desde este módulo.

## 4. Gestión Financiera y Cobranza (Pagos)
Este es el módulo más robusto, diseñado para maximizar la recaudación y minimizar el trabajo manual.
*   **Generación de Cuotas:** Un proceso masivo que "factura" a todos los niños activos al inicio del mes con un solo clic.
*   **Revisión de Transferencias con IA (OCR):**
    *   **Proceso:** El padre sube una foto de su comprobante. El sistema usa **OCR** para "leer" el texto de la imagen y detectar automáticamente el monto depositado.
    *   **Validación:** La directora confirma que el monto detectado coincida con lo reportado y aprueba el pago.
*   **Comprobantes Digitales:** Al aprobar, se genera un **Recibo en PDF** automático.
*   **Recordatorios de Pago:** Herramienta para enviar notificaciones Push y correos electrónicos a padres morosos de forma individual o grupal.

## 5. Comunicación y Comunidad
### Chat Profesional (Estilo Teams)
*   **Mensajería Realtime:** Chat privado con padres y personal.
*   **Filtros Inteligentes:** Puedes buscar contactos por el nombre del estudiante relacionado.
*   **Notificaciones:** Alertas inmediatas para asegurar que ningún mensaje quede sin responder.

### Muro Escolar Unificado
*   **Supervisión Pedagógica:** La directora puede ver todas las fotos y actividades que las maestras publican en sus grupos.
*   **Moderación:** Capacidad de gestionar comentarios para asegurar que la comunidad digital de la estancia sea segura y profesional.

## 6. Sistema de Incidencias (Reportes)
*   **Gestión de Tickets:** Centraliza quejas, sugerencias o reportes de salud enviados por los padres.
*   **Flujo de Resolución:** Cada caso tiene un seguimiento de estado (*Recibido -> En Revisión -> En Proceso -> Resuelto*), lo que garantiza que ningún padre se quede sin respuesta.

## 7. Herramientas Especiales de Dirección
*   **Videollamada:** Acceso directo a una sala de conferencias para juntas con padres o staff.
*   **Resumen Semanal:** Herramienta para enviar un boletín con las mejores fotos de la semana a todas las familias con un clic (fomenta la fidelidad de los padres).
*   **Reportes PDF:** Generación de informes financieros mensuales para administración.

---

### Resumen del Flujo de Operación Correcto:
1.  **Ciclo Mensual:** Inicia con la **Generación de Cuotas** en Pagos.
2.  **Operación Diaria:** Monitoreo de **Asistencia** y validación de **Transferencias** (OCR).
3.  **Atención Directa:** Gestión de **Incidencias** y respuesta de **Chats**.
4.  **Cierre Semanal:** Envío del **Resumen Semanal** con fotos para mantener felices a las familias.
