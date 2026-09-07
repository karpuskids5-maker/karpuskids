
Quiero implementar en mi sistema una función profesional de **SUSPENSIÓN TEMPORAL DEL SERVICIO POR EMPRESA**, debido a falta de pago de la mensualidad.

IMPORTANTE:

* NO eliminar usuarios.
* NO eliminar datos.
* NO modificar ni romper funcionalidades existentes.
* NO cambiar el diseño general del sistema.
* La suspensión debe aplicarse a TODA la empresa/estancia, no usuario por usuario.
* Mantener intacta toda la información existente.
* Antes de modificar código, analiza la arquitectura actual, autenticación, tablas de Supabase, relaciones entre usuarios y empresa y políticas RLS.

### 1. ESTADO DE LA EMPRESA

Utiliza la tabla `business` existente si ya existe.

Agregar, únicamente si no existen, los campos necesarios para controlar el estado:

* `status`: `active` o `suspended`
* `suspended_at`
* `suspension_reason` (puede existir internamente, pero NO mostrarlo al cliente)

El estado por defecto debe ser:

`active`

### 2. COMPORTAMIENTO CUANDO LA EMPRESA ESTÁ ACTIVA

Si:

`business.status = active`

el sistema debe funcionar exactamente como funciona actualmente.

NO modificar:

* Dashboard
* módulos
* permisos
* usuarios
* navegación
* datos
* funcionalidades existentes

### 3. COMPORTAMIENTO CUANDO LA EMPRESA ESTÁ SUSPENDIDA

Si:

`business.status = suspended`

NINGÚN usuario perteneciente a esa empresa debe poder utilizar el sistema.

Esto incluye:

* Director
* Administradores
* Maestros
* Asistentes
* Padres
* Cualquier otro usuario asociado a esa empresa

Después de iniciar sesión, el sistema debe comprobar el estado de la empresa.

Si está suspendida:

1. No cargar el dashboard.
2. No permitir acceso a los módulos.
3. No permitir consultas normales de datos.
4. Cerrar la sesión si corresponde.
5. Mostrar una pantalla/modal de suspensión.

### 4. DISEÑO DE LA VENTANA DE SUSPENSIÓN

Crear una pantalla visualmente profesional, limpia y moderna.

NO mostrar el motivo de la suspensión.

Mostrar únicamente:

**Sistema temporalmente suspendido**

Texto:

**En este momento el acceso al sistema se encuentra temporalmente suspendido.**

Debajo:

**Para obtener asistencia o solicitar la reactivación del servicio, comuníquese con nosotros.**

Botón principal:

**Contactar soporte**

El botón debe abrir WhatsApp directamente al número:

**8497114807**

Utilizar el enlace de WhatsApp correspondiente:

`https://wa.me/18497114807`

El botón debe abrir WhatsApp en una nueva pestaña/ventana cuando sea posible.

### 5. DISEÑO VISUAL

La ventana debe sentirse como una plataforma SaaS profesional.

Utilizar:

* Fondo limpio.
* Tarjeta central.
* Icono de bloqueo/suspensión.
* Título grande.
* Texto corto.
* Botón de WhatsApp claramente visible.
* Diseño responsive para computadora, tablet y móvil.
* Bordes redondeados.
* Sombras suaves.
* Buena separación entre elementos.

NO utilizar un diseño agresivo, rojo intenso o que parezca un error del sistema.

La sensación debe ser:

"El servicio está temporalmente inactivo y puedes comunicarte con soporte."

### 6. SESIONES YA ABIERTAS

MUY IMPORTANTE:

Si una empresa está activa y un usuario ya tiene una sesión abierta, pero posteriormente el administrador cambia:

`status = suspended`

el usuario no debe poder continuar utilizando el sistema indefinidamente.

Implementar una comprobación periódica del estado de la empresa mientras el usuario está conectado.

Por ejemplo, verificar cada pocos minutos o utilizando el mecanismo más eficiente disponible en la arquitectura actual.

Si detecta:

`status = suspended`

debe:

1. Detener las operaciones del sistema.
2. Evitar nuevas consultas/modificaciones.
3. Cerrar la sesión de forma segura.
4. Mostrar la pantalla de suspensión.

### 7. SEGURIDAD

NO depender únicamente de JavaScript/frontend para realizar la suspensión.

Revisar las políticas RLS existentes de Supabase y determinar la mejor forma de impedir que una empresa suspendida continúe accediendo a sus datos mediante consultas directas.

No eliminar ni modificar políticas RLS existentes de forma destructiva.

Crear las nuevas políticas necesarias de forma compatible con la arquitectura actual.

IMPORTANTE:
La suspensión debe afectar solamente a la empresa suspendida.

Una empresa activa NO debe verse afectada.

### 8. REACTIVACIÓN

Desde el panel administrativo del propietario del sistema debe ser posible cambiar:

`suspended → active`

Cuando la empresa vuelva a estar:

`active`

sus usuarios deben poder iniciar sesión y utilizar nuevamente el sistema con todos sus datos intactos.

No crear nuevamente los usuarios.

No restaurar datos.

No duplicar registros.

Simplemente permitir nuevamente el acceso.

### 9. PANEL ADMINISTRATIVO

Agregar al panel administrativo una opción para controlar el estado de cada empresa.

Mostrar:

**Estado: ACTIVO**
o
**Estado: SUSPENDIDO**

Agregar una acción:

**Suspender servicio**

y cuando esté suspendida:

**Reactivar servicio**

Antes de suspender, mostrar una confirmación:

**¿Deseas suspender temporalmente el servicio de esta empresa?**

Indicar que todos los usuarios asociados perderán temporalmente el acceso.

### 10. IMPLEMENTACIÓN SEGURA

ANTES de escribir código:

1. Analiza las tablas existentes.
2. Identifica cómo se relaciona cada usuario con `business_id`.
3. Identifica cómo funciona actualmente Supabase Auth.
4. Revisa las políticas RLS.
5. Identifica los archivos responsables del login.
6. Identifica el sistema actual de rutas/protección de páginas.
7. Identifica si existe algún sistema de permisos o roles.

Después presenta un pequeño plan de implementación.

Luego realiza los cambios.

NO reemplaces archivos completos si solamente es necesario modificar una parte.

NO elimines funcionalidades existentes.

NO cambies nombres de variables, tablas o funciones existentes innecesariamente.

### 11. CRITERIOS DE ACEPTACIÓN

La implementación estará correcta únicamente si:

✓ Empresa activa → sistema funciona normalmente.

✓ Empresa suspendida → ningún usuario de esa empresa puede acceder al sistema.

✓ Usuario con sesión abierta → pierde acceso cuando la empresa es suspendida.

✓ Pantalla de suspensión aparece correctamente.

✓ No se muestra ningún motivo de suspensión.

✓ Aparece botón "Contactar soporte".

✓ El botón abre WhatsApp al número 8497114807.

✓ Empresa reactivada → vuelve a funcionar normalmente.

✓ Ningún dato se elimina.

✓ Ningún usuario se elimina.

✓ Otras empresas activas continúan funcionando normalmente.

✓ La implementación funciona correctamente en móvil, tablet y computadora.

✓ No se rompen las funcionalidades actuales.

✓ Las políticas de seguridad de Supabase siguen protegiendo correctamente los datos.

Al finalizar, explícame exactamente:

* qué archivos modificaste,
* qué tablas modificaste,
* qué políticas RLS modificaste o agregaste,
* cómo funciona la suspensión,
* cómo funciona la reactivación,
* y cómo puedo probar todo sin afectar empresas reales.
a