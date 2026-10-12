 Perfecto. Entonces vamos a enfocarnos en tu **SaaS de gestión de guarderías y estancias infantiles en República Dominicana**.

Este tipo de plataforma requiere especial cuidado porque administra información de menores de edad, padres, tutores, docentes, expedientes, asistencia, pagos e incidencias.

La idea es que tu sistema no solamente tenga documentos legales, sino que también incorpore reglas de funcionamiento que ayuden a prevenir accesos indebidos, pérdida de información, suplantaciones y otros problemas.

Hay tres normas especialmente importantes para tu proyecto:

* **Ley núm. 172-13:** protección de datos personales. ([Superintendencia de Bancos][1])
* **Ley núm. 136-03:** protección de los derechos fundamentales de niños, niñas y adolescentes. ([Ministerio de Educación][2])
* **Nuevo Código Penal, Ley núm. 74-25, modificado por la Ley núm. 44-26:** debes consultar el texto consolidado oficial publicado en agosto de 2026. ([Consultoría Jurídica del Poder Ejecutivo][3])

A continuación te presento una estructura que puedes utilizar como base para desarrollar tu sistema.

# 1. Las políticas legales que debe tener tu SaaS

Te recomiendo crear una sección llamada **Centro Legal y de Cumplimiento**, desde la cual puedas administrar los documentos legales de tu plataforma.

| Documento                                       | Finalidad                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Términos y condiciones                          | Establecer las reglas de utilización del SaaS.                                                |
| Política de privacidad                          | Explicar cómo se recopilan, utilizan, protegen y conservan los datos personales.              |
| Política de protección de menores               | Establecer controles específicos para la información de niños y niñas.                        |
| Política de seguridad informática               | Definir los controles técnicos y administrativos de seguridad.                                |
| Política de suscripciones y pagos               | Regular los cobros, renovaciones, vencimientos y cancelaciones.                               |
| Política de suspensión de cuentas               | Establecer cuándo y cómo se restringe el acceso al servicio.                                  |
| Política de conservación y eliminación de datos | Definir cuánto tiempo se conservan los datos y cuándo se eliminan.                            |
| Acuerdo de tratamiento de datos                 | Delimitar las responsabilidades del SaaS y de cada guardería respecto a los datos personales. |
| Política de respaldo y recuperación             | Establecer cómo se recupera la información ante fallos o incidentes.                          |
| Política de uso aceptable                       | Prohibir el fraude, la suplantación, el acceso indebido y otras conductas prohibidas.         |

No todas estas políticas tienen que publicarse como documentos independientes. Algunas pueden integrarse en otros documentos, pero las responsabilidades y los procedimientos deben quedar definidos.

# 2. Reglas que debe seguir cada guardería

Cada centro infantil que contrate tu plataforma debe aceptar las condiciones aplicables a su utilización.

## Regla 1. Información verdadera

La guardería debe comprometerse a proporcionar información veraz sobre su institución, sus representantes y los usuarios que registre.

No debe utilizar el sistema para crear expedientes falsos, suplantar identidades o manipular información institucional.

## Regla 2. Protección de los expedientes infantiles

La guardería debe utilizar los datos de los niños exclusivamente para las finalidades legítimas que correspondan a sus actividades y a las autorizaciones aplicables.

Debe evitar, entre otras cosas:

* Compartir expedientes con personas no autorizadas.
* Publicar fotografías sin las autorizaciones necesarias.
* Permitir que empleados sin funciones pertinentes consulten información privada.
* Utilizar los datos de los niños para fines publicitarios incompatibles con las autorizaciones obtenidas.
* Descargar o divulgar información confidencial sin justificación.

## Regla 3. Responsabilidad sobre los usuarios

Cada institución debe administrar las cuentas de sus empleados.

Por ejemplo, cuando un maestro deja de trabajar en una guardería, el administrador debe revocar sus permisos oportunamente.

La institución no debe compartir una sola contraseña entre todos sus empleados.

## Regla 4. Prohibición de manipular registros

Los usuarios no deben alterar deliberadamente registros de asistencia, pagos, autorizaciones, informes o incidencias para ocultar hechos o perjudicar a terceros.

Los cambios importantes deben quedar registrados en una bitácora de auditoría.

## Regla 5. Uso legítimo de la plataforma

Queda prohibido utilizar el SaaS para:

