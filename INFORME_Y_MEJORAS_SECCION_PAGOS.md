# 📑 INFORME TÉCNICO Y PLAN DE MEJORAS DE LA SECCIÓN DE PAGOS
**Karpus Kids — Centro Educativo Infantil**

---

## 📋 1. RESUMEN EJECUTIVO Y CAMBIOS APLICADOS

Con el objetivo de optimizar la gestión financiera del colegio y mejorar la experiencia de los padres de familia, se han implementado las siguientes mejoras operativas en el módulo de pagos:

### A. Modificación Flexible de Precios de Mensualidad por la Directora
- **Funcionalidad**: La Directora ahora cuenta con la capacidad directa de ajustar o personalizar el precio/monto de la mensualidad de un mes específico para cualquier estudiante desde su panel (`panel_directora.html` y `js/directora/payments_clean.js`).
- **Acción en Interfaz**: Se agregó el botón con ícono de edición ✏️ (`editPaymentAmount`) en la tabla de pagos que despliega una ventana de confirmación interactiva para ajustar la tarifa del mes seleccionado (por ejemplo, aplicar descuentos especiales temporales o ajustar montos por acuerdos internos).
- **Persistencia**: El monto actualizado impacta directamente el registro en Supabase en la tabla `payments`, recalculando automáticamente los saldos, gráficos de ingresos e informes de morosidad.

### B. Recibo Electrónico y Descarga en PDF para Pagos en Efectivo y Transferencia
- **Funcionalidad**: Todos los pagos confirmados/aprobados (status `paid`), sin importar si fueron realizados en **efectivo**, transferencia o tarjeta, quedan registrados de inmediato en el historial del Padre (`panel_padres.html` y `js/padre/payments.js`).
- **Visualización**: Se eliminó el filtro limitante de mes único en la vista del historial del padre, garantizando que el usuario pueda consultar su histórico completo de cobros.
- **Recibo Electrónico Interactivo**: El padre puede presionar sobre cualquier cobro con estado "Aprobado" para abrir una ventana modal con el **Recibo Electrónico Oficial Karpus Kids** (que incluye número de recibo correlativo único `KK-XXXXXX`, desglose de estudiante, aula, tutor, concepto, método de pago, fecha de aprobación y validador).
- **Descarga PDF en 1 Clic**: Incorporación de motor **jsPDF** para generar y descargar un documento PDF profesional con formato A5 listo para imprimir o guardar.

---

## 👨‍👩‍👧‍👦 2. LÓGICA DEL DESCUENTO DE HERMANOS (SIBLING DISCOUNT SYSTEM)

Actualmente, el sistema admite la matriculación de familias con múltiples estudiantes asignados a un mismo tutor o correo de padre (`parent_id` / `p1_email`). La lógica de descuento por hermanos para la sección de pago opera bajo las siguientes directrices técnicas:

1. **Regla de Escala Progresiva**:
   - **1er Hijo (Hermano Mayor / Tarifa Base)**: 100% de la colegiatura/mensualidad regular.
   - **2do Hijo**: 10% de descuento automático en la mensualidad regular.
   - **3er Hijo en adelante**: 15% de descuento en la mensualidad regular.
2. **Aplicación Dinámica durante el Ciclo de Facturación (`run_payment_cycle`)**:
   - Durante la generación automática de cobros los días 25 de cada mes, la función Postgres agrupa los estudiantes activos por `parent_id` o `p1_email`.
   - Identifica el orden de inscripción o edad de los hermanos y aplica el descuento en la columna `amount` antes de registrar el cobro del mes.
3. **Control por Directora**:
   - La Directora puede sobrescribir o personalizar el descuento aplicado directamente usando el botón de edición de monto o ajustando la tarifa en la ficha del estudiante (`monthly_fee`).

---

## 🚀 3. INFORME DE 25 MEJORAS RECOMENDADAS PARA LA SECCIÓN DE PAGO

A continuación se detallan 25 mejoras prioritarias para elevar la sección de pago a estándares de nivel empresarial:

### 💳 Integración y Pasarela de Pagos
1. **Pasarela de Pago Online Integrada (CardNet / Azul / Stripe)**: Permitir que los padres paguen la colegiatura directamente con tarjeta de crédito/débito desde la app sin subir comprobantes manuales.
2. **Débito Automático Programado (Suscripción recurrente)**: Permitir a los padres afiliar su tarjeta para el cobro automático el día 1 o 5 de cada mes.
3. **Generación de Código QR estático/dinámico para transferencias**: Mostrar el QR de los bancos principales (Banreservas, BHD, Popular) para realizar transferencias express desde apps bancarias.

