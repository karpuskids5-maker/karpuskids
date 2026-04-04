# 🚀 Karpus Kids — Checklist de Producción

## ✅ Ya implementado en el código

- `safeQuery()` en `db-utils.js` — interceptor global de errores con toast automático
- `auditLog()` en `db-utils.js` — registra pagos aprobados/eliminados y calificaciones
- Tabla `audit_logs` en `schema.sql` con RLS (solo directora/asistente)
- `notify-permission.js` — banner sin timeout de dismiss (siempre visible hasta que el usuario decide)
- `scripts/fix_auth_activation.js` añadido a `.gitignore` (contiene SERVICE_ROLE_KEY)
- `escapeHTML()` en todos los renders del muro y comentarios (protección XSS)

---

## ⚠️ Pendiente — Requiere infraestructura

### 1. Variables de Entorno (Claves)
Las claves en `js/shared/supabase.js` son la **ANON KEY** (pública por diseño en Supabase).
La ANON KEY es segura en el cliente — Supabase la diseñó así. La seguridad real es RLS.

**Lo que SÍ debes proteger:**
- `SUPABASE_SERVICE_ROLE_KEY` — nunca en el cliente (ya está en `.gitignore`)
- `RESEND_API_KEY` — solo en Supabase Edge Functions Secrets

### 2. Entornos Separados
```
Supabase Staging  → para pruebas de schema.sql
Supabase Prod     → solo cambios probados en staging
```
Nunca ejecutes `schema.sql` directamente en producción sin probar en staging.

### 3. Monitoreo de Errores
Instalar Sentry (gratis hasta 5k errores/mes):
```html
<script src="https://browser.sentry-cdn.com/7.x.x/bundle.min.js"></script>
<script>Sentry.init({ dsn: "TU_DSN_AQUI" });</script>
```
Agregar en todos los paneles antes de los scripts de la app.

### 4. Service Worker (Offline)
El `sw.js` actual necesita estrategia de caché:
- **Cache First**: logos, fuentes, CSS, JS estáticos
- **Network First**: llamadas a Supabase API

### 5. OCR en Edge Function
Mover Tesseract.js del cliente a una Edge Function:
```
supabase/functions/ocr-voucher/index.ts
```
Esto evita congelar el navegador móvil al procesar comprobantes.

### 6. Backup de Storage
En Supabase Dashboard → Storage → configurar retención de archivos.
Los buckets `karpus-uploads` y `posts` contienen fotos de menores — backup crítico.

### 7. Configurar SMTP en Supabase
Dashboard → Settings → Auth → SMTP Settings
Usar Resend o SendGrid para correos de confirmación de cuenta.

---

## 🔑 Secrets requeridos en Supabase Edge Functions

Dashboard → Edge Functions → Manage Secrets:

| Secret | Valor |
|--------|-------|
| `RESEND_API_KEY` | Tu API key de resend.com |
| `FROM_EMAIL` | `Karpus Kids <avisos@karpuskids.com>` |
| `ONESIGNAL_APP_ID` | `47ce2d1e-152e-4ea7-9ddc-8e2142992989` |
| `ONESIGNAL_REST_API_KEY` | Tu REST API Key de OneSignal |

---

## 📋 Comandos de Deploy

```bash
# Deploy todas las Edge Functions
supabase functions deploy send-email --no-verify-jwt
supabase functions deploy send-push --no-verify-jwt
supabase functions deploy payment-reminders --no-verify-jwt
supabase functions deploy process-event --no-verify-jwt

# Ejecutar schema en producción (después de probar en staging)
# Copiar contenido de schema.sql → Supabase SQL Editor → Run
```
