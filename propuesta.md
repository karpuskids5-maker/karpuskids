
h # INFORME TÉCNICO Y ESTRATÉGICO

## SISTEMA MENSUAL DE EVALUACIÓN DE CALIDAD DE KARPUS KIDS

### 1. RESUMEN EJECUTIVO

El presente informe establece el diseño funcional y estratégico del **Sistema Mensual de Evaluación de Calidad de Karpus Kids**, cuyo propósito es convertir la opinión de los padres y tutores en una herramienta permanente de medición, seguimiento y mejora de la calidad del servicio ofrecido por la estancia infantil.

El sistema permitirá evaluar periódicamente dos áreas principales:

* **Desempeño de las docentes y personal de aula.**
* **Calidad general de los servicios e instalaciones de Karpus Kids.**

La evaluación será **automática, recurrente y estructurada**, iniciándose el **día 1 de cada mes** y correspondiente al servicio recibido durante el mes anterior.

El sistema permitirá a la Dirección consultar resultados actuales e históricos, identificar tendencias, detectar áreas de mejora y dar seguimiento a situaciones recurrentes.

La propuesta elimina cualquier sistema de puntos, premios, descuentos o recompensas por responder, priorizando que la participación sea producto de la confianza del padre en el proceso de evaluación y de su interés en contribuir a la mejora de la institución.

---

# 2. OBJETIVOS DEL SISTEMA

### 2.1 Objetivo general

Implementar un mecanismo mensual de evaluación que permita a Karpus Kids medir de manera estructurada la percepción de las familias sobre la calidad del servicio y utilizar dicha información para establecer acciones de mejora.

### 2.2 Objetivos específicos

1. Medir mensualmente la satisfacción de los padres y tutores.
2. Evaluar el desempeño percibido de las docentes.
3. Evaluar la calidad general de la estancia.
4. Identificar problemas recurrentes.
5. Detectar cambios significativos respecto a meses anteriores.
6. Facilitar la toma de decisiones de la Dirección.
7. Crear un historial de indicadores de calidad.
8. Dar seguimiento a las acciones de mejora implementadas.
9. Mantener un proceso de evaluación sencillo y rápido para las familias.
10. Generar informes mensuales para la Dirección.

---

# 3. CICLO MENSUAL DE EVALUACIÓN

El sistema funcionará mediante un ciclo automático mensual.

### Día 1 de cada mes

El sistema crea automáticamente un nuevo período de evaluación.

Por ejemplo:

**1 de octubre de 2026**

Se activa la evaluación correspondiente al período:

**Septiembre 2026**

El padre podrá acceder desde su Panel de Padres mediante un aviso destacado:

> **Evaluación mensual de Karpus Kids**
>
> Tu opinión sobre el servicio recibido durante septiembre nos ayuda a identificar oportunidades de mejora.
>
> **Tiempo estimado: 2 minutos**
>
> [Evaluar ahora]

### Durante el mes

El padre podrá completar la evaluación una sola vez por período correspondiente al estudiante.

Una vez completada:

* La encuesta queda registrada.
* El sistema marca la evaluación como completada.
* El aviso principal desaparece.
* Se conserva el registro histórico.

### Final del período

El sistema deja de aceptar evaluaciones correspondientes a ese período cuando finalice el ciclo establecido por la Dirección.

Posteriormente, el sistema prepara los datos para el análisis mensual.

---

# 4. ACTIVACIÓN AUTOMÁTICA

La activación deberá realizarse mediante una tarea programada en el backend.

### Regla principal

```text
Día = 1
        ↓
Crear nuevo período de evaluación
        ↓
Determinar mes evaluado
        ↓
Activar encuesta para las familias
        ↓
Mostrar evaluación en Panel de Padres
```

Ejemplo:

| Fecha de activación | Período evaluado |
| ------------------- | ---------------- |
| 1 enero             | Diciembre        |
| 1 febrero           | Enero            |
| 1 marzo             | Febrero          |
| 1 abril             | Marzo            |
| 1 mayo              | Abril            |
| 1 junio             | Mayo             |
| 1 julio             | Junio            |
| 1 agosto            | Julio            |
| 1 septiembre        | Agosto           |
| 1 octubre           | Septiembre       |
| 1 noviembre         | Octubre          |
| 1 diciembre         | Noviembre        |

Esto permite que cada evaluación represente una experiencia ya vivida por la familia.

---

# 5. EXPERIENCIA EN EL PANEL DE PADRES

La evaluación debe aparecer de forma visible, pero sin resultar invasiva.

### Banner principal

El Panel de Padres mostrará:

**EVALUACIÓN MENSUAL**

> ¿Cómo fue nuestra atención durante septiembre?

> Tu opinión nos ayuda a seguir mejorando la experiencia de tu hijo/a.