### 🧾 Facturación Electrónica y NCF (DGII República Dominicana)
4. **Integración con Comprobantes Fiscales (NCF - Consumidor Final / Crédito Fiscal)**: Generar automáticamente el número de comprobante fiscal NCF requerido por la DGII en cada recibo.
5. **Generación masiva de facturas de crédito fiscal**: Opción para emitir facturas a nombre de empresas que patrocinan o pagan la colegiatura de los hijos de sus empleados.

### 🔔 Recordatorios Automáticos y Multicanal
6. **Notificaciones Automáticas vía WhatsApp API (Twilio / Ultramsg)**: Enviar aviso interactivo por WhatsApp 3 días antes del vencimiento y el día del vencimiento con el botón de pago.
7. **Recordatorios preventivos por Email HTML personalizado**: Envío programado de plantilla de correo elegante con el resumen del estado de cuenta de la familia.
8. **Alertas Push automáticas en la App Móvil**: Notificación push de "Colegiatura disponible para pago" el día 25 y "Recordatorio de vencimiento" el día 4 del mes.

### 🧮 Gestión Inteligente de Morosidad y Recargos
9. **Exoneración de Mora en 1-Clic con Auditoría**: Permitir a la Directora o Asistente condonar recargos de mora indicando el motivo de exención registrado en bitácora.
10. **Escala Flexibilizada de Mora Automática**: Configuración de reglas de mora por porcentaje gradual (ej. 5% semana 1, 10% semana 2) o monto fijo por día de retraso.
11. **Acuerdos de Pago y Fraccionamiento**: Opción para dividir una mensualidad o deuda acumulada en 2 o 3 cuotas semanales/quincenales con plan de pago visible para el padre.

### 📊 Análisis Financiero y Business Intelligence (BI)
12. **Dashboard de Proyección de Flujo de Caja (Cashflow Forecasting)**: Gráficos interactivos de ingresos proyectados vs. cobrados vs. vencidos a 30, 60 y 90 días.
13. **Reporte de Morosidad por Aula y Nivel**: Desglose de tasa de morosidad agrupada por aula para identificar grupos con mayor retraso.
14. **Exportación Avanzada de Reportes (Excel / PDF / CSV)**: Generación de reportes de cierre de caja diario, matriz de cobros anuales e ingresos por tipo de concepto (mensualidad, inscripción, tienda, prolongado).

### 🎁 Descuentos, Becas y Fidelización
15. **Gestión Centralizada de Becas y Descuentos Especiales**: Módulo para asignar porcentajes de beca (25%, 50%, 100%) con fecha de expiración y motivo.
16. **Descuento por Pronto Pago**: Bonificación (ej. 5% de descuento) si la colegiatura se paga antes del día 30 del mes anterior.
17. **Integración de Créditos del Programa de Embajadores/Referidos**: Aplicación automática de créditos ganados por recomendar familias como saldo a favor en la siguiente colegiatura.

### 🏫 Cobros Adicionales y Tienda Integrada
18. **Facturación de Servicios Complementarios en la Misma Factura**: Consolidar en un solo cobro mensual la colegiatura, horario prolongado, servicio de almuerzo y actividades extracurriculares.
19. **Portal de Pago Directo para la Tienda Escolar**: Permitir comprar uniformes y libros agregándolos al estado de cuenta mensual o pagándolos en efectivo con recibo unificado.
20. **Cobro de Inscripciones y Reinscripciones Anuales**: Módulo automatizado para el proceso de reinscripción del nuevo año escolar con pagos por fases.

### 🔒 Auditoría, Seguridad y UX
21. **Cierre de Caja Diario y Cuadre para Asistente/Caja**: Herramienta de arqueo de caja física para conciliar efectivo recibido durante el día vs. sistema.
22. **Historial de Auditoría de Transacciones**: Log inalterable de quién aprobó, rechazó, modificó el monto o eliminó cualquier pago.
23. **Carga Multicomprobante en 1-Clic**: Permitir a padres con 2 o 3 hijos subir un solo comprobante de transferencia global y vincularlo a todas las mensualidades correspondientes.
24. **Firma Digital en Recibos**: Estampa con firma digital verificable de la administración en los recibos descargados.
25. **Modo Offline / PWA Sync para recepción de comprobantes**: Guardado local de comprobantes cuando el padre no tiene internet y sincronización automática al reconectar.

---
*Informe generado por el sistema Karpus Kids — Módulo de Ingeniería y Gestión Financiera.*
