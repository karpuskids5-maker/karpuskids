# 📑 INFORME TÉCNICO, ARQUITECTURA Y GUÍA DE OPERACIÓN: SISTEMA DE PAGOS, CONCEPTOS Y MENSUALIDADES KARPUS KIDS

---

## 🌟 1. RESUMEN EJECUTIVO Y VISIÓN GENERAL

El módulo de **Gestión Financiera y Pagos Karpus Kids** ha sido optimizado e interconectado integralmente para consolidar todos los flujos de cobro del centro educativo en un único sistema cohesivo.

### Principales Logros del Nuevo Ecosistema Conectado:
1. **Flujo Unificado de Cobros Multi-Concepto**:
   - **Mensualidades (Colegiaturas)**
   - **Inscripciones y Reinscripciones Anuales**
   - **Pedidos de la Tienda Escolar** (Uniformes, Libros, Útiles)
   - **Conceptos Personalizados / Especiales** (Excursiones, Graduación, Horario Prolongado, etc.)
2. **Gestor Dinámico de Conceptos para la Directora**:
   - La Directora ahora puede crear, editar, activar/desactivar y definir montos base para nuevos conceptos de pago directamente desde su interfaz.
3. **Integración Directa Tienda ↔ Sección de Pagos**:
   - Al realizar una compra en la Tienda Escolar, el Padre puede elegir la opción **"Pagar / Enviar Comprobante Ahora"**, lo que lo redirige automáticamente a la Sección de Pagos con el concepto ("Pedido Tienda #KK-XXXX"), monto y referencia precargados en 1 clic.
4. **Filtros Avanzados y Clasificación Visual en los Paneles**:
   - La Directora, Asistente y el Padre pueden filtrar y diferenciar visualmente los pagos por concepto mediante insignias e íconos distintivos:
     - 📅 **Mensualidad**: Azul / Púrpura
     - 📝 **Inscripción**: Esmeralda
     - 🎒 **Reinscripción**: Añil / Azul Marino
     - 🛒 **Tienda Escolar**: Teja / Naranja
     - ⭐ **Especial / Eventos**: Violeta
5. **Aprobación Conectada**:
   - Cuando la Directora aprueba un pago proveniente de un pedido de la Tienda Escolar desde su Sección de Pagos, el estado del pedido en la Tienda pasa automáticamente a **Confirmado (`confirmed`)**, notificando al Padre e instruyendo la preparación del paquete.

---

## 📅 2. INFORME DETALLADO: LÓGICA Y CICLO DE PAGO DE LA MENSUALIDAD AUTOMÁTICA

El cobro de la mensualidad en Karpus Kids opera bajo una arquitectura automatizada en base a reglas de negocio bien definidas en PostgreSQL / Supabase RPC (`run_payment_cycle`), garantizando equidad, previsibilidad financiera y transparencia para las familias.

### 🔄 A. El Ciclo de Facturación Mensual (Paso a Paso)
1. **Generación Automática (Día 25 de cada mes)**:
   - El día **25** de cada mes (configurable por la Directora en `school_settings`), el motor del sistema (`run_payment_cycle`) ejecuta la creación masiva de los cobros para el **mes siguiente**.
   - *Ejemplo*: El 25 de mayo se genera la colegiatura correspondiente a **Junio**.
2. **Fecha Límite y Período de Gracia (Días 1 al 5)**:
   - Todos los cobros generados tienen como fecha de vencimiento el **día 5** del mes correspondiente.
   - Durante los días 1 al 5, el pago se encuentra en estado **Pendiente (`pending`)** sin generar ningún tipo de penalización ni mora.
3. **Aplicación de Recargos por Mora (A partir del Día 6)**:
   - Si al iniciar el día 6 el cobro sigue en estado `pending`, el sistema lo clasifica visual y numéricamente como **Vencido (`overdue`)**.
   - Se aplica una tasa de recargo por mora del **5% mensual** (o regla configurada), desglosándose transparentemente tanto en la vista del Padre como en el panel de la Directora.
   - La Directora o Asistente cuentan con la facultad de condonar o exonerar la mora (`waiveMora`) en 1 clic dejando registro auditado con el motivo de exención.