**⏱ Menos de 2 minutos**

**[Realizar evaluación]**

### Estado completado

Cuando el padre termine:

> ✓ Evaluación completada
>
> Gracias por compartir tu experiencia con Karpus Kids.

El sistema no deberá volver a solicitar la misma evaluación.

---

# 6. ESTRUCTURA DE LA EVALUACIÓN

La encuesta estará dividida en dos bloques principales.

## BLOQUE A — EVALUACIÓN DE LA DOCENTE

La evaluación deberá centrarse en comportamientos y aspectos observables.

### 1. Atención al estudiante

¿Cómo valoras el trato y la atención brindada a tu hijo/a?

**1 — Muy deficiente**
**2 — Deficiente**
**3 — Aceptable**
**4 — Bueno**
**5 — Excelente**

### 2. Comunicación con la familia

¿Cómo valoras la comunicación de la docente con los padres o tutores?

**1 — Muy deficiente**
**2 — Deficiente**
**3 — Aceptable**
**4 — Bueno**
**5 — Excelente**

### 3. Seguimiento del estudiante

¿Cómo valoras el seguimiento realizado sobre las necesidades y actividades de tu hijo/a?

**1 — Muy deficiente**
**2 — Deficiente**
**3 — Aceptable**
**4 — Bueno**
**5 — Excelente**

### 4. Organización y responsabilidad

¿Cómo valoras la organización y responsabilidad observada durante el mes?

**1 — Muy deficiente**
**2 — Deficiente**
**3 — Aceptable**
**4 — Bueno**
**5 — Excelente**

### 5. Comentario sobre la docente

> ¿Qué consideras que la docente podría mejorar?

Campo de texto opcional.

---

# 7. BLOQUE B — EVALUACIÓN GENERAL DE KARPUS KIDS

### 1. Limpieza

¿Cómo valoras la limpieza de las instalaciones?

### 2. Seguridad

¿Cómo valoras las medidas de seguridad y control de salida de los estudiantes?

### 3. Alimentación

¿Cómo valoras la calidad y variedad de los alimentos ofrecidos?

### 4. Atención administrativa

¿Cómo valoras la atención recibida por parte de la administración?

### 5. Comunicación institucional

¿Cómo valoras la comunicación general de Karpus Kids con las familias?

### 6. Instalaciones

¿Cómo valoras las condiciones generales de las instalaciones?

Todas las preguntas utilizarán la misma escala:

**1 — Muy deficiente**
**2 — Deficiente**
**3 — Aceptable**
**4 — Bueno**
**5 — Excelente**

### Comentario general

> ¿Qué aspecto de Karpus Kids consideras que deberíamos mejorar?

Campo de texto opcional.

---

# 8. EVALUACIÓN GENERAL DEL MES

Al finalizar la encuesta se incluirá una pregunta global:

### ¿Cómo valorarías tu experiencia general con Karpus Kids durante este mes?

⭐ 1 — Muy insatisfecho
⭐⭐ 2 — Insatisfecho
⭐⭐⭐ 3 — Neutral
⭐⭐⭐⭐ 4 — Satisfecho
⭐⭐⭐⭐⭐ 5 — Muy satisfecho

Esta puntuación servirá como **Indicador General de Satisfacción Mensual (IGSM)**.

---

# 9. MODELO DE ANÁLISIS

El sistema no debe limitarse a calcular un promedio.

Se recomienda generar cuatro indicadores principales:

### 9.1 Índice de satisfacción general

Promedio de las evaluaciones generales.

### 9.2 Índice de desempeño docente

Promedio de las preguntas relacionadas con:

* Atención.
* Comunicación.
* Seguimiento.
* Organización.

### 9.3 Índice de calidad institucional

Promedio de:

* Limpieza.
* Seguridad.
* Alimentación.
* Administración.
* Comunicación.
* Instalaciones.

### 9.4 Tasa de participación

Porcentaje de familias que completaron la evaluación.

```text
Tasa de participación =
Evaluaciones completadas / Familias habilitadas × 100
```

---

# 10. PANEL DE DIRECCIÓN

La Dirección contará con una sección denominada:

## Evaluaciones Mensuales

Esta sección tendrá una vista ejecutiva del estado de la institución.

### Indicadores principales

**Satisfacción general**

4.6 / 5

**Desempeño docente**

4.5 / 5

**Calidad institucional**

4.4 / 5

**Participación**

78%

Estos valores son solamente ejemplos visuales.

---

# 11. ANÁLISIS DE DOCENTES

En lugar de utilizar únicamente un ranking, el sistema mostrará una matriz de desempeño.

