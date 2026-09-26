
Q# 🎬 INFORME TÉCNICO

## Sistema de Video y Experiencia Tipo Instagram para el Muro Escolar de Karpus Kids

**Proyecto:** Karpus Kids
**Módulo:** Muro Escolar
**Objetivo:** Implementar una experiencia moderna de publicación y reproducción de videos inspirada en los patrones de UX utilizados por Instagram Reels y publicaciones multimedia.

---

# 1. Resumen ejecutivo

El Muro Escolar de **Karpus Kids** evoluciona de un simple visor de archivos multimedia hacia un sistema de publicación y reproducción de microvideos optimizado para dispositivos móviles.

La estrategia consiste en aplicar al entorno escolar los principales patrones de experiencia que hacen que plataformas como Instagram resulten rápidas, fluidas y fáciles de consumir:

* Videos verticales.
* Reproducción automática al entrar en pantalla.
* Reproducción silenciosa por defecto.
* Pausa automática al salir del viewport.
* Miniaturas antes de iniciar el video.
* Precarga inteligente.
* Compresión de contenido.
* Diseño sin saltos visuales.
* Interacciones mediante gestos.
* Reproducción continua.
* Optimización para conexiones móviles.
* Control eficiente de memoria y recursos.

El objetivo no es copiar Instagram literalmente, sino **adaptar sus mejores patrones de experiencia al contexto privado y educativo de Karpus Kids**.

---

# 2. Objetivo principal

La finalidad del sistema es que un padre pueda abrir el Muro Escolar y consumir fotografías y videos de las actividades de sus hijos de manera:

**rápida + fluida + visual + sencilla + optimizada para móviles.**

La experiencia deseada es:

```text
Padre abre Karpus
        ↓
El muro aparece rápidamente
        ↓
Las miniaturas están disponibles
        ↓
El padre hace scroll
        ↓
El video entra en pantalla
        ↓
Reproducción automática sin sonido
        ↓
El video continúa mientras se descarga contenido
        ↓
El padre sigue haciendo scroll
        ↓
El video anterior se pausa
        ↓
El siguiente contenido toma el foco
```

---

# 3. Principio fundamental: “ver primero, descargar después”

Karpus no debe obligar al dispositivo a descargar todos los videos del Muro antes de mostrarlos.

La estrategia debe ser:

```text
❌ Arquitectura tradicional

Abrir muro
    ↓
Descargar todos los videos
    ↓
Esperar
    ↓
Mostrar contenido


✅ Arquitectura optimizada

Abrir muro
    ↓
Mostrar estructura + texto + thumbnails
    ↓
Detectar video visible
    ↓
Preparar reproducción
    ↓
Reproducir
    ↓
Cargar contenido progresivamente
```

Esto reduce el tiempo de espera inicial y evita descargar contenido que el usuario probablemente nunca llegará a visualizar.

---

# 4. Formato de video

Para el contenido audiovisual del Muro Escolar se utilizarán formatos optimizados para dispositivos móviles.

### Formato recomendado

* Relación vertical: **9:16**
* Relación alternativa: **4:5**
* Resolución principal: **1080 × 1920**
* FPS recomendado: **30 fps**
* Codec principal: **H.264**
* Audio: **AAC**
* Contenedor: **MP4**
* Duración recomendada: **hasta 30 segundos**

El formato de 30 segundos se utilizará principalmente para publicaciones dinámicas y actividades escolares.

No obstante, el límite debe considerarse una regla de producto y no una necesidad técnica absoluta.

---

# 5. Optimización de archivos

El archivo original subido por una maestra no debe ser necesariamente el archivo que consume el padre.

El flujo recomendado es:

```text
Video original
      ↓
Validación
      ↓
Procesamiento
      ↓
Compresión
      ↓
Thumbnail
      ↓
Versión de reproducción
      ↓
Distribución
      ↓
Padres
```

Esto permite reducir el peso del contenido sin sacrificar innecesariamente la calidad visual.

---

# 6. Sistema de thumbnails

Cada video debe disponer de una imagen de portada.

La thumbnail permitirá que Karpus muestre inmediatamente una representación visual del contenido mientras se prepara la reproducción.

```text
┌───────────────────────┐
│                       │
│     THUMBNAIL         │
│                       │
│          ▶            │
│                       │
└───────────────────────┘
```

La miniatura debe:

* Mantener la misma relación de aspecto del video.
* Evitar pantallas negras.
* Utilizar formato WebP cuando sea conveniente.
* Tener un tamaño reducido.
* Mantener una apariencia visual atractiva.
* Reservar previamente el espacio del video.

---

# 7. Eliminación del Layout Shift

El sistema debe conocer la relación de aspecto del contenido antes de cargar el video.

Por ejemplo:

```css
aspect-ratio: 4 / 5;
```

o:

```css
aspect-ratio: 9 / 16;
```

De esta manera, el navegador reserva el espacio antes de que llegue el contenido multimedia.

Resultado:

```text
❌ Antes

Texto
↓
cargando video
↓
pantalla cambia de tamaño
↓
contenido salta


✅ Karpus

Texto
↓
espacio reservado
↓
thumbnail
↓
video
```

Esto mejora considerablemente la estabilidad visual del Muro.

---

# 8. Reproducción automática inteligente

Karpus utilizará `IntersectionObserver` para determinar qué videos están actualmente visibles.

Cuando un video alcance un porcentaje suficiente de visibilidad, podrá comenzar la reproducción automáticamente.

Configuración propuesta:

```text
≥ 65 % visible
       ↓
     PLAY

< 65 % visible
       ↓
     PAUSE
```

El porcentaje podrá ajustarse posteriormente mediante pruebas reales de uso.

---

# 9. Reproducción silenciosa

Los videos comenzarán:

```javascript
muted = true
```

Esto permite una experiencia de autoplay compatible con las políticas habituales de los navegadores móviles.

El usuario podrá activar el sonido mediante un control visible.

```text
🔇 → 🔊
```

El sonido no deberá activarse automáticamente sin una interacción del usuario.

---

# 10. Un solo video reproduciendo audio

Karpus deberá garantizar que no existan múltiples videos reproduciendo sonido simultáneamente.

Ejemplo:

```text
Video 1 → 🔊 reproduciendo
Video 2 → pausado
Video 3 → pausado
```

Si el usuario activa el sonido en otro video:

```text
Video 1 → mute
Video 2 → 🔊
Video 3 → pausado
```

Esto evita una experiencia incómoda dentro del Muro.

---

# 11. Loop de microvideos

Los videos cortos podrán utilizar:

```html
loop
```

para crear una experiencia continua.

Esto resulta especialmente útil para:

* actividades de niños;
* juegos;
* experimentos;
* presentaciones;
* momentos especiales;
* actividades de aula.

El loop debe realizarse sin introducir una pantalla negra innecesaria entre reproducciones.

---

# 12. Precarga inteligente

Karpus no deberá precargar todos los videos del Muro.

La estrategia recomendada es:

```text
Video visible
     ↓
Prioridad máxima

Video siguiente
     ↓
Precarga limitada

Videos lejanos
     ↓
Sin descarga
```

Esto reduce:

* consumo de datos;
* uso de CPU;
* uso de memoria;
* tráfico;
* consumo innecesario de almacenamiento/CDN.

La precarga debe adaptarse también a la calidad de la conexión cuando el navegador proporcione esa información.

---

# 13. Adaptación a conexiones lentas

Cuando sea posible detectar una conexión limitada, Karpus deberá reducir las operaciones de precarga.

Ejemplo conceptual:

```text
Wi-Fi / conexión rápida
       ↓
Precarga del siguiente contenido


4G normal
       ↓
Carga progresiva


3G / Save Data
       ↓
Precarga mínima
       ↓
Reproducir bajo interacción
```

El objetivo es que Karpus sea funcional tanto en dispositivos modernos como en teléfonos con recursos limitados.

---

# 14. Streaming progresivo

Para una primera implementación, Karpus podrá utilizar archivos MP4 optimizados y solicitudes parciales mediante HTTP Range cuando el almacenamiento/servidor lo soporte.

Esto permite solicitar solamente partes del archivo en lugar de descargarlo necesariamente completo de una sola vez.

Para una futura evolución del sistema, se recomienda implementar:

**HLS + múltiples calidades + CDN.**

Arquitectura futura:

