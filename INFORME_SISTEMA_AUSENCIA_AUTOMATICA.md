# 📊 INFORME TÉCNICO Y OPERATIVO: SISTEMA DE AUSENCIA AUTOMÁTICA Y SINCRONIZACIÓN DE CALENDARIO DE LA ESTANCIA

**Fecha de emisión:** Marzo 2026
**Plataforma:** Karpus Kids — Centro Educativo de Estancia Infantil
**Módulos Afectados:** Shared (`js/shared/absent-service.js`), Panel de Padres (`panel_padres.html`, `js/padre/attendance.js`), Panel de Directora (`panel_directora.html`, `js/directora/attendance.module.js`)

---

## 📌 RESUMEN EJECUTIVO DE LAS MEJORAS INCORPORADAS

Se ha completado la actualización integral del **Sistema de Ausencia Automática y Control de Asistencia** en Karpus Kids. Esta versión introduce comunicación visual directa en el Panel de Padres mediante banners dinámicos, distinción por color en el calendario mensual (**Azul para Ausencias Notificadas por el Padre** vs **Rojo para Ausencias No Notificadas / Automáticas**), auditabilidad detallada para la Directora, y sincronización estricta con la hora oficial de la República Dominicana, los días laborables y el calendario escolar.

---

## 🎯 1. MEJORAS PRINCIPALES IMPLEMENTADAS EN LA INTERFAZ Y LÓGICA

### A. Banner Informativo para Padres sobre Ausencias de Hoy (`todayAbsenceBannerContainer`)
* **Ubicación:** Encabezado superior de la sección de Asistencia en el Panel de Padres (`panel_padres.html`).
* **Comportamiento Dinámico:**
  1. **Si el padre envió aviso previamente:** Muestra un banner destacado en **color azul** con la fecha, el motivo reportado (ej. *"Consulta médica — Doctora Pérez a las 10:00 AM"*), e indica que la estancia ya fue notificada. Ofrece la opción de *"Editar / Justificar"*.
  2. **Si el estudiante fue marcado por Ausencia Automática:** Muestra un banner de alerta en **color rojo** informando que el estudiante figura como ausente al haber superado la hora límite de entrada sin haber registrado entrada. Incluye botón *"Enviar Justificación"* para adjuntar el motivo de inmediato.

### B. Calendario Mensual del Padre con Distinción por Colores
* **Azul (`bg-blue-500 text-white shadow-lg shadow-blue-100`):** Representa días con **Ausencia Notificada por el Padre** (`attendance_requests` registrado o `absence_reason` con aviso).
* **Rojo (`bg-rose-500 text-white shadow-lg shadow-rose-100`):** Representa días con **Ausencia Injustificada / Automática** (estudiante no registrado en la puerta ni justificado).
* **Verde (`bg-green-500`):** Presente.
* **Amarillo / Ámbar (`bg-amber-500`):** Tardanza.
* **Leyenda Actualizada:** Se incorporó en la interfaz del panel la etiqueta oficial `"Notificado por Padre"` en color azul para guía de las familias.

### C. Sección de Asistencia de la Directora (`AttendanceModule` en Directora)
* **Auditoría de Motivos:** En la tabla diaria y por rango, la Directora visualiza la razón exacta de cada ausencia.
* **Etiquetas Distintivas:**
  * `<span class="bg-blue-100 text-blue-700">Notificado por Padre</span>` con icono de documento.
  * `<span class="bg-rose-100 text-rose-700">Ausencia Automática</span>` con icono de reloj.
* **Detalle de la nota:** Muestra el texto exacto enviado por el padre desde el formulario o el aviso del sistema (`"Ausencia Automática — Excedió hora límite de entrada"`).

---

## 🚀 2. LAS 10 MEJORAS CLAVE DEL SISTEMA DE AUSENCIA AUTOMÁTICA

Below is the detailed list of the 10 major technical and functional enhancements applied to ensure state-of-the-art accuracy, synchronization, and compliance:

### 1. Sincronización Estricta con la Zona Horaria Oficial (República Dominicana `America/Santo_Domingo`)
* **Implementación:** Tanto la función SQL en PostgreSQL/Supabase (`mark_absent_students()`) como el ejecutor fallback en JavaScript cliente (`nowDRInfo()`) operan mediante `Intl.DateTimeFormat` configurado expresamente en `'America/Santo_Domingo'`.
* **Beneficio:** Elimina errores de timezone derivados del dispositivo del cliente o del servidor de la nube (evita falsos ausentes por desfase UTC/GMT).

### 2. Validación de Calendario de Trabajo Escolar (`work_days` + Días Laborables)
* **Implementación:** El motor consulta dinámicamente `school_settings.work_days` (ej. `["Lun", "Mar", "Mie", "Jue", "Vie"]`).
* **Beneficio:** Impide la ejecución de ausencias automáticas durante fines de semana (Sábados y Domingos) o días feriados configurados en el sistema escolar.

