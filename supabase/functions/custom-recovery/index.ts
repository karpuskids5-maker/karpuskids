/**
 * 🔑 custom-recovery — Edge Function
 * Recuperación de contraseña personalizada.
 *
 * Flujo:
 *   1. Recibe el email de login del usuario
 *   2. Busca el usuario en auth.users (admin SDK)
 *   3. Busca el correo de notificaciones alternativo en profiles/students
 *   4. Genera un recovery link con auth.admin.generateLink
 *   5. Envía el enlace via Resend al correo de notificaciones (o al de login si no hay alternativo)
 *
 * Seguridad:
 *   - Usa SERVICE_ROLE_KEY solo en el servidor (nunca expuesta al cliente)
 *   - Rate limiting: máx 3 solicitudes por email cada 15 minut