```text
                    VIDEO ORIGINAL
                          ↓
                    PROCESAMIENTO
                          ↓
             ┌────────────┼────────────┐
             ↓            ↓            ↓
           1080p         720p         480p
             │            │            │
             └────────────┼────────────┘
                          ↓
                         HLS
                          ↓
                         CDN
                          ↓
                    KARPUS PLAYER
                          ↓
               CALIDAD ADAPTATIVA
```

Esto permitiría que el reproductor pueda utilizar una calidad diferente dependiendo de las condiciones de red.

---

# 15. Experiencia de subida para maestras

La publicación debe ser sencilla.

Flujo:

```text
Maestra
   ↓
Selecciona / graba video
   ↓
Validación
   ↓
Recorte si supera duración permitida
   ↓
Compresión
   ↓
Subida
   ↓
Procesamiento
   ↓
Thumbnail
   ↓
Publicación
```

La interfaz deberá mostrar el progreso de la operación.

La publicación podrá continuar procesándose sin bloquear innecesariamente la navegación del panel.

---

# 16. Grabación desde la cámara

Karpus podrá utilizar `MediaRecorder API` para permitir que las maestras graben directamente desde el dispositivo.

Ejemplo:

```text
🎥 Grabar actividad

00:30
00:29
00:28
...
00:01
00:00
```

El límite recomendado será de **30 segundos** para mantener el Muro enfocado en microcontenido.

---

# 17. Recorte de videos

Si una maestra selecciona un video que supera el límite establecido, Karpus podrá mostrar un editor sencillo:

```text
[──────────── VIDEO ────────────]

      ▲                     ▲
    Inicio                 Final

         [ Recortar ]
```

La prioridad será ofrecer una herramienta simple, no un editor de video complejo.

---

# 18. Validación de archivos

Antes de comenzar la subida, Karpus deberá validar:

* duración;
* tamaño;
* formato;
* MIME type;
* resolución;
* orientación.

Como límite inicial:

**25 MB por video.**

Este límite puede revisarse posteriormente según el consumo real de almacenamiento y ancho de banda.

---

# 19. Doble tap para reaccionar

El video podrá incorporar una interacción inspirada en las redes sociales:

```text
     DOUBLE TAP
          ↓
         ❤️
```

El corazón aparecerá mediante una animación breve.

La reacción será registrada en Supabase.

Esto permite convertir el Muro en una experiencia más interactiva sin introducir controles innecesarios.

---

# 20. Control de sonido

El reproductor tendrá un botón flotante:

```text
┌──────────────────────┐
│                      │
│                      │
│                      │
│                 🔇   │
└──────────────────────┘
```

El control deberá:

* permitir mute/unmute;
* no interferir con el contenido;
* ser fácilmente accesible;
* funcionar correctamente en dispositivos táctiles.

---

# 21. Visor inmersivo

Al tocar una imagen o video, Karpus podrá mostrar un visor ampliado.

Características:

* pantalla completa;
* fondo oscuro;
* contenido centrado;
* soporte táctil;
* cierre sencillo;
* reproducción de video;
* compatibilidad con orientación móvil.

Esto permite consumir el contenido sin abandonar el Muro.

---

# 22. Gestos móviles

En dispositivos táctiles podrán incorporarse:

* doble tap → reacción;
* tap → interacción;
* swipe → cerrar visor;
* scroll → navegar;
* tap → activar sonido.

Los gestos deberán implementarse cuidadosamente para no interferir con el scroll normal de la aplicación.

---

# 23. Realtime

Cuando una maestra publique una nueva actividad, el contenido podrá aparecer en el Muro mediante **Supabase Realtime**.

Flujo:

```text
Maestra publica
      ↓
Supabase
      ↓
Realtime
      ↓
Muro de padres
      ↓
Nueva publicación
```

El usuario no tendrá que actualizar manualmente la página para recibir la publicación.

---

# 24. Contador de visualizaciones

Para el personal autorizado:

```text
👁️ 24 visualizaciones
```

Karpus podrá registrar visualizaciones de forma controlada.

Se recomienda evitar registrar múltiples vistas del mismo usuario de manera excesiva durante una misma sesión.

---

# 25. Marca Karpus Kids

Los videos institucionales podrán incluir una marca de agua discreta:

