# 📋 Informe de Reglas y Normativas: Karpus Kids

## 1. Integridad Académica: Aulas y Períodos
Para que el sistema de reportes, tareas y calificaciones funcione, es vital que no existan "aulas huérfanas".

*   **Regla Obligatoria:** No se permite la creación de un Aula sin la asignación inmediata de un **Período Académico** activo.
*   **Lógica de Bloqueo:** Si un aula no tiene un período asociado, los profesores no podrán publicar tareas ni calificar, ya que el sistema no sabría a qué ciclo pertenece esa nota.
*   **Cierre de Ciclo:** Al finalizar un período, el aula debe ser "limpiada" (los estudiantes pasan al siguiente nivel o egresan) y se debe abrir un nuevo período para mantener el historial independiente.

## 2. Sistema de Pagos y Finanzas
Para mantener la liquidez y evitar malentendidos con los padres, el sistema debe seguir este flujo estricto:

*   **Generación Automática:** Los recibos se generan el **día 25 de cada mes** para el mes siguiente.
*   **Regla de Gracia para Nuevos Ingresos:**
    *   Si un niño entra antes del día 25, se le genera el cobro del mes siguiente.
    *   Si entra el 25 o después, su primer cobro será para el mes subsiguiente.
*   **Vencimiento y Mora:** La fecha límite de pago es el **día 5 de cada mes**. A partir del día 6, el sistema marcará el pago como "Vencido" y aplicará:
    *   **Cargo Administrativo:** RD$200 fijos al primer día de retraso.
    *   **Mora Diaria:** RD$50 adicionales por cada día de atraso.
*   **Validación Estricta de Comprobantes:**
    *   No se puede aprobar un pago si no hay una imagen de comprobante cargada (excepto si el método de pago se marca como "Efectivo").
    *   Cuando un padre sube un comprobante, el estado del pago cambia automáticamente a **"En Revisión"**, alertando a la administración.
*   **Protección de Datos:** Una vez que un pago es marcado como "Pagado", queda bloqueado. No puede ser eliminado ni modificado (excepto por un usuario de rol Admin) para evitar fraudes o errores contables.

## 3. Normativas de Chat y Comunicación
El chat es para uso profesional y seguimiento pedagógico.

*   **Automatización de Canales:** Al inscribir a un niño en un aula, el sistema crea automáticamente un **Chat de Aula** (grupal) y un **Chat Privado** (Maestra-Padre).
*   **Horarios de Disponibilidad:** Se recomienda que la interacción sea en horas laborables. Fuera de ese horario, el sistema debe indicar que la respuesta será diferida.
*   **Privacidad:** Los padres no ven los números de teléfono de otros padres en el chat de grupo, protegiendo la identidad y datos personales.

---

## 🚀 10 Reglas de Oro para un Proyecto Exitoso

1.  **Matrícula Única:** Obligatoria para cada estudiante y personal para evitar errores financieros.
2.  **Asistencia Digital (QR):** Registro obligatorio de entrada y salida para seguridad legal y notificaciones al instante.
3.  **Auditoría Inmutable:** Todo cambio en estados de pago queda registrado con usuario, fecha y motivo.
4.  **Evidencia Digital de Tareas:** Los padres deben subir fotos de las tareas; esto justifica las calificaciones ante cualquier reclamo.
5.  **Seguridad por Roles:** Restricción estricta de acceso; el personal solo ve lo que necesita para su función.
6.  **Validación de Salida:** Registro de la identidad de quien retira al infante mediante escaneo de QR.
7.  **Notificaciones Push/Email:** Alertas proactivas para deudas, mensajes nuevos e incidentes importantes.
8.  **Borrado Lógico:** Nunca eliminar datos definitivamente; usar `deleted_at` para mantener trazabilidad histórica.
9.  **Confirmación de Datos:** Los padres deben verificar contactos y alergias trimestralmente.
10. **Simplicidad de Interfaz:** Regla de los "3 clics" para asegurar que el personal pueda operar el sistema rápidamente.