| Docente   | Atención | Comunicación | Seguimiento | Organización | Promedio |
| --------- | -------: | -----------: | ----------: | -----------: | -------: |
| Docente A |      4.8 |          4.6 |         4.7 |          4.8 |     4.73 |
| Docente B |      4.5 |          4.2 |         4.6 |          4.4 |     4.43 |
| Docente C |      4.7 |          4.8 |         4.5 |          4.6 |     4.65 |

La Dirección podrá seleccionar una docente para consultar su evolución histórica.

### Importante

El sistema no deberá interpretar automáticamente una puntuación baja como una deficiencia profesional.

Una puntuación baja deberá generar una:

**"Alerta de revisión"**

La Dirección podrá posteriormente revisar:

* Comentarios.
* Tendencia histórica.
* Cantidad de respuestas.
* Situaciones reportadas.
* Comparación con períodos anteriores.

---

# 12. SISTEMA DE ALERTAS

El sistema generará alertas cuando se detecten cambios relevantes.

### Alerta de descenso

Ejemplo:

> **Alerta de seguimiento**
>
> La puntuación de comunicación de una docente disminuyó significativamente respecto al período anterior.
>
> Se recomienda revisar los comentarios asociados antes de tomar cualquier acción.

### Alerta de problema recurrente

Si múltiples familias reportan una situación similar:

> **Problema recurrente detectado**
>
> Se han recibido varias observaciones relacionadas con el proceso de salida durante el período evaluado.

La Dirección podrá marcar el problema como:

* Pendiente.
* En revisión.
* En proceso de solución.
* Solucionado.

---

# 13. ANÁLISIS DE COMENTARIOS

Los comentarios podrán clasificarse automáticamente en categorías para facilitar el análisis.

### Posibles categorías

* Comunicación.
* Alimentación.
* Seguridad.
* Limpieza.
* Docentes.
* Actividades.
* Instalaciones.
* Horarios.
* Entrega y salida.
* Atención administrativa.
* Otros.

El sistema podrá identificar la frecuencia de cada categoría.

Ejemplo:

**Principales temas mencionados**

1. Comunicación — 14 comentarios.
2. Alimentación — 9 comentarios.
3. Salida de estudiantes — 6 comentarios.

Esto permitirá a la Dirección identificar dónde concentrar esfuerzos.

---

# 14. ANÁLISIS DE TENDENCIAS

El sistema almacenará los resultados de cada período para permitir comparaciones.

Ejemplo:

| Mes     | Satisfacción | Docentes | Institución |
| ------- | -----------: | -------: | ----------: |
| Enero   |          4.2 |      4.3 |         4.1 |
| Febrero |          4.3 |      4.4 |         4.2 |
| Marzo   |          4.5 |      4.6 |         4.4 |
| Abril   |          4.4 |      4.5 |         4.3 |

La Dirección podrá identificar:

* Mejoras.
* Descensos.
* Problemas persistentes.
* Cambios repentinos.
* Áreas estables.

---

# 15. SEGUIMIENTO DE MEJORAS

Esta será una de las funciones más importantes del sistema.

Cuando la Dirección identifique un problema podrá crear una acción de mejora.

### Ejemplo

**Problema detectado:**

Comentarios relacionados con retrasos durante la salida.

**Acción:**

Revisar protocolo de salida.

**Responsable:**

Dirección.

**Estado:**

En proceso.

**Fecha:**

Octubre 2026.

Posteriormente se podrá comprobar si la evaluación del siguiente mes refleja una mejora.

De esta manera, el sistema no solamente recopila opiniones, sino que permite comprobar si las acciones realizadas producen cambios.

---

# 16. PRIVACIDAD Y CONFIDENCIALIDAD

La información deberá manejarse respetando la privacidad de las familias.

Se recomienda separar:

* Identidad del padre/tutor.
* Identidad del estudiante.
* Evaluación.
* Comentario.

La Dirección podrá consultar información individual cuando sea necesario para atender una situación, pero los indicadores generales deberán presentarse de forma agregada.

También podrá existir una opción:

**"Deseo enviar este comentario de forma anónima."**

En ese caso, el comentario podrá utilizarse para análisis institucional sin mostrar públicamente la identidad del padre.

---

# 17. ELIMINACIÓN DE RECOMPENSAS Y GAMIFICACIÓN

Se elimina completamente del sistema:

* Puntos.
* Cupones.
* Descuentos.
* Premios.
* Programa de embajadores asociado a la encuesta.
* Incentivos económicos.
* Recompensas por responder.

La evaluación deberá presentarse como una herramienta formal de participación de las familias y mejora institucional.

La estrategia para aumentar la participación será mejorar:

* La facilidad de uso.
* La duración de la encuesta.
* La claridad de las preguntas.
* Los recordatorios.
* La comunicación del propósito de la evaluación.
* La confianza en el uso de los resultados.