**🐾 Karpus Kids**

La marca deberá ser pequeña y no interferir con la visualización del contenido.

---

# 26. Administración de memoria y recursos

El sistema deberá controlar activamente los recursos utilizados por los reproductores.

Cuando un video deje de estar visible:

```text
pause()
```

Cuando el componente deje de utilizarse:

```text
destroy()
```

También deberán liberarse:

* `IntersectionObserver`;
* listeners;
* `MediaStream`;
* reproductores;
* referencias temporales;
* recursos asociados al componente.

En la cámara:

```javascript
stream.getTracks().forEach(track => track.stop());
```

El objetivo es evitar fugas de memoria y mantener estable la PWA en sesiones prolongadas.

---

# 27. Arquitectura propuesta

## Fase actual

```text
Karpus Kids
      ↓
Supabase Storage
      ↓
Videos optimizados
      ↓
Thumbnail
      ↓
PWA
      ↓
IntersectionObserver
      ↓
Reproducción automática
```

## Fase avanzada

```text
                 KARPUS KIDS
                      │
                      ↓
               Supabase Storage
                      │
                      ↓
                Procesamiento
                      │
           ┌──────────┼──────────┐
           ↓          ↓          ↓
         1080p       720p       480p
           └──────────┼──────────┘
                      ↓
                     HLS
                      ↓
                     CDN
                      ↓
                Karpus Player
                      ↓
              Reproducción adaptativa
```

---

# 28. Comparación con la experiencia de Instagram

Karpus adoptará **patrones de experiencia similares a Instagram**, principalmente:

| Instagram        | Karpus Kids             |
| ---------------- | ----------------------- |
| Feed vertical    | Muro Escolar            |
| Reels            | Microvideos escolares   |
| Autoplay         | Autoplay visible        |
| Muted autoplay   | Muted autoplay          |
| Loop             | Loop                    |
| Scroll           | Scroll                  |
| Double tap ❤️    | Reacciones              |
| Thumbnail        | Thumbnail               |
| Fullscreen       | Visor inmersivo         |
| Lazy loading     | Carga inteligente       |
| Precarga         | Precarga controlada     |
| Adaptación móvil | PWA móvil               |
| CDN/streaming    | Evolución hacia CDN/HLS |

**Importante:** la similitud está en la **experiencia y los patrones de interacción**, no significa que Karpus utilice la infraestructura privada de Instagram.

---

# 29. Objetivos de rendimiento

El sistema debe optimizarse para conseguir:

### Carga

* Mostrar rápidamente la estructura del Muro.
* Evitar descargar videos que el usuario no verá.
* Evitar Layout Shift.
* Mostrar thumbnail inmediatamente.

### Reproducción

* Inicio rápido.
* Reproducción fluida.
* Mínimo buffering.
* Pausa automática fuera de pantalla.
* Un único audio activo.

### Dispositivo

* Bajo consumo de memoria.
* Bajo consumo de CPU.
* Menor consumo de datos.
* Compatibilidad con teléfonos de gama media/baja.

### Experiencia

* Sensación de aplicación nativa.
* Interacciones táctiles.
* Animaciones suaves.
* Contenido visual.
* Navegación rápida.

---

# 30. Criterio de éxito

La implementación será considerada exitosa cuando un padre pueda realizar el siguiente recorrido:

```text
ABRIR KARPUS
     ↓
VER EL MURO
     ↓
HACER SCROLL
     ↓
VIDEO APARECE
     ↓
VIDEO COMIENZA
     ↓
CONTINUAR SCROLL
     ↓
VIDEO ANTERIOR SE PAUSA
     ↓
SIGUIENTE VIDEO SE PREPARA
```

Todo esto debe suceder **sin que el usuario tenga que esperar una descarga completa antes de consumir el contenido**.

---

# 31. Evolución recomendada

### FASE 1 — Experiencia tipo Instagram

* Autoplay.
* Muted.
* Loop.
* IntersectionObserver.
* Thumbnails.
* Aspect ratio.
* Double tap.
* Mute/unmute.
* Realtime.
* Lazy loading.
* Gestión de memoria.

### FASE 2 — Optimización de distribución

