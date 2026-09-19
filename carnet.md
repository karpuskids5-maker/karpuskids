# INFORME TÉCNICO Y PROPUESTA DE IMPLEMENTACIÓN: NUEVO FORMATO DE CARNET KARPUS KIDS (3.5" x 2.2")

**Fecha:** Septiembre 2024  
**Proyecto:** Sistema de Gestión Escolar Inteligente — Karpus Kids  
**Módulo:** Carnets y Credenciales Institucionales (`js/shared/carnets.module.js` & `js/shared/helpers.js`)  
**Dirigido a:** Dirección General, Equipo de TI y Diseño Gráfico  

---

## 1. RESUMEN EJECUTIVO

El presente informe detalla la factibilidad técnica, especificaciones de diseño, cálculos de maquetación y la hoja de ruta de desarrollo para migrar el sistema de generación de carnets de **Karpus Kids** desde el formato estándar CR80 (85.6 × 54.0 mm / 3.37" × 2.125") hacia el **nuevo formato extendido de 3.5 × 2.2 pulgadas (88.9 × 55.88 mm)**.

Esta actualización incrementa el área útil de la credencial en un **+7.5%**, permitiendo:
1. **Mayor legibilidad tipográfica** en datos críticos (nombre del estudiante, tutores, números de emergencia, aula y código de matrícula).
2. **Escaneo de Código QR mejorado**: Incrementa el módulo del código QR, acelerando la lectura óptica con cámaras móviles desde el panel de maestras y asistentes en el control de asistencia.
3. **Optimización Visual**: Espaciado superior para el logo institucional, bordes de seguridad micro-impresos y foto/avatar del alumno.
4. **Compatibilidad garantizada**: Mantiene el soporte de **8 carnets por página A4** en la generación masiva en PDF sin comprometer los márgenes de impresión ni las guías de corte.

---

## 2. COMPARATIVA DE DIMENSIONES Y ÁREA DE DISEÑO

| Parámetro | Formato Estándar CR80 | Nuevo Formato Ampliado | Variación / Ganancia |
| :--- | :--- | :--- | :--- |
| **Ancho (Pulgadas / mm)** | 3.370" / 85.60 mm | **3.500" / 88.90 mm** | +3.30 mm (+3.85%) |
| **Alto (Pulgadas / mm)** | 2.125" / 53.98 mm | **2.200" / 55.88 mm** | +1.90 mm (+3.52%) |
| **Relación de Aspecto** | 1.5858 (16:10 aprox.) | **1.5909 (16:10 aprox.)** | Aspecto idéntico (+0.3%) |
| **Área Total por Cara** | 4,620.72 mm² | **4,967.73 mm²** | **+347.01 mm² (+7.51%)** |
| **Matriz A4 (210×297 mm)** | 8 carnets / hoja (2×4) | **8 carnets / hoja (2×4)** | Mantiene 8 carnets/hoja |

---

## 3. CÁLCULO DE MAQUETACIÓN Y REJILLA PARA IMPRESIÓN (A4)

Para garantizar la impresión masiva en PDF mediante `jsPDF` (`carnets.module.js`), se han recalculado las coordenadas sobre una hoja A4 vertical (210 × 297 mm):

### Rejilla de Impresión (2 Columnas × 4 Filas = 8 Carnets / Hoja)
* **Ancho de Hoja (PAGE_W):** 210.00 mm
* **Alto de Hoja (PAGE_H):** 297.00 mm
* **Ancho Carnet (CARD_W):** 88.90 mm
* **Alto Carnet (CARD_H):** 55.88 mm

#### Distribución Horizontal:
* **2 columnas x 88.90 mm:** 177.80 mm de carnets.
* **Espacio restante horizontal:** $210.00 - 177.80 = 32.20\text{ mm}$
* **Distribución de márgenes y separación:**
  * Margen Izquierdo/Derecho (`MARGIN_LR`): **12.10 mm**
  * Separación entre columnas (`GAP_X`): **8.00 mm**
  * Verificación: $12.10 + 88.90 + 8.00 + 88.90 + 12.10 = 210.00\text{ mm}$  *(Exacto)*

#### Distribución Vertical:
* **4 filas x 55.88 mm:** 223.52 mm de carnets.
* **Espacio restante vertical:** $297.00 - 223.52 = 73.48\text{ mm}$
* **Distribución de márgenes y separación:**
  * Margen Superior/Inferior (`MARGIN_TB`): **26.74 mm**
  * Separación entre filas (`GAP_Y`): **6.66 mm** (3 espacios de 6.66 mm = 20.00 mm)
  * Verificación: $26.74 + (55.88 \times 4) + (6.66 \times 3) + 26.74 = 297.00\text{ mm}$  *(Exacto)*