---

# 18. RECORDATORIOS AUTOMÁTICOS

Para aumentar la participación sin utilizar recompensas, el sistema podrá utilizar recordatorios.

### Día 1

Primera notificación:

> La evaluación mensual de Karpus Kids ya está disponible.

### Día 7

Recordatorio para familias pendientes.

### Día 15

Segundo recordatorio.

### Día 25

Último recordatorio.

Las familias que ya completaron la encuesta no recibirán nuevos recordatorios.

---

# 19. INFORME MENSUAL PARA DIRECCIÓN

Al finalizar cada período, el sistema podrá generar un informe con:

### Resumen ejecutivo

* Número de familias evaluadas.
* Número de respuestas.
* Porcentaje de participación.
* Satisfacción general.
* Desempeño docente.
* Calidad institucional.

### Principales fortalezas

Aspectos con mejores resultados.

### Principales oportunidades de mejora

Aspectos con puntuaciones inferiores o problemas recurrentes.

### Comentarios destacados

Comentarios relevantes de las familias.

### Evolución

Comparación con meses anteriores.

### Acciones recomendadas

Situaciones que requieren seguimiento por parte de la Dirección.

---

# 20. ARQUITECTURA FUNCIONAL PROPUESTA

El sistema estará compuesto por:

### Módulo 1 — Períodos de evaluación

Controlará:

* Mes evaluado.
* Fecha de apertura.
* Fecha de cierre.
* Estado.
* Cantidad de respuestas.

### Módulo 2 — Encuestas

Gestionará las preguntas correspondientes a cada período.

### Módulo 3 — Respuestas

Almacenará:

* Padre/tutor.
* Estudiante.
* Docente.
* Período.
* Pregunta.
* Respuesta.
* Comentario.
* Fecha.

### Módulo 4 — Analítica

Calculará:

* Promedios.
* Indicadores.
* Tendencias.
* Participación.
* Alertas.
* Categorías de comentarios.

### Módulo 5 — Panel de Dirección

Permitirá visualizar y administrar los resultados.

### Módulo 6 — Notificaciones

Controlará:

* Activación.
* Recordatorios.
* Confirmaciones.
* Cierre del período.

---

# 21. AUTOMATIZACIÓN DEL SISTEMA

La automatización deberá ejecutarse mediante una función programada en el backend.

### Proceso diario

El sistema comprobará:

```text
¿Es día 1?
       ↓
     SÍ
       ↓
Crear período mensual
       ↓
Activar evaluaciones
       ↓
Notificar a las familias
```

También deberá comprobar diariamente:

```text
¿Existen familias pendientes?
       ↓
     SÍ
       ↓
¿Corresponde enviar recordatorio?
       ↓
     SÍ
       ↓
Enviar notificación
```

Esto permitirá que el sistema funcione automáticamente sin intervención manual de la Dirección.

---

# 22. FASES DE IMPLEMENTACIÓN

### FASE 1 — Base de datos

Crear las estructuras necesarias para:

* Períodos.
* Encuestas.
* Preguntas.
* Respuestas.
* Comentarios.
* Docentes.
* Estudiantes.
* Acciones de mejora.

### FASE 2 — Activación automática

Implementar el proceso que abre automáticamente la evaluación el día 1 de cada mes.

### FASE 3 — Panel de Padres

Implementar:

* Banner.
* Encuesta.
* Progreso.
* Confirmación.
* Estado completado.

### FASE 4 — Panel de Dirección

Implementar:

* Indicadores.
* Gráficos.
* Matriz docente.
* Tendencias.
* Comentarios.
* Alertas.
* Seguimiento de acciones.

### FASE 5 — Notificaciones

Implementar los recordatorios automáticos.

### FASE 6 — Reportes

Implementar generación de informes mensuales en PDF y Excel.

### FASE 7 — Pruebas

Realizar pruebas de:

* Activación mensual.
* Restricción de respuestas duplicadas.
* Cálculo de indicadores.
* Recordatorios.
* Privacidad.
* Historial.
* Cierre de períodos.

---

# 23. RESULTADO ESPERADO

El resultado será un sistema de evaluación institucional que funcione de manera continua y automática.

Cada mes:

**Día 1**

→ Se abre una nueva evaluación.

**Durante el mes**

→ Las familias responden.

**Automáticamente**

→ El sistema recopila y analiza la información.

**Dirección**

→ Consulta resultados, comentarios, tendencias y alertas.

**Se identifican oportunidades de mejora**

→ Se crean acciones correctivas.

**Mes siguiente**

→ Se vuelve a medir.

De esta manera, Karpus Kids podrá construir un **historial permanente de calidad y satisfacción**, utilizando la información de las familias como una fuente de retroalimentación para la mejora continua de sus servicios.