* Compresión automática.
* MP4 H.264.
* WebP thumbnails.
* HTTP Range.
* CDN.
* Caché.
* Precarga inteligente.

### FASE 3 — Streaming avanzado

* HLS.
* 1080p.
* 720p.
* 480p.
* Bitrate adaptativo.
* Procesamiento automático.
* Métricas de buffering.
* Optimización avanzada para redes móviles.

---

# 32. Conclusión

El objetivo de Karpus Kids no es simplemente **“subir videos al Muro Escolar”**.

El objetivo es crear una experiencia en la que los padres puedan **ver y consumir las actividades de sus hijos de forma inmediata, fluida y natural**, utilizando patrones de interacción que ya han demostrado ser efectivos en plataformas modernas de contenido.

La estrategia de Karpus se resume en:

> **Publicar fácilmente → procesar automáticamente → mostrar rápidamente → reproducir inteligentemente → pausar cuando no se utiliza → optimizar según el dispositivo y la conexión.**

De esta manera, el Muro Escolar puede convertirse en una experiencia audiovisual moderna, privada y diseñada específicamente para la comunicación entre la estancia y las familias.

**Karpus Kids — Muro Escolar v4.0**
**Experiencia de microvideo inspirada en Instagram, adaptada al entorno educativo.**

---

# 33. Brechas seguras aplicadas

Esta sección documenta lo que se implementó de esta propuesta, por decisión de
aplicar únicamente los puntos de bajo riesgo y alto impacto.

## 33.1 Límites del video (secciones 18 y 24)

Los tres paneles del Muro comparten ahora una **fuente única de límites** en
`js/shared/wall.js`, exportada como `WALL_LIMITS`:

| Límite | Antes | Ahora | Propuesta |
|--------|-------|-------|-----------|
| Duración máxima | 120 s (2 min) | **30 s** | L117 / L461 |
| Tamaño máximo | 50 MB | **25 MB** | L495 |
| Relación de aspecto | sin validar | **9:16 vertical** | L110 |

Archivos afectados:

* `js/shared/wall.js` — constantes, `probeVideo()`, `validateWallVideo()`,
  validación integrada en `uploadMedia()`, y el grabador directo.
* `js/directora/wall.module.js` — el módulo tenía sus propios 50 MB / 2 min y
  un `_validateDuration()` duplicado. Ahora consume `validateWallVideo()` y
  `WALL_LIMITS`; se eliminó el duplicado.
* `js/maestra/main.js` y `js/asistente/main.js` — llegan por el mismo
  `WallModule` de `js/shared/wall.js`, así que heredan los límites sin cambios.
* `js/maestra/api.js` — se eliminó un `uploadMedia()` sin uso que subía al
  bucket `posts` saltándose toda validación.

## 33.2 Validación 9:16

`validateWallVideo()` lee duración y dimensiones con `probeVideo()` antes de
subir y rechaza con mensaje explícito:

```text
El Muro es vertical 9:16. Este video es 1920×1080. Grábalo con el teléfono en vertical.
```

La tolerancia es de ±0.04 sobre 0.5625, para aceptar los ratios reales de los
teléfonos (típicamente 0.46–0.60) sin abrir la puerta a material horizontal.

Si el video excede los 30 s se abre el **trimmer** (comportamiento preexistente)
en vez de rechazar; el error de formato o tamaño sí bloquea.

## 33.3 Grabador directo

`openVideoRecorder()` pedía `facingMode: 'environment'` (cámara trasera), que
entrega 16:9 horizontal y por tanto era incompatible con un Muro vertical. Ahora
pide la frontal con `aspectRatio: { ideal: 9/16 }` y reintenta sin el hint si el
navegador lo rechaza.

## 33.4 Bucket y límite en base de datos

La migración `20260920121000_10_correcciones_auditoria.sql` (bloque J) crea el
bucket `posts` con límite de 25 MB, de modo que el límite se aplica también del
lado del servidor y no solo en el cliente.

## 33.5 Lo que queda pendiente

Corresponde a las fases 2 y 3 de la sección 31 y **no** se implementó:

* Compresión de video del lado del cliente y MP4 H.264.
* HTTP Range, CDN, caché y precarga inteligente.
* HLS con bitrate adaptativo (1080p/720p/480p).
* Marca de agua institucional (sección 25).
