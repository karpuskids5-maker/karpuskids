# Plan Implementación 50 Mejoras + Corrección de Errores — Panel Asistente

## Repository Research (Auditoría de Gaps Reales)

### Estructura Actual
- **HTML principal:** [panel_asistente.html](file:///c:/Users/usuario/Documents/karpus/panel_asistente.html) — 1870 líneas, diseño premium con sidebar glassmórfico, paleta Cyan/Emerald, tipografía Inter.
- **Módulo JS principal:** [js/asistente/main.js](file:///c:/Users/usuario/Documents/karpus/js/asistente/main.js) — 1200+ líneas, lazy-loading por sección, integración Realtime/BackNavigation.
- **Módulos específicos asistente:** `modules/students.js`, `modules/dashboard.js`, `modules/rooms.js`, `payments.js`, `access.js`, `teachers.js`, `state.js`, `api.js`.
- **Módulos compartidos (shared):** inscripciones.module.js, chat.js, wall.js, badges.js, student-record-modal.js, carnets.module.js, payment-service.js, query-cache.js, etc.

### 2 Errores Críticos Documentados (Sección 1 asistente.md)

**Error A — #preregList tipo incorrecto:**
- Actual [L937](file:///c:/Users/usuario/Documents/karpus/panel_asistente.html#L937): `<div id="preregList" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">` (diseño de TARJETAS en grid)
- [inscripciones.module.js L111-L175](file:///c:/Users/usuario/Documents/karpus/js/directora/inscripciones.module.js#L111-L175): inyecta `<tr>` filas de TABLA + en empty state `<td colspan="7">`.
- **Colapso DOM confirmado:** filas `<tr>` dentro de un `<div>` rompen layout. Los KPI cards y filtros existen pero el render colapsa.

**Error B — Faltan filtros #filterStudentClassroom y #filterStudentStatus:**
- [students.js L19/L54-L73](file:///c:/Users/usuario/Documents/karpus/js/asistente/modules/students.js#L54-L73): hace `getElementById('filterStudentClassroom')` y `getElementById('filterStudentStatus')`.
- Actual panel_asistente.html L850-870 sección #estudiantes: **SOLO tiene `searchStudentInput`**, NO existen los 2 selects → TypeError null, filtrado inutilizable.
- students.js L239-L236 hace la consulta de students *sin cargar classrooms dinámicamente* para poblar el select.

### 50 Mejoras — Checklist vs Estado Actual (18 implementadas parcialmente, 32 faltan)

| Módulo | Item | Implementado | Gap a corregir |
|---|---|---|---|
| **Inscripciones** (1-10) | 1.Tabla SaaS divide-y | ❌ PARCIAL | Contenedor tipo grid → cambiar a table |
| | 2.Pulse Indicator verde | ❌ NO | Añadir anillo pulsante header sección |
| | 3.KPI Cards (3) → hay 4 | ✅ SÍ | 4 cards existen → estética premium |
| | 4.Filtros combinados | ✅ SÍ | search + select existen |
| | 5.Badge Alergias/Afecciones | ❌ PARCIAL | Solo ⚠ diminuto → badge rojo/naranja destacado |
| | 6.Edad calculada (años+meses) | ❌ REVISAR | computeAge() birthday-utils.js |
| | 7.Acciones (Aprobar/Rechazar/Ver) | ❌ FALTA APROBAR | Sólo Rechazar + Revisar → añadir Aprobar uniclick |
| | 8.Badges neuro-diseñados | ✅ PARCIAL | Existen STATUS_META con dot → ajustar pastel |
| | 9.Documentos cargados contador | ✅ PARCIAL | Hay docsCount badge → añadir icono |
| | 10.Empty state ilustrado | ❌ PARCIAL | Hay tr vacío → mejorar ilustración/instrucciones |
| **Estudiantes** (11-20) | 11.Filtro aulas dinámico | ❌ NO | Falta elemento HTML + populate desde DB |
| | 12.Filtro estado operativo | ❌ NO | Falta elemento HTML |
| | 13.Paginación Inteligente + selector | ❌ PARCIAL | Hay Next/Prev pero pageSize fijo=10 → añadir selector 10/25/50 |
| | 14.Avatares degradado mágico | ❌ NO | Solo inicial sobre bg-teal-50 → gradientes hash-based |
| | 15.Doble clic expediente | ✅ SÍ | ondblclick="window.App._openStudentModal" |
| | 16.Monospaced ID Tag | ❌ NO | Falta mostrar ID estudiante con font mono |
| | 17.Realtime karpus:students-changed | ✅ SÍ | main.js L207 dispatchEvent listener |
| | 18.Contacto Emergencia visible | ❌ NO | Falta mostrar emergency_contact + relación en tabla |
| | 19.Contador "Mostrando X de Y" | ❌ PARCIAL | Hay 1–N de total en paginación → mejorar etiqueta |
| | 20.Exportar/Imprimir Rapid-Print | ❌ NO | Falta botón export PDF |
| **Dashboard** (21-28) | 21.Widget Alertas Urgentes | ✅ PARCIAL | Existe urgentAlertsWidget → añadir sin ponche/mora |
| | 22.Carrusel Cumpleaños ±7d | ❌ PARCIAL | isUpcoming birthday-utils → verificar rango 7 días |
| | 23.Mini-Chart Asistencia Semanal | ❌ NO | Falta canvas + data asistencia 7d (solo hay ingresos) |
| | 24.Skeletons carga animada | ❌ PARCIAL | Sólo spinner simple → añadir skeletons shimmer |
| | 25.Stale-While-Revalidate cache | ✅ SÍ | QueryCache.getStale en dashboard L49 |
| | 26.Calculadora Ausencias Enfermedad | ❌ NO | Falta tarjeta summarizado absent reports |
| | 27.Resumen Financiero HOY | ❌ NO | Falta KPI cobrados por asistente hoy |
| | 28.Estado Conexión Live | ❌ NO | Falta indicador en sidebar profile online/offline |
| **Accesos** (29-35) | 29.Resumen E/S 4 badges | ✅ SÍ | Presentes/Tardanzas/Salidas/Total L1187-1217 |
| | 30.Gráfico Semanal | ✅ SÍ | #accessChart canvas L1178 |
| | 31.Rango Fechas | ✅ SÍ | accessFilterFrom/To L1143-1147 |
| | 32.Escanear QR carnet | ❌ REVISAR | Existe openScanner → añadir botón visible |
| | 33.Badges Método Registro | ❌ NO | Falta columna Profesor/Escáner/Manual |
| | 34.Exportar Excel/CSV | ✅ PARCIAL | btnExportExcel existe → implementar lógica |
| | 35.Feedback Sonoro + Check | ❌ NO | Falta tono + animación check verde |
| **Pagos** (36-42) | 36.Cola Verificación Comprobantes | ✅ SÍ | payment-queue-container L1423-1426 amber-50 |
| | 37.Lightbox visor recibos | ❌ NO | Hay lightbox.js cargado pero no wired a evidence_url |
| | 38.Búsqueda Avanzada (ref/padre/concepto) | ❌ PARCIAL | Sólo busca nombre alumno → ampliar campos |
| | 39.Filtro Período Académico dinámico | ✅ SÍ | Años dinámicos L1799-1826 |
| | 40.Aprobar/Rechazar con Motivo | ❌ PARCIAL | rejectPayment → validar requiredReason + input |
| | 41.Badge Estado Financiero Alumno | ❌ NO | Falta badge "Al día/Con mora" en row/ficha pago |
| | 42.Generador Recibos Digital PDF | ❌ PARCIAL | Hay boletin-pdf + factura.js → wire al aprobar |
| **Muro + Chat** (43-50) | 43.Muro Red Social cards media | ✅ PARCIAL | WallModule → ensure vídeo max 30s |
| | 44.Pausa vídeos simultáneos | ❌ NO | EventListener pauseAll al reproducir uno |
| | 45.Chat WhatsApp layout | ✅ SÍ | chat-shell 2 columnas L1577 |
| | 46.BackNavigation móvil chat | ✅ SÍ | ChatView.back L984 + backBtn L1597 |
| | 47.Indicador Presencia (Punto Verde) | ❌ PARCIAL | Header metaEl online → FALTA en lista contactos |
| | 48.Contexto Alumno en Chat header | ✅ SÍ | main.js L999-1031 query student by parent_id |
| | 49.Buscador Conversaciones | ❌ PARCIAL | Existe chatSearchInput → wire filtro |
| | 50.Push Notifications OneSignal | ✅ SÍ | initOneSignal + sendPush en submitNewPost |

---

## Files and Modules to Modify

### HTML (1 archivo)
- **[panel_asistente.html](file:///c:/Users/usuario/Documents/karpus/panel_asistente.html)**
  - #inscripciones: Reestructurar div#preregList → `<table><thead><tbody id="preregList">` con wrapper overflow-x-auto. Inyectar pulse indicator header.
  - #estudiantes header row: Añadir `<select id="filterStudentClassroom">` + `<select id="filterStudentStatus">`. Añadir botón Exportar/Imprimir.
  - Dashboard: Añadir `<canvas id="attendanceMiniChart">` para asistencia semanal. Añadir 2 KPI cards (Hoy cobros, Ausencias notificadas).
  - Accesos: Asegurar botón abrir scanner visible. Añadir columna Método accessTableBody thead.
  - Footer sidebar: Añadir indicador conexión (online/offline dot).
  - **Correcciones encoding:** Asegurar meta charset UTF-8 (ya L4). Eliminar caracteres raros tipo "�" en comentarios JS L176, etc.

### JS Módulos Asistente (4 archivos)
- **[js/asistente/modules/students.js](file:///c:/Users/usuario/Documents/karpus/js/asistente/modules/students.js)** — HIGH PRIORITY
  - init(): Añadir `_loadClassroomsFilter()` para poblar filterStudentClassroom desde `supabase.from('classrooms')`.
  - loadStudents(): Incluir `emergency_contact`, `emergency_relationship` en SELECT.
  - _renderPageContent(): Avatar degradado por hash(nombre), Monospaced ID, contacto emergencia, badges data-label para móvil.
  - _renderPagination(): Selector pageSize 10/25/50, etiqueta "Mostrando X–Y de Z alumnos".
  - Añadir `_exportListPDF()` print/export.
- **[js/asistente/modules/dashboard.js](file:///c:/Users/usuario/Documents/karpus/js/asistente/modules/dashboard.js)**
  - init(): añadir `_loadAttendanceMiniChart()` + `_loadTodayFinancial()` + `_renderConnectionBadge()` + skeleton placeholders initial render.
  - _renderUrgentAlerts: incluir alumnos sin ponche + cobros vencidos específicos.
- **[js/asistente/payments.js](file:///c:/Users/usuario/Documents/karpus/js/asistente/payments.js)**
  - _renderRow: onclick evidence_url → window.openLightbox. Badge mora "Al día/Con mora".
  - search: incluir reference + bank + concept + parent name.
  - rejectPayment: diálogo requiredReason.
  - markPaid: emitir recibo PDF (factura.js/load-pdf.js).
  - Añadir: _exportToCSV lógica btnExportExcel.
- **[js/asistente/access.js](file:///c:/Users/usuario/Documents/karpus/js/asistente/access.js)**
  - loadHistory: incluir método registro (source column). Badge Profesor/Escáner Asistente/Manual.
  - register(): feedbackAudio TONE + animación check verde overlay.
  - Añadir botón visible activar scanner en header accesos.
  - Implementar exportCSV lógica btnExportExcel.

### JS Compartidos (2 archivos touch)
- **[js/directora/inscripciones.module.js](file:///c:/Users/usuario/Documents/karpus/js/directora/inscripciones.module.js)** — Solo si hace falta un botón Aprobar rápido.
- **[js/asistente/main.js](file:///c:/Users/usuario/Documents/karpus/js/asistente/main.js)** — (A) chatSearchInput wiring filter list. (B) WallModule video pause simultaneous. (C) Presence dot green en chatContactsList items. (D) Limpiar comentarios con codificación errónea "navegaci�n" → UTF-8 correcto.

### CSS (touch existente en style block panel_asistente.html)
- Añadir `@keyframes pulse-ring` para el indicator sección.
- Añadir `.skeleton-shimmer` clases shimmer gradient.
- Añadir gradients palette para avatares estudiantes (slate-500 → purple-500 → orange-500 → etc).
- Clase `.font-mono` + tag para ID estudiante.

---

## Implementation Steps (Dependency-ordered)

### FASE A — CORRECCIONES CRÍTICAS (Bloqueantes render/layout)
1. **A1:** panel_asistente.html → Reestructurar #inscripciones a tabla completa (thead/tbody#preregList/div.overflow-x-auto). Corregir estructura para que coincida con InscripcionesModule.render().
2. **A2:** panel_asistente.html → Añadir `filterStudentClassroom` y `filterStudentStatus` en #estudiantes header controls; añadir btnExportStudents.
3. **A3:** students.js → `_loadClassroomsFilter()` en init() que consulte classrooms y rellene options. Actualizar SELECT loadStudents para traer emergency_contact.

### FASE B — VISUAL PREMIUM + AVATARES/TABLAS
4. **B1:** students.js → _renderPageContent implementar: avatar con gradiente hash-based, font-mono ID tag, data-label en cada td para responsive móvil tarjetas, contacto emergencia visible, badge count "Mostrando X–Y de Z".
5. **B2:** students.js → _renderPagination añadir selector 10/25/50 y botón export.
6. **B3:** inscripciones.module.js (touch light): Añadir columna Acción "Aprobar" uniclick llamando RPC approve directo. Mejorar badge alergías ROJO destacado. Añadir icono + nº docs. Empty state premium.
7. **B4:** HTML + CSS inline → Pulse indicator en header inscripciones/estudiantes. Skeleton shimmer placeholders.

### FASE C — DASHBOARD NUEVOS WIDGETS Y CHARTS
8. **C1:** dashboard.js → _loadAttendanceMiniChart() con últimos 7 días bar/lines.
9. **C2:** dashboard.js → Nuevas métricas: Cobros hoy (amount where paid_date=hoy y created_by=asistente.id), Tarjeta Ausencias notificadas (enfermedad/permisos).
10. **C3:** dashboard.js → _renderUrgentAlerts: detectar estudiantes sin ponche y cobros con mora.
11. **C4:** HTML + dashboard.js → Badge conexión sidebar profile navigator.onLine events.

### FASE D — ACCESOS (Ponche) + PAGOS
12. **D1:** access.js → Añadir columna `method` en accessTableBody thead; badges según source (teacher/scanner/manual). Implementar feedback sonoro + animación check al registrar.
13. **D2:** access.js → Implementar lógica _exportToCSV(); añadir botón scanner en header accesos section.
14. **D3:** payments.js → _renderRow: lightbox wired al voucher/evidence; Badge financiero alumno; search ampliar a reference/bank/concept/padre.
15. **D4:** payments.js → rejectPayment con requiredReason dialog; markPaid dispara recibo digital PDF. Implementar _exportPaymentsCSV.

### FASE E — CHAT + MURO (Microinteracciones)
16. **E1:** main.js → Wire chatSearchInput para filtrar chatContactsList en vivo. Añadir presence indicator (green dot) por cada fila de contact list usando ChatModule presence.
17. **E2:** main.js → WallModule Pausa vídeos simultáneos: event delegation sobre `<video>` en muroPostsContainer.
18. **E3:** Limpieza global codificación UTF-8: revisar comentarios JS "navegaci�n", "Inicializaci�n", "Carga perezosa" y corregir caracteres ilegales en main.js/payments.js/access.js.

### FASE F — VALIDACIÓN Y PRE-DEPLOY
19. **F1:** `node --check` todos los archivos JS modificados.
20. **F2:** Ejecutar `scripts/pre-deploy-check.cjs` si existe; verificar package.json commands.
21. **F3:** Revisión final consistencia visual en HTML (estructura anidada correcta, sin cierres huérfanos). Validar consola 0 TypeErrors.

---

## Dependencies and Considerations
- **Shared modules first:** InscripcionesModule, WallModule, ChatModule ya funcionan en directora/main → no romper imports.
- **No escribir supabase.js duplicado:** project_memory indica centralizar en js/shared/ → mantener.
- **Responsive mobile <640px:** Toda nueva columna/feature requiere `[data-label]` en cada `<td>` para que kk-table-cards CSS transforme a tarjetas (L512-544 CSS).
- **Tailwind escapes en CSS nativo:** Usar selectores atributo `[class*="bg-emerald-500"]` NO `.\[\:hover\:bg-teal-500\]` para evitar parse errors (lessons learned).
- **Años dinámicos:** NUNCA hardcodear 2024/2025 → usar initDynamicYearSelects (ya existe L1799-1826) + rangos ±2.
- **Catch blocks NO vacíos:** Usar Helpers.safeLog() si no toast (project_memory hard constraint).
- **Roles permitidos:** ensureRole(['asistente', 'admin', 'directora']) ya en main.js L181 → mantener.
- **QR staff en backend:** No generar client-side sensitive data; Helpers.generateQRWithLogo() ya lo hace.

## Validation
1. **Sintaxis:** `node --check js/asistente/main.js && node --check js/asistente/modules/*.js && node --check js/asistente/payments.js && node --check js/asistente/access.js`.
2. **Consola 0 TypeErrors:** Abrir panel_asistente.html (con login mock) → navegar todas las secciones → verificar 0 `Cannot read properties of null`.
3. **Filtros estudiantes funcionan:** Elegir aula en filterStudentClassroom → se reduce la tabla. Elegir Inactivos → solo is_active=false.
4. **#inscripciones render correcto:** No hay texto superpuesto; headers alineados con celdas; empty state muestra colspan=7 correctamente.
5. **Responsive móvil <640px:** Las tablas se convierten en tarjetas gracias a data-label.
6. **Push notifications/conexión:** navigator.onLine change actualiza el badge sidebar.
7. **PWA manifest:** Validez por pre-deploy script.

## Risks
- **Riesgo: InscripcionesModule compartido rompe directora** → Controlar cambios inscripciones.module.js: sólo añadir un botón onclick → if function no existe en panel_directora.html degradará gracefully. Alternativa: añadir el approve por App.inscripciones.approve(id) global para que no rompa if missing.
- **Riesgo: Avatar gradient hash choques** → Hash function simple (firstCode + lastCode % palette.length). 6-8 paletas → baja probabilidad repetición consecutivos; no impacta funcionalidad.
- **Riesgo: Lightbox no abre bien relative URLs** → Usar existing shared/lightbox.js pattern. Si no existe método open, fallback a window.open(evidence_url, '_blank').
- **Riesgo: Audio feedback bloqueado autoplay** → Tono sólo después de interacción usuario (scanner success = ya hubo clic/permiso cámara). Web Audio API generar tono simple 660Hz, no require src file.
- **Riesgo: Caracteres UTF-8 en nombres** → Todo render pasa por Helpers.escapeHTML() ya; asegurarse que campos nuevos también lo usen.