* Acceder a información de otras guarderías sin autorización.
* Extraer bases de datos ajenas.
* Intentar vulnerar los mecanismos de seguridad.
* Suplantar a padres, tutores, docentes o administradores.
* Manipular pagos.
* Destruir o alterar registros ajenos de manera no autorizada.

Las consecuencias contractuales deben ser proporcionales al incumplimiento y compatibles con la legislación aplicable.

# 3. Reglas especiales para padres y tutores

Tu plataforma también debe definir qué pueden hacer los padres y tutores dentro de su panel.

Te recomiendo las siguientes reglas.

**Acceso limitado:** cada padre debe consultar solamente la información de los niños respecto de los cuales tenga autorización.

**Información actualizada:** los padres deben proporcionar información de contacto correcta y actualizarla cuando sea necesario.

**Credenciales personales:** no deben compartir sus contraseñas ni permitir que terceros utilicen su cuenta sin autorización.

**Documentos y fotografías:** no deben utilizar la plataforma para descargar o divulgar información de otros niños.

**Solicitudes de corrección:** deben poder comunicar errores en los datos de sus hijos mediante un procedimiento definido.

**Autorizaciones:** la guardería debe disponer de mecanismos para registrar y verificar las autorizaciones correspondientes a las personas que pueden recoger al niño, cuando esa funcionalidad forme parte del servicio.

**Comunicaciones:** los mensajes y notificaciones deben dirigirse a los destinatarios autorizados.

Una consideración importante: los procedimientos de custodia, representación legal y autorizaciones familiares deben poder adaptarse a situaciones particulares. No conviene permitir que cualquier persona que se registre como padre obtenga automáticamente acceso a un expediente infantil.

# 4. Reglas que debe cumplir tu sistema por dentro

Esta es una de las partes más importantes para el desarrollo.

Las reglas legales deben convertirse en controles técnicos reales.

| Área                     | Regla del sistema                                                       |
| ------------------------ | ----------------------------------------------------------------------- |
| Registro                 | Verificar la información necesaria para crear cuentas y organizaciones. |
| Autenticación            | Proteger las sesiones y las credenciales de los usuarios.               |
| Permisos                 | Comprobar las autorizaciones en el servidor.                            |
| Separación de empresas   | Impedir que una guardería acceda a los datos de otra.                   |
| Expedientes infantiles   | Limitar el acceso a usuarios autorizados.                               |
| Asistencia               | Registrar quién realiza las modificaciones relevantes.                  |
| Pagos                    | Conservar el historial de operaciones y sus cambios.                    |
| Fotografías y documentos | Controlar el acceso y las descargas.                                    |
| Panel administrativo     | Registrar las operaciones sensibles realizadas por administradores.     |
| Copias de seguridad      | Mantener mecanismos de recuperación y comprobar que funcionan.          |
| Incidentes               | Disponer de un procedimiento para investigar accesos sospechosos.       |
| Eliminación              | Aplicar las reglas de conservación y eliminación correspondientes.      |

### Si utilizas Supabase

Te recomiendo que cada tabla con información de una guardería tenga un mecanismo de aislamiento entre organizaciones.

Por ejemplo:

* `organizations`
* `children`
* `parents`
* `teachers`
* `attendance`
* `payments`
* `incidents`
* `authorizations`
* `audit_logs`

Los nombres son ilustrativos; puedes adaptarlos a la estructura actual de tu base de datos.

Las tablas que contienen datos de una organización deben estar protegidas con políticas de seguridad de filas (RLS) cuando corresponda.

También debes validar la autorización en cada operación. No es suficiente con ocultar los botones o las páginas en el navegador.

# 5. Qué hacer cuando una guardería incumple las reglas

Tu SaaS debe disponer de un procedimiento de actuación.

Te propongo esta secuencia:

**Nivel 1. Incumplimiento menor**

Por ejemplo, una configuración incorrecta o una conducta que pueda corregirse sin comprometer la seguridad.

Medida: notificación y solicitud de corrección.

**Nivel 2. Incumplimiento reiterado**

Por ejemplo, compartir credenciales de manera reiterada o ignorar las medidas de seguridad establecidas.

Medida: restricciones proporcionales, advertencia formal o suspensión de determinadas funciones, según el contrato.

**Nivel 3. Incidente de seguridad**

Por ejemplo, indicios de acceso no autorizado a expedientes infantiles.

