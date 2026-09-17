# INFORME COMPARATIVO DETALLADO: FORMATO ACTUAL (CR80) vs. NUEVO FORMATO (3.5" x 2.2")

**Proyecto:** Sistema de Gestión Escolar Inteligente — Karpus Kids
**Módulo:** Carnets y Credenciales Institucionales (`js/shared/carnets.module.js` & `js/shared/helpers.js`)
**Dirigido a:** Dirección General, Administración y Equipo Técnico

---

## 1. RESUMEN Y ESPECIFICACIONES TÉCNICAS

El sistema actual de Karpus Kids utiliza el **formato estándar internacional de tarjeta de crédito (CR80)**, fabricado en PVC o impreso en papel/hoja A4 para plastificación. Se analiza la propuesta de migrar al formato extendido de **3.5" × 2.2" (88.9 mm × 55.88 mm)**.

### Tabla Comparativa Dimensiones Base:

| Parámetro | Formato Actual (CR80) | Nuevo Formato Ampliado | Diferencia Absoluta | Diferencia % |
| :--- | :--- | :--- | :--- | :--- |
| **Ancho (Pulgadas)** | **3.370"** (3 ³/₈") | **3.500"** (3 ¹/₂") | +0.130" | +3.85% |
| **Ancho (Milímetros)** | **85.60 mm** | **88.90 mm** | +3.30 mm | +3.85% |
| **Alto (Pulgadas)** | **2.125"** (2 ¹/₈") | **2.200"** (2 ¹/₅") | +0.075" | +3.52% |
| **Alto (Milímetros)** | **54.00 mm** | **55.88 mm** | +1.88 mm | +3.52% |
| **Área Total (por cara)** | **4,622.40 mm²** | **4,967.73 mm²** | **+345.33 mm²** | **+7.47%** |
| **Relación de Aspecto** | 1.585 : 1 | 1.590 : 1 | Prácticamente idéntica | +0.3% |
| **Matriz en Hoja A4** | **8 carnets / hoja (2×4)** | **8 carnets / hoja (2×4)** | Sin cambio en papel | 0% diferencia |

---

## 2. ANÁLISIS DETALLADO DEL FORMATO ACTUAL (CR80: 3.37" × 2.125" / 85.6 × 54 mm)

El formato **CR80** es el estándar global para tarjetas de crédito, licencias de conducir y carnets de identificación en PVC.

### 🟢 BENEFICIOS Y VENTAJAS DEL FORMATO ACTUAL (CR80)

1. **Compatibilidad Estándar Universal (Portatarjetas y Carteras)**:
   * Encaja perfectamente en cualquier porta-carnet rígido, funda plástica estándar, billetera, portacredenciales colgantes o clips de solapa disponibles en el mercado.
2. **Compatibilidad con Impresoras de Tarjetas PVC**:
   * Es el estándar nativo que aceptan el 100% de las impresoras térmicas y de sublimación de tarjetas PVC (Fargo, Zebra, Evolis, Datacard).
3. **Ergonomía Estándar**:
   * Es el tamaño con el que el público general, padres y maestras están más familiarizados al manipular tarjetas cotidianas.
4. **Costo de Insumos Precut (Tarjetas PVC Blancas)**:
   * Las tarjetas PVC en blanco prepagadas/cortadas vienen de fábrica exclusivamente en tamaño CR80 (85.6 × 54 mm).

### 🔴 DESVENTAJAS DEL FORMATO ACTUAL (CR80)

1. **Espacio Reducido para Múltiples Datos**:
   * Al requerir incluir el código QR institucional, logo, foto/avatar, nombre completo del alumno, aula, matrícula, tutores y números de emergencia, la tipografía debe reducirse a **3 pt - 3.5 pt**, dificultando la lectura para algunas personas.
2. **Tamaño Limitado del Código QR**:
   * El código QR debe mantenerse en un tamaño máximo de **22 mm - 24 mm**, lo que puede reducir el margen de tolerancia cuando cámaras de teléfonos celulares de gama baja escanean la asistencia con poca luz.
3. **Saturación Visual**:
   * Los márgenes internos son muy reducidos (alrededor de 1.5 mm a 2 mm), lo que produce una sensación de sobrecarga de texto.

---

## 3. ANÁLISIS DETALLADO DEL NUEVO FORMATO (3.5" × 2.2" / 88.9 × 55.88 mm)

El nuevo formato de **3.5" × 2.2"** ofrece un área extendida que mejora la distribución tipográfica y gráfica.

