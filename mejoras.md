
# INFORME TÉCNICO Y ARQUITECTURA DEL MÓDULO DE CONTROL ESCOLAR Y SUPERVISIÓN
**Paneles de Directora y Asistente de Dirección**
**Colegio karpus kids**
**Fecha:** 2025

---

## 1. RESUMEN EJECUTIVO Y PROPÓSITO DEL MÓDULO

El módulo de **Control Escolar** (denominado en la interfaz como **Centro de Gestión Escolar** / `SchoolCenterModule`, ubicado en `#sec-centro-escolar` dentro de `panel_directora.html` y `panel_asistente.html`) constituye la consola centralizada de inteligencia pedagógica, estructura organizacional, monitoreo operativo en tiempo real e intervención de aulas para el equipo directivo.

Este módulo elimina la desconexión entre la gestión administrativa y la dinámica diaria de las aulas, proporcionando a la **Directora** y a la **Asistente de Dirección** herramientas avanzadas para:
1. **Visualizar el Organigrama Operativo:** Árbol interactivo de la estancia infantil y colegio por niveles educativos, capacidades, ratios niño-docente y docentes a cargo.
2. **Monitorear en Tiempo Real:** Salud operacional del centro mediante un semáforo dinámico, control de toma de asistencia, estado de cumplimiento de rutinas (alimentación, sueño, esfínteres) y alertas de incidentes.
3. **Intervenir Aulas mediante el Motor de Supervisión (`SupervisionEngine`):** Capacidad de "entrar" virtual o físicamente al contexto de un aula, aplicar un banner persistente de supervisión activa, registrar intervenciones pedagógicas con código único de rastreo (`INT-YYYY-XXXX`), e inyectar cabeceras de auditoría HTTP (`X-Supervision-*`) en cada petición al backend.

---

## 2. ARQUITECTURA DE SOFTWARE Y COMPONENTES CLAVE

### Archivos Fuente Principales:
* **Módulo de Gestión de Control Escolar:** `js/directora/school-center.module.js` (`SchoolCenterModule`).
* **Motor de Supervisión e Intervención:** `js/shared/supervision.js` (`SupervisionEngine`).
* **Estilos Visuales Dedicated:** `css/school-center.css` y `css/supervision.css`.
* **Vistas HTML de Integración:**
  * `panel_directora.html` (`<div id="kscRoot"></div>` bajo la sección `#sec-centro-escolar`).
  * `panel_asistente.html` (`<div id="kscRoot"></div>` bajo la sección `#sec-centro-escolar`).