Medida: contener el incidente, proteger las cuentas, conservar evidencias y evaluar las notificaciones legalmente exigibles.

**Nivel 4. Posible actividad delictiva**

Por ejemplo, indicios de falsificación, fraude o acceso ilícito.

Medida: proteger la plataforma, preservar los registros pertinentes y evaluar las actuaciones legales apropiadas.

No debes presentar una sospecha como un delito demostrado. La investigación y la determinación de responsabilidad corresponden a las autoridades competentes cuando el asunto llega al ámbito penal.

# 6. Cómo debes protegerte frente al nuevo Código Penal

El nuevo Código Penal no sustituye las políticas de privacidad ni las medidas de seguridad informática.

Para tu SaaS, debes evaluar especialmente los riesgos asociados con el acceso no autorizado, la manipulación de información, la suplantación y el uso de datos para perjudicar a terceros.

Te recomiendo implementar estas medidas:

1. **Registro de auditoría:** conservar un historial protegido de las operaciones sensibles.
2. **Control de privilegios:** limitar los permisos de cada empleado y administrador.
3. **Separación de responsabilidades:** evitar que una sola persona pueda ejecutar y ocultar operaciones críticas sin controles.
4. **Protección de evidencias:** evitar la alteración o destrucción de registros relevantes.
5. **Gestión de incidentes:** establecer un procedimiento documentado de respuesta.
6. **Confidencialidad:** exigir obligaciones apropiadas al personal que acceda a información privada.
7. **Revisión de seguridad:** comprobar periódicamente que los controles funcionan.
8. **Procedimiento legal:** evaluar las medidas que correspondan cuando se detecten hechos potencialmente ilícitos.

La referencia para revisar las disposiciones penales es el [texto consolidado oficial del Código Penal dominicano](https://www.consultoria.gov.do/noticias/consultoria-juridica-del-poder-ejecutivo-publica-version-unificada-del-nuevo-codigo-penal-9354).

La implementación de estos controles reduce riesgos, pero no garantiza por sí sola que una empresa quede exenta de responsabilidad. Esa evaluación depende de los hechos y de las disposiciones legales aplicables.

---

# 7. La estructura que recomiendo para tu panel de superadministrador

Quiero recomendarte algo importante para tu SaaS.

En lugar de administrar estos asuntos de forma dispersa, puedes crear una sección denominada **Cumplimiento y Seguridad**.

Dentro tendría los siguientes apartados:

| Sección                 | Función                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| Centro Legal            | Administrar términos y políticas.                                 |
| Aceptaciones            | Consultar qué usuarios aceptaron cada versión.                    |
| Organizaciones          | Gestionar el estado contractual de las guarderías.                |
| Usuarios y permisos     | Revisar los accesos y roles.                                      |
| Auditoría               | Consultar las operaciones sensibles.                              |
| Incidentes              | Registrar y gestionar problemas de seguridad.                     |
| Privacidad              | Tramitar solicitudes relacionadas con los datos personales.       |
| Retención de datos      | Gestionar los períodos de conservación.                           |
| Suscripciones           | Administrar planes, cobros y cancelaciones.                       |
| Respaldo y recuperación | Supervisar las copias de seguridad y las pruebas de recuperación. |

El superadministrador debe tener acceso a las funciones de gestión que necesite, pero **no debe utilizar ese privilegio como autorización general para consultar expedientes infantiles por curiosidad o sin una finalidad legítima**.

Los accesos excepcionales a información privada deben estar justificados, limitados y registrados.

---

# 8. El siguiente paso: preparar las políticas de tu SaaS

Mi recomendación es que desarrollemos los documentos en este orden:

1. **Términos y condiciones generales del SaaS.**
2. **Política de privacidad y tratamiento de datos personales.**
3. **Acuerdo de tratamiento de datos entre tu SaaS y cada guardería.**
4. **Política de protección de menores.**
5. **Política de seguridad informática y uso aceptable.**
6. **Política de pagos, suspensiones y cancelaciones.**
7. **Política de conservación, exportación y eliminación de datos.**
8. **Procedimiento de gestión de incidentes y auditoría.**

Cada documento debe distinguir entre las obligaciones del proveedor de software y las responsabilidades de la guardería que utiliza la plataforma.

Antes de publicar estas políticas como documentos legales definitivos, conviene que un abogado dominicano revise su contenido, especialmente por el tratamiento de datos de menores.

*