### 3. Ventana Dinámica de Tolerancia y Cierre de Entrada (`check_in_end` / `open_time`)
* **Implementación:** El umbral de ausencia se calcula sumando 120 minutos (2 horas) al límite de entrada configurado en la estancia (`check_in_end` o fallback a `open_time`).
* **Beneficio:** Si la estancia define el cierre de entrada a las 8:30 AM, el sistema evalúa y marca ausencias automáticamente a partir de las 10:30 AM, dando margen para ingresos tardíos o aprobaciones en puerta.

### 4. Arquitectura Híbrida Duplicada (RPC Server-Side + Fallback JS Cliente)
* **Implementación:** El servicio compartido `autoMarkAbsentStudents()` ejecuta en primer lugar la función SQL almacenada RPC. Si la BD responde con error o migración pendiente, conmuta de forma transparente al motor cliente `jsMarkAbsentFallback()`.
* **Beneficio:** Disponibilidad del 100% sin importar la conectividad de la base de datos o migraciones pendientes.

### 5. Notificación Push en Tiempo Real a Maestra, Directora y Asistente
* **Implementación:** Cuando un padre envía un aviso de ausencia desde el formulario, se invoca `sendPush()` notificando a la maestra asignada al aula y al personal administrativo/directiva.
* **Beneficio:** La maestra sabe con antelación por qué un alumno no estará en el aula y puede reorganizar las meriendas o actividades del día.

### 6. Mapeo Inteligente de Motivo y Pre-Poblado de `absence_reason`
* **Implementación:** Si el estudiante tenía una solicitud previa en `attendance_requests` (`status in ('pending', 'approved')`), el sistema hereda automáticamente esa justificación e inserta el registro en la tabla `attendance` preservando la nota del padre.
* **Beneficio:** No sobrescribe el motivo del padre con el mensaje genérico de ausencia automática.

### 7. Idempotencia Guard y Bloqueo de Conflictos (`UNIQUE(student_id, date)`)
* **Implementación:** Las operaciones se ejecutan mediante `upsert` filtrando únicamente registros cuyo estado no sea final (`FINAL_STATUSES = ['present', 'presente', 'late', 'tarde', 'retirado', 'absent', 'ausente']`).
* **Beneficio:** Jamás sobreescribe a un estudiante que ya fue ponchado como *"Presente"* o *"Tardanza"*.

### 8. Integración Realtime con Supabase Subscriptions
* **Implementación:** La vista de asistencia en el Panel de Directora (`dir_attendance_live`) escucha cambios en la tabla `attendance` e incrementa/actualiza los KPIs y la tabla en vivo.
* **Beneficio:** Si el bot o la maestra marca una ausencia, la pantalla de la Directora se actualiza de inmediato sin necesidad de recargar la página.

### 9. Agrupación por Estudiante en Modo Rango y Cálculo de Tasa de Asistencia
* **Implementación:** La Directora puede filtrar por día o por rango de fechas (ej. mes actual) y ver el acumulado de días presentes, tardanzas y ausencias clasificadas (Padre vs Automáticas).
* **Beneficio:** Identifica patrones de inasistencia o ausentismo reiterado para tomar medidas tempranas con la familia.

### 10. Trazabilidad Completa y Exportación de Datos en CSV
* **Implementación:** La Directora dispone del botón de exportación CSV que incluye la columna de `absence_reason` con las respuestas de los padres e identificadores del sistema.
* **Beneficio:** Facilita la generación de reportes oficiales para el distrito educativo o archivo institucional.

---

## 📅 3. FLUJO DE TRABAJO RESUMIDO

```
[ Padre envía Aviso de Ausencia ]
       │
       ▼
[ Se inserta en 'attendance_requests' con status 'pending' ]
       │
       ▼
[ Notificación Push inmediata a Maestra/Directora ]
       │
       ▼
[ Pasa la hora límite (check_in_end + 2h) en Hora RD ]
       │
       ▼
[ Ejecución de 'autoMarkAbsentStudents()' ]
       │
  ┌────┴─────────────────────────────┐
  │ ¿Tenía aviso del padre?          │
  ├──────────────────┬───────────────┤
  │ SÍ               │ NO            │
  ▼                  ▼               ▼
[ Inserta en 'attendance' ]      [ Inserta en 'attendance' ]
  status: 'absent'                 status: 'absent'
  absence_reason: 'Motivo Padre'   absence_reason: 'Ausencia Automática'
       │                                │
       ▼                                ▼
[ Calendario Padre: AZUL 🟦 ]      [ Calendario Padre: ROJO 🟥 ]
[ Banner Padre: AZUL ℹ️ ]          [ Banner Padre: ROJO ⚠️ ]
[ Tabla Directora: Azul ]         [ Tabla Directora: Rojo ]
```

---

## ✅ CONCLUSION

Con estas mejoras, el sistema de ausencias de Karpus Kids ofrece la mejor experiencia de usuario posible:
1. **Padres:** Saben en todo momento la razón registrada y pueden consultar de un vistazo su calendario interactivo con código de colores claro.
2. **Directora:** Mantiene un control absoluto con visibilidad de motivos, notificaciones en tiempo real y estadísticas precisas.
3. **Estancia:** Automatiza el seguimiento diario respetando los horarios oficiales y festivos de la República Dominicana.