### 🟢 BENEFICIOS Y VENTAJAS DEL NUEVO FORMATO (3.5" × 2.2")

1. **+7.5% de Área Útil Incremental (+345 mm²)**:
   * Permite aumentar el tamaño del texto del alumno a **8 pt / 9 pt** (negrita) y el de los tutores/teléfonos a **4.5 pt / 5 pt**, mejorando significativamente la legibilidad.
2. **Mayor Tamaño y Velocidad del Código QR**:
   * Permite aumentar el código QR a **26 mm - 28 mm**. Un QR de mayor módulo se escanea hasta un **30% más rápido** en la recepción y aulas.
3. **Mantiene Rendimiento de Impresión en A4 (8 Carnets / Hoja)**:
   * Al calcular la rejilla en hoja A4 (210 × 297 mm), entran exactamente **8 carnets por hoja (2 columnas × 4 filas)** con márgenes cómodos de 12.1 mm a los lados y 26.7 mm arriba/abajo. No aumenta el costo de hojas o guillotina.
4. **Diseño Visual Más Limpio y Profesional**:
   * Aumenta el aire/respiro entre elementos (logo, badges de aula, estatus activo/inactivo y datos institucionales del reverso).

### 🔴 DESVENTAJAS DEL NUEVO FORMATO (3.5" × 2.2")

1. **Incompatibilidad con Impresoras Térmicas Directas de PVC**:
   * Las impresoras dedicadas de tarjetas PVC (ej. Zebra ZXP, Evolis Primacy) están diseñadas con alimentadores rígidos fijos para CR80 (85.6 mm). No aceptan tarjetas PVC precortadas de 88.9 mm.
2. **Fundas y Porta-Carnets Rígidos Ajustados**:
   * Los porta-carnets de acrílico rígido diseñados para tarjetas de crédito (CR80) no permiten introducir una tarjeta de 88.9 mm (se pasa por 3.3 mm de ancho). Requiere usar fundas plásticas blandas o tipo sobre (pouch) de $3.5" \times 2.25"$.
3. **Recorte Manual o Guillotina Obligatorio**:
   * Si se imprime en papel/laminado PVC fotográfico en hoja A4, requiere corte con guillotina ajustada a la medida customizada de 88.9 × 55.88 mm.

---

## 4. CUADRO COMPARATIVO RESUMEN

| Criterio de Evaluación | Formato Actual (CR80: 3.37" × 2.125") | Nuevo Formato (3.5" × 2.2") | Ganador |
| :--- | :--- | :--- | :--- |
| **Legibilidad de Texto** | Aceptable (fuente 3pt - 3.5pt) | **Excelente (fuente 4.5pt - 8pt)** | 🏆 **3.5" × 2.2"** |
| **Efectividad del Código QR** | Buena (22-24mm) | **Superior (26-28mm, lectura ultra rápida)** | 🏆 **3.5" × 2.2"** |
| **Rendimiento Papel A4** | 8 carnets por hoja | 8 carnets por hoja | 🤝 **Empate** |
| **Compatibilidad Billeteras** | 100% Ajuste estándar | Ajuste estándar / ajustado | 🏆 **CR80** |
| **Compatibilidad Impresoras PVC**| Compatible directo | Requiere hojas A4 laminadas / Pouch | 🏆 **CR80** |
| **Uso de Fundas / Porta-carnet** | Fundas rígidas estándar CR80 | Fundas flexibles / sobre | 🏆 **CR80** |
| **Estética y Jerarquía Visual** | Compacto | **Espacioso y equilibrado** | 🏆 **3.5" × 2.2"** |

---

## 5. CONCLUSIÓN Y RECOMENDACIÓN FINAL

1. **Si Karpus Kids imprime en Hojas A4 + Plastificado / Laminado de Pouch**:
   * **Recomendación:** **Adopta el Nuevo Formato 3.5" × 2.2"**. Es la mejor opción ya que el rendimiento por hoja A4 sigue siendo de **8 carnets**, mejora drásticamente la legibilidad y la lectura del QR de asistencia no falla con teléfonos móviles.

2. **Si Karpus Kids utiliza una Impresora Térmica Directa de Tarjetas de PVC Rígido**:
   * **Recomendación:** **Manten el Formato Actual CR80 (85.6 × 54 mm)** debido a las limitaciones físicas de los alimentadores de plástico de las impresoras de sublimación.