### Pestañas Principales del Módulo (`TABS`):
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CENTRO DE GESTIÓN ESCOLAR                             │
├───────────────┬─────────────────────────────────────────────────────────────┤
│ Pestaña       │ Función / Propósito                                         │
├───────────────┼─────────────────────────────────────────────────────────────┤
│ 1. Resumen    │ Hero de salud del centro, KPIs operativos y mapa general.   │
│ 2. Organización│ Organigrama de Aulas, fichas técnicas y docentes asignados.│
│ 3. Calendario │ Calendario escolar de experiencias y eventos pedagógicos.   │
│ 4. Monitoreo  │ Matriz de seguimiento en vivo de rutinas y asistencias.     │
│ 5. Reportes   │ Generación de estadísticas acumuladas y consolidados.       │
│ 6. Intervenciones│ Centro de mando de incidencias, acciones directivas y actas.│
└───────────────┴─────────────────────────────────────────────────────────────┘
```

---

## 3. COMPONENTE 1: ORGANIGRAMA INTERACTIVO Y ORGANIZACIÓN DE AULAS

El **Organigrama Escolar** (`tab: 'organizacion'`) transforma la lista estática de aulas en una estructura visual xerárquica e interactiva representativa del modelo educacional Montessori y Estancia Infantil.

### Funciones y Mapeo del Organigrama:
1. **Agrupación por Niveles Pedagógicos:**
   * **Lactantes y Maternal:** Bebés / Lactantes I y II (0 a 12 meses).
   * **Caminadores y Párvulos:** Niños pequeños (1 a 3 años).
   * **Preescolar y Kínder:** Educación infantil temprana (3 a 6 años).
2. **Tarjeta / Ficha de Aula en el Organigrama:**
   * **Encabezado del Aula:** Nombre del aula (ej. *Caminadores A*, *Párvulos B*), nivel y rango de edad.
   * **Docente Titular y Asistente:** Nombre, avatar y estado de conexión en vivo.
   * **Indicador de Capacidad y Ratio:** Barra de progreso con porcentaje de ocupación (ej. *12 / 15 Estudiantes - 80%*). Si supera el 90%, el indicador cambia a estado de advertencia (color naranja/rojo).
   * **Ratio Docente-Niño:** Cálculo dinámico según la edad del aula (ej. *1:5 en Lactantes*, *1:8 en Párvulos*).
3. **Ficha Detallada de Aula (`openAula(classroomId)`):**
   * Al hacer clic en cualquier aula del organigrama, se despliega un modal o panel de detalle profundo con 5 pestañas internas:
     * **General:** Información de cupos, horarios, salones físicos y docentes.
     * **Estudiantes:** Lista completa de alumnos matriculados, fotos, tutores y alergias/condiciones médicas.
     * **Asistencia / Rutinas Hoy:** Estado del pase de lista y avance porcentual de las rutinas completadas.
     * **Personal:** Historial de maestras a cargo y suplencias.
     * **Botón de Acción "Supervisar / Intervenir Aula":** Detonador principal que activa el `SupervisionEngine`.

---

## 4. COMPONENTE 2: MONITOR DE TIEMPO REAL Y SALUD OPERACIONAL

El **Monitoreo en Tiempo Real** (`tab: 'monitoreo'`) provee una matriz reactiva para supervisar la ejecución de las actividades del día sin tener que ingresar físicamente a cada salón.

### Funciones y Componentes del Monitor:
1. **Semáforo de Salud Operacional (`#kscSem`):**
   * **Verde (OK):** Todas las aulas han pasado asistencia y las rutinas se registran con una puntualidad mayor al 85%.
   * **Amarillo (Alerta Moderada):** Existen aulas con asistencia pendiente pasadas las 9:00 AM o retrasos en el registro de almuerzo/sueño.
   * **Rojo (Crítico):** Aulas sin maestras reportadas, incidentes médicos no atendidos o faltas de registro masivas.
2. **Matriz de Seguimiento de Rutinas Infantiles:**
   * **Alimentación:** Seguimiento del desayuno, merienda matutina, almuerzo y merienda vespertina (porcentaje de consumo de alimentos).
   * **Esfínteres / Pañales:** Frecuencia de cambios de pañal, micciones, deposiciones o idas al baño registradas por las maestras.
   * **Sueño / Tiempos de Descanso:** Horas de inicio y fin de siesta por cada niño.
   * **Temperatura / Salud:** Registro de tomas de temperatura corporal en caso de cuadros febriles o medicación autorizada.
3. **Alertas de Retraso y Ausencias:**
   * Mapea en color destacado las aulas que presentan inconsistencias o falta de actualización en los últimos 45 minutos.

---

## 5. COMPONENTE 3: MOTOR DE INTERVENCIÓN Y SUPERVISIÓN (`SupervisionEngine`)

El motor de **Supervisión e Intervención** (`js/shared/supervision.js`) es una innovación arquitectónica que permite a la Directora o Asistente ejercer presencia activa, auditoría e impersonación supervisada sobre la gestión del aula.

### Flujo Operativo de Supervisión e Intervención:

```
[Directora / Asistente abre Ficha de Aula o Módulo de Intervenciones]
                                │
                                ▼
         [Clic en "Iniciar Modo Supervisión en Aula"]
                                │
                                ▼
           [SupervisionEngine.enter({classroomId, teacherId})]
                                │
                                ├──────────────────────────────────────────────┐
                                ▼                                              ▼
                [Persistencia en LocalStorage]                [Inyección de Sesión en BD]
                ('karpus_supervision_ctx_v1')                (Tabla 'supervision_sessions')
                                │                                              │
                                └──────────────────────┬───────────────────────┘
                                                       │
                                                       ▼
                             [Barra Superior Flotante Persistente]
                             (#supervisionBar con pulso de advertencia)
                                                       │
                                                       ▼
                            [Interceptor de Peticiones Fetch Activado]
                            Agrega HTTP Headers en cada solicitud:
                             - X-Supervision-Active: true
                             - X-Supervision-Session-Id: [UUID]
                             - X-Supervision-Classroom-Id: [ID_AULA]
                             - X-Supervision-Teacher-Id: [ID_DOCENTE]
                                                       │
                                                       ▼
                        [Intervención Directa o Registro de Incidentes]
                         - Inicia 'SupervisionEngine.openInterventionModal()'
                         - Genera Código Único: INT-2025-XXXX
                         - Registra motivo, acción directiva y acta
                         - Almacena en 'supervision_audits'
                                                       │
                                                       ▼
                       [Finalizar Supervisión: SupervisionEngine.exit()]
                         - Cierra sesión en BD
                         - Remueve cabeceras HTTP y barra superior
```

### Características Técnicas del Motor de Intervención:
1. **Banner Flotante de Supervisión Activa (`#supervisionBar`):**
   * Se coloca fijado en la parte superior de la pantalla con una animación de pulso distintiva.
   * Muestra el aula actualmente supervisada, la maestra a cargo, el tiempo transcurrido y un botón para **"Registrar Intervención"** o **"Salir de Supervisión"**.
2. **Inyección Transparente de Cabeceras HTTP:**
   * Modifica temporalmente la función global `window.fetch` para adjuntar automáticamente los encabezados `X-Supervision-*`.
   * Esto garantiza que cualquier cambio realizado durante la supervisión (asistencias corregidas, notas de rutina agregadas, publicaciones en el muro) quede explícitamente etiquetado en la base de datos como una **Acción de Supervisión Directiva**.
3. **Módulo de Gestión de Intervenciones (`tab: 'intervenciones'`):**
   * Muestra el historial completo de intervenciones aplicadas en el colegio.
   * **Campos Registrados:** Código único (`INT-2025-XXXX`), Aula, Maestra afectada, Directiva responsable, Prioridad (Alta, Media, Baja), Estado (Abierta, En Proceso, Resuelta) y Detalle de la Medida Adoptada.
   * **Saltos Rápidos de Contexto (`_sectionJumpForAlert`):** Permite pasar directamente desde una alerta de la intervención a la sección correspondiente (Pase de lista, Chat de Maestra, Muro de Avisos o Libreta de Calificaciones).

---

## 6. DIFERENCIAS DE ACCESO ENTRE DIRECTORA Y ASISTENTE

| Función / Característica | Panel de Directora (`panel_directora.html`) | Panel de Asistente (`panel_asistente.html`) |
| :--- | :---: | :---: |
| **Visualización del Organigrama** | Acceso Total (Todas las Aulas) | Acceso Total (Todas las Aulas) |
| **Monitor en Tiempo Real** | Acceso Total + Semáforo Global | Acceso Total + Semáforo Global |
| **Iniciar Modo Supervisión** | Habilitado (Con Sello Directivo) | Habilitado (Con Sello Asistente) |
| **Crear y Cerrar Intervenciones** | Permisos Totales (Aprobar/Cerrar) | Registrar e Iniciar Intervención |
| **Modificación Estructural de Aulas** | Crear/Eliminar/Editar Aulas | Lectura y Asignación Operativa |

---

## 7. CONCLUSIONES Y BENEFICIOS OPERATIVOS

El módulo de **Control Escolar** proporciona una arquitectura robusta de fiscalización y acompañamiento pedagógico:
* **Garantiza la Calidad Educativa:** Permite detectar cuellos de botella en las rutinas de los niños antes de que se conviertan en quejas de los padres.
* **Transparencia y Trazabilidad:** Cada acción realizada durante una supervisión queda registrada con sello digital y código de intervención auditable.
* **Respuesta Inmediata a Emergencias:** Proporciona un canal directo para intervenir aulas en situaciones de incidentes médicos, ausencias de personal o soporte pedagógico.