### 👨‍👩‍👧‍👦 B. Lógica Automática del Descuento de Hermanos (*Sibling Discount System*)
Durante el ciclo de facturación, la función de servidor evalúa a los estudiantes activos vinculados al mismo tutor (`parent_id` / `p1_email` / `p2_email`):
- **1er Hijo (Hermano Mayor / Tarifa Base)**: 100% de la colegiatura regular.
- **2do Hijo**: 10% de descuento automático en la mensualidad.
- **3er Hijo en adelante**: 15% de descuento en la mensualidad.
- *Sobrescritura por Directora*: La Directora puede personalizar individualmente la tarifa mensual en la ficha del alumno o aplicar/ajustar un descuento porcentual o monto fijo (`applyDiscount`) directamente sobre el cobro del mes.

### 🔔 C. Notificaciones y Activación de Alumnos
- **Recordatorios Preventivos y Notificaciones Push / Email**:
  - **Día 25**: Notificación push y correo de "Nueva colegiatura disponible para pago".
  - **Día 2 (3 días antes)**: Recordatorio "Tu colegiatura vence en 3 días".
  - **Día 5 (Día del vencimiento)**: Alerta "Hoy es el último día para pagar sin recargos".
  - **Día 6 (Vencido)**: Alerta "Tu pago de colegiatura ha vencido".
- **Activación / Estado del Estudiante**:
  - Al aprobar un pago en revisión o registrar un pago manual en efectivo/transferencia, el estudiante vinculado se marca automáticamente con `is_active = true` y `status = 'activo'`, habilitando sus accesos y servicios sin demoras.

---

## 🛠️ 3. ARQUITECTURA DE INTEGRACIÓN Y CONEXIÓN MULTI-MÓDULO

```
                   ┌────────────────────────────────────────┐
                   │    DIRECTORA: Gestor de Conceptos     │
                   │ (payment_concepts: Mensualidad, Tienda) │
                   └──────────────────┬─────────────────────┘
                                      │
          ┌───────────────────────────┴───────────────────────────┐
          ▼                                                       ▼
┌───────────────────┐                                   ┌───────────────────┐
│ TIENDA ESCOLAR    │ ─── (Realiza Pedido + Redirección) ──►│ PANEL PADRE:      │
│ (store_orders)    │                                   │ Sección de Pagos  │
└─────────┬─────────┘                                   └─────────┬─────────┘
          │                                                       │
          │                                                       │ (Sube Comprobante/
          │                                                       │  Reporta Pago)
          │                                                       ▼
          │                                             ┌───────────────────┐
          └────────────────────────────────────────────►│ TABLA `payments`  │
                                                        └─────────┬─────────┘
                                                                  │
                                                                  ▼
                                                        ┌───────────────────┐
                                                        │ PANEL DIRECTORA / │
                                                        │ ASISTENTE         │
                                                        │ (Aprobación & PDF)│
                                                        └───────────────────┘
```

---

## 🚀 4. MEJORAS TÉCNICAS APLICADAS EN LA INTERFAZ Y CÓDIGO

1. **`js/directora/payments_clean.js` & `panel_directora.html`**:
   - **Gestor Modal de Conceptos**: Permite crear y administrar ítems en `payment_concepts`.
   - **Filtro Avanzado por Concepto**: Selector para filtrar por Mensualidad, Inscripción, Reinscripción, Tienda o Especial.
   - **Formulario de Registro Manual**: Menú desplegable alimentado directamente desde el catálogo de conceptos.
   - **Sincronización con Tienda Escolar**: Al aprobar un pago con referencia de pedido de tienda, actualiza `store_orders` a `confirmed`.

2. **`js/padre/payments.js` & `panel_padres.html`**:
   - **Selector de Concepto al Pagar**: El padre puede reportar transferencia seleccionando el concepto deseado.
   - **Recepción de Precarga desde Tienda**: Captura parámetros `store_order_id`, `amount` y `concept` para autocompletar el formulario de pago.
   - **Tarjetas Dinámicas de Historial**: Badges e íconos temáticos para diferenciar mensualidades, tienda e inscripciones.

3. **`js/shared/store.js`**:
   - **Opción en Checkout**: Botón **"Pagar / Enviar Comprobante Ahora"** que enlaza directo a la sección `#pagos` del Padre cargando el total del carrito y el ID del pedido.

---
*Informe elaborado para la Dirección General y el Equipo Técnico de Karpus Kids.*