---

## 4. IMPACTO EN EL CÓDIGO FUENTE Y ARCHIVOS A MODIFICAR

La implementación requiere actualizar las constantes geométricas e impresiones en **dos archivos principales**:

### 1. `js/shared/carnets.module.js` (Módulo PDF Masivo y Vista Previa)

#### Cambios en Constantes Globales:
```javascript
// CONSTANTES ANTERIORES (CR80)
// const CARD_W = 85.6;
// const CARD_H = 54;
// const MARGIN_TB = 8;
// const MARGIN_LR = 8;
// const GAP = 5;

// NUEVAS CONSTANTES FORMATO 3.5" x 2.2"
const CARD_W = 88.90;  // 3.5 pulgadas
const CARD_H = 55.88;  // 2.2 pulgadas
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_LR = 12.10;
const MARGIN_TB = 26.74;
const GAP_X = 8.00;
const GAP_Y = 6.66;
const COLS = 2;
const ROWS = 4;
const CARDS_PER_PAGE = COLS * ROWS;
```

#### Mejoras Visuales en el Carnet (Frente):
* **Línea Superior de Encabezado**:
  * Incremento de alto de header de `8 mm` a `8.5 mm`.
  * Tipografía principal: Aumento de fuente a `8 pt`.
* **Zona de Código QR**:
  * Ancho de zona QR expandido de `32 mm` a `34 mm`.
  * Tamaño del código QR de `24 mm` a `26 mm` (mayor contraste para escáneres).
* **Bloque de Información del Estudiante**:
  * Posición horizontal `infoX`: $X + 36\text{ mm}$.
  * Tamaño de nombre del alumno: $8\text{ pt}$ (con capacidad para nombres largos de 2 líneas).
  * Etiquetas de datos (Aula, Matrícula, Año Escolar, Tutores, Teléfonos): Tamaño de letra optimizado a $4\text{ pt}$ / $4.2\text{ pt}$.

#### Mejoras Visuales en el Carnet (Reverso):
* **Logo Central Institucional**: Tamaño incrementado de `14×14 mm` a `16×16 mm`.
* **Líneas de Contacto e Información**: Rediseño de bloques para incluir dirección, teléfonos, correo institucional y redes sociales con espaciado vertical de `3.8 mm`.

---

### 2. `js/shared/helpers.js` (`getStaffCarnetTemplate`)

Este método genera la plantilla HTML/CSS para imprimir credenciales individuales de personal (Maestras, Asistentes, Directora).

#### Actualización CSS `@page` y `.carnet`:
```css
@page {
  size: 3.5in 2.2in; /* 88.9mm x 55.88mm */
  margin: 0;
}

.carnet {
  width: 3.5in;  /* 88.9mm */
  height: 2.2in; /* 55.88mm */
  background: #ffffff;
  position: relative;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(0,0,0,0.1);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
```

---

## 5. PLAN DE PRUEBAS Y VERIFICACIÓN

Para verificar la correcta aplicación del formato, se seguirán los siguientes pasos:

1. **Verificación de Renderizado HTML/CSS**:
   - Abrir el modal de impresión de carnets desde el panel de Directora (`panel_directora.html`) o Asistente (`panel_asistente.html`).
   - Comprobar que el iframe de vista previa renderice las dimensiones de $3.5" \times 2.2"$ sin cortes horizontales ni desbordamientos.

2. **Generación e Inspección de PDF**:
   - Generar lote de carnets y verificar el PDF descargado en Adobe Acrobat / Visor PDF.
   - Confirmar las guías de corte en las esquinas y la alineación en la cuadrícula de $2 \times 4$ elementos en hoja A4.

3. **Prueba de Escaneo de QR de Asistencia**:
   - Escanear el código QR directamente desde el PDF o impreso en papel/PVC utilizando la cámara de registro de asistencia en el panel de la maestra.
   - Confirmar un tiempo de respuesta de lectura inferior a 500 ms.

---

## 6. CONCLUSIÓN Y RECOMENDACIÓN

El cambio al formato **3.5" × 2.2"** representa una mejora sustancial en la presentación gráfica y la calidad funcional del carnet escolar de **Karpus Kids**. Al mantener la matriz de 8 carnets por hoja A4, la solución no incrementa los costos de insumos de impresión y optimiza el uso de la superficie del PVC.

Se recomienda proceder con la actualización directa en los componentes compartidos (`carnets.module.js` y `helpers.js`).
