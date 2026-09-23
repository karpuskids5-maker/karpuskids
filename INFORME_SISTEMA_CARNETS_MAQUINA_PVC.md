# INFORME TÉCNICO Y GUÍA OPERATIVA: MEJORA DEL SISTEMA DE GENERACIÓN DE CARNETS Y OPTIMIZACIÓN PARA MÁQUINAS DE PVC Y CONVERSIÓN PDF A JPG

**Fecha:** Septiembre 2024 / Actualizado
**Proyecto:** Sistema Inteligente de Gestión Escolar — Karpus Kids
**Módulo:** Módulo de Carnets e Identificaciones (`js/shared/carnets.module.js` & `js/shared/helpers.js`)
**Dirigido a:** Dirección General, Equipo Informático, Operadores de Impresión de Credenciales

---

## 1. RESUMEN EJECUTIVO

Atendiendo a la solicitud de optimización para la producción física e impresión industrial de credenciales en máquinas de carnets PVC (tales como impresoras **Evolis, Zebra, Fargo, Datacard o Badgy**), se ha actualizado y potenciado el sistema de generación de carnets de **Karpus Kids**.

La nueva funcionalidad permite que **cada carnet se genere en una sola hoja independiente conteniendo sus dos caras (Frente + Reverso)** de forma perfectamente alineada. Esta arquitectura resuelve la necesidad de convertir de forma directa e inmediata cada página del archivo **PDF a formato JPG/PNG**, permitiendo que los softwares propietarios de las máquinas impresoras de credenciales lean y procesen el carnet de cada estudiante en un flujo automático cara a cara (Dúplex).

---

## 2. MODOS DE MAQUETACIÓN E IMPRESIÓN DISPONIBLES

El módulo cuenta ahora con **tres (3) opciones de maquetación** seleccionables directamente desde el panel de control antes de la generación:

### 📄 Opción A: "1 Carnet por Hoja (Frente + Reverso) · Ideal Máquina PVC / JPG" *(RECOMENDADA)*
* **Formato de Hoja:** A4 / Carta Vertical.
* **Distribución:**
  * **Sección Superior:** Frente del Carnet (3.5" × 2.2" / 88.9 × 55.88 mm) con marcas de corte de alta precisión.
  * **Sección Inferior:** Reverso del Carnet (3.5" × 2.2" / 88.9 × 55.88 mm) con marcas de corte.
* **Propósito Principal:** Diseñado para exportación/conversión rápida a **JPG/PNG** a 300 DPI. Cada página representa 1 alumno completo.

### 🖼️ Opción B: "1 Carnet por Hoja (Lado a Lado) · Panorámico"
* **Formato de Hoja:** A4 / Carta Horizontal (Landscape).
* **Distribución:** Frente a la izquierda, Reverso a la derecha en la misma fila con separación de 16 mm.
* **Propósito Principal:** Ideal para visualización rápida en pantalla, auditoría o corte doble con doblado central.

### 📑 Opción C: "Pliego A4 Masivo (8 carnets por hoja)"
* **Formato de Hoja:** A4 Vertical (210 × 297 mm).
* **Distribución:** Matriz de 2 columnas × 4 filas (8 frentes en hojas impares, 8 reversos coincidentes en hojas pares).
* **Propósito Principal:** Impresión masiva en papel fotográfico / PVC adhesivo para corte manual con guillotina o troqueladora A4.

---

## 3. ESPECIFICACIONES TÉCNICAS DEL CARNET (FORMATO 3.5" × 2.2")

| Parámetro | Especificación Técnica |
| :--- | :--- |
| **Dimensiones Físicas** | **3.50" × 2.20"** (88.90 mm × 55.88 mm) |
| **Relación de Aspecto** | 1.5909 (Proporción estándar PVC CR80 ampliado +7.5% área útil) |
| **Resolución de Renderizado** | Vectores nativos jsPDF a 300 DPI equivalentes |
| **Código QR** | Módulo de 26 mm con Logo Institucional 'KK' / Karpus Kids en el centro |
| **Seguridad Física** | Micro-texto perimetral de seguridad `KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL` |
| **Marca de Agua** | Logo translúcido al 4% de opacidad en fondo del carnet |

---

## 4. FLUJO OPERATIVO: DE PDF A JPG Y LECTURA EN MÁQUINA IMPRESORA DE PVC

Para procesar los carnets en la máquina de impresión de credenciales PVC, siga este procedimiento paso a paso:

```
[Panel de Control Karpus Kids]
       │
       ▼
1. Seleccionar "1 Carnet por Hoja (Frente + Reverso)"
       │
       ▼
2. Clic en "Generar Carnets" -> Se descarga `carnet-individual-karpus-TIMESTAMP.pdf`
       │
       ▼
3. Convertir PDF a JPG (300 DPI) usando Conversor
       │
       ▼
4. Importar JPG a Software de Máquina PVC (CardPresso, Zebra Designer, Badgy, etc.)
       │
       ▼
5. Impresión Dúplex Térmica o Sublimación en Credencial PVC
```

### Herramientas Recomendadas para Convertir PDF a JPG:

1. **Herramientas en Línea (Gratuitas):**
   * [PDF2JPG.net](https://pdf2jpg.net) (Seleccionar calidad: 300 DPI).
   * [ILovePDF - PDF a JPG](https://www.ilovepdf.com/es/pdf_a_jpg) (Extraer páginas a JPG de alta resolución).

2. **Herramientas de Escritorio / Software de Diseño:**
   * **Adobe Acrobat Pro:** `Archivo -> Exportar a -> Imagen -> JPEG` (Calidad Alta / 300 DPI).
   * **Photoshop / Illustrator:** Abrir el PDF e importar páginas a 300 DPI en color CMYK / RGB.
   * **Línea de Comandos (Linux / Mac):**
     ```bash
     pdftoppm -jpeg -r 300 carnet-individual-karpus.pdf pagina_carnet
     ```

---

## 5. MEJORAS REALIZADAS EN EL CÓDIGO FUENTE

Se actualizó el archivo principal de generación de credenciales `js/shared/carnets.module.js`:

1. **Nuevo Selector UI de Maquetación (`#carnetLayoutMode`):**
   Permite al administrador seleccionar el modo de maquetación deseado antes de presionar el botón de generación.

2. **Implementación de `_generatePDFSingleCardStacked(students)`:**
   Genera una hoja individual por cada alumno con su frente centrado en la parte superior y su reverso centrado en la parte inferior, con marcas de corte milimétricas y etiquetas indicadoras.

3. **Implementación de `_generatePDFSingleCardSide(students)`:**
   Genera una hoja horizontal panorámica con el frente a la izquierda y el reverso a la derecha.

4. **Actualización Dinámica de Contadores y Resumen:**
   El estimador del modal actualiza dinámicamente la descripción del archivo según la opción seleccionada.

---

## 6. CONCLUSIÓN Y RECOMENDACIONES

Con esta actualización, el sistema de generación de carnets de **Karpus Kids** queda 100% acondicionado para los estándares de producción de credenciales institucionales en PVC.

Se recomienda utilizar la opción **"1 Carnet por Hoja (Frente + Reverso)"** como predeterminada cuando se vaya a trabajar con impresoras térmicas de PVC o al convertir las imágenes a JPG para la máquina de credenciales.
