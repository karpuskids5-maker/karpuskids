# Informe de Funcionamiento y Ruta a Producción: Panel de la Maestra — Karpus Kids

Este informe detalla el estado actual del panel diseñado para las docentes, su flujo de operación profesional y los puntos clave necesarios para garantizar un lanzamiento exitoso a producción.

## 1. Funcionamiento por Secciones

### A. Dashboard Principal (Mis Clases)
*   **Funcionamiento:** Es el centro de mando inicial. Muestra estadísticas dinámicas (Mis Clases, Total Alumnos, Incidentes Hoy, Asistencia Hoy).
*   **Flujo:** La maestra ve tarjetas de sus aulas asignadas. Cada tarjeta muestra una barra de progreso que indica el avance del día. Al hacer clic, entra al detalle profundo del aula.

### B. Muro de Aula (Feed)
*   **Funcionamiento:** Una red social privada. Permite publicar textos, fotos y videos.
*   **Interacción:** Los padres pueden reaccionar con emojis (👍, ❤️, 😂) y comentar. La maestra tiene el control de las publicaciones y puede ver quién ha interactuado.
*   **Técnico:** Utiliza Supabase Storage para los archivos y suscripciones en tiempo real para las reacciones.

### C. Rutina Diaria (Módulo de Cuidado)
*   **Funcionamiento:** Es la sección más usada. Permite registrar tres estados clave: **Ánimo** (Feliz, Triste, etc.), **Comida** (Todo, Poco, Nada) y **Siesta** (Si/No).
*   **Innovación:** Implementa **Auto-Guardado**. Al cambiar una opción o terminar de escribir una nota, el sistema guarda automáticamente (evento *blur* o *click*), evitando que la maestra pierda información si se distrae.

### D. Control de Asistencia
*   **Funcionamiento:** Lista de alumnos con botones de un solo clic para marcar: *Presente, Ausente o Tardanza*.
*   **Impacto:** Al guardar, se disparan notificaciones automáticas que tranquilizan al padre al confirmar que su hijo llegó con bien.

### E. Gestión de Tareas y Calificaciones
*   **Funcionamiento:** Permite publicar tareas con archivos adjuntos y fecha de vencimiento.
*   **Calificación Profesional:** La maestra califica las entregas usando un sistema dual de **letras (A, B, C)** para el desempeño y **estrellas (1 a 5)** para el esfuerzo.

### F. Centro de Comunicación (Chat)
*   **Funcionamiento:** Chat estilo corporativo (Teams) que separa las conversaciones con la **Dirección** de las conversaciones con las **Familias**.
*   **Seguridad:** Filtra automáticamente los contactos para que la maestra solo hable con los padres de sus alumnos asignados.

---

## 2. ¿Qué le falta para estar "Listo para Producción"?

Aunque el panel es funcional, para un entorno profesional real con cientos de usuarios, recomiendo estas mejoras críticas:

1.  **Compresión de Imágenes (Urgente):** Actualmente, si la maestra toma una foto de 5MB con su celular y la sube, gasta mucho almacenamiento y los padres tardarán en verla. Se debe implementar una función que reduzca el tamaño de la imagen automáticamente antes de subirla.
2.  **Modo Offline (Caché):** En escuelas con paredes gruesas el Wi-Fi suele fallar. El panel necesita poder guardar la asistencia o rutina de forma local (en el celular) y sincronizarla automáticamente cuando la maestra recupere la conexión.
3.  **Paginación del Muro:** Con el tiempo, el muro tendrá cientos de fotos. Se debe implementar "Scroll Infinito" para que el celular no se trabe al cargar meses de historia de golpe.
4.  **Confirmación de Entrega en Reportes:** Asegurar que los botones de guardado muestren un estado de "Cargando..." visualmente más robusto para evitar que la maestra presione dos veces.
5.  **Validación de Formatos:** Impedir que se suban archivos que no sean imágenes o PDFs para evitar errores de visualización en la app de los padres.

---

## 3. Protocolo de Uso Profesional (Guía para la Maestra)

Para que el panel aporte valor real y mejore la imagen de la estancia, el uso debe ser:

*   **Puntualidad:** La **Asistencia** debe tomarse antes de las 09:30 AM. Es el primer punto de contacto digital con el padre.
*   **Consistencia en Rutina:** El estado de la **Comida** debe estar actualizado a más tardar a las 02:00 PM. Los padres revisan esto durante su hora de almuerzo.
*   **Calidad Visual:** Publicar al menos **una foto diaria** de calidad en el Muro. Una foto vale más que mil avisos de texto.
*   **Gestión de Incidentes:** Ante cualquier caída o raspón, registrar el incidente **inmediatamente** en el panel. Esto genera transparencia y protege legalmente a la institución al tener el reporte con hora exacta.
*   **Tono de Comunicación:** Usar el Chat solo para temas operativos; los temas pedagógicos profundos deben invitarse a una videollamada (usando el botón de Clase en Vivo) o cita presencial.
