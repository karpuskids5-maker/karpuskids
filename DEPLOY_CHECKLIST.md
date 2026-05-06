# 🚀 Karpus Kids — Checklist de Producción

## ✅ Completado en código

### Seguridad
- [x] Headers de seguridad en todos los paneles (X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- [x] Anti-clickjacking script en todos los paneles
- [x] robots: noindex en paneles privados
- [x] CDN versions pinned (lucide@0.263.1, chart.js@4.4.0)
- [x] Tesseract.js eliminado (2.3MB innecesario)
- [x] 50+ console.log/warn/error eliminados de producción
- [x] Duplicados de scripts/links eliminados
- [x] SW cache bumped a v6

### Email
- [x] Todas las funciones usan FROM_EMAIL del env var
- [x] Correo de notificación: `avisos@karpuskids.com`
- [x] Nunca se usa el correo del usuario como remitente

### Posts/Muro
- [x] Edge Function `get-posts` creada (bypasea RLS)
- [x] `padre/feed.js` usa Edge Function con JWT explícito
- [x] URLs de media relativas resueltas a URLs públicas

---

## ⚠️ Acciones pendientes en Supabase

### 1. SQL Editor — Ejecutar en orden:

```sql
-- fix_attendance_system.sql (ponche digital)
-- fix_posts_rls.sql (muro visible para padres)
```

### 2. Edge Functions — Desplegar:

```bash
supabase functions deploy get-posts
supabase functions deploy send-email
supabase functions deploy send-push
supabase functions deploy process-event
supabase functions deploy payment-reminders
supabase functions deploy admin-reset-password
```

### 3. Secrets en Supabase Dashboard → Settings → Edge Functions:

```
RESEND_API_KEY        = re_xxxxxxxxxx
FROM_EMAIL            = Karpus Kids <avisos@karpuskids.com>
SUPABASE_SERVICE_ROLE_KEY = eyJ...
ONESIGNAL_APP_ID      = 47ce2d1e-152e-4ea7-9ddc-8e2142992989
ONESIGNAL_REST_API_KEY = your_key
```

### 4. SQL adicional (si no se ha ejecutado):

```sql
-- Agregar columna access_code
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS access_code text;
UPDATE public.profiles SET access_code = notes
WHERE notes LIKE 'DIR-%' OR notes LIKE 'TEA-%' OR notes LIKE 'ASI-%';

-- Rol admin
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('directora','maestra','padre','asistente','admin'));
```

---

## 📋 Verificación final

- [ ] Probar login con cada rol (padre, maestra, directora, asistente, admin)
- [ ] Verificar que el muro del padre muestra publicaciones generales
- [ ] Probar ponche QR con estudiante, maestra, asistente, directora
- [ ] Verificar correo de notificación al aprobar pago
- [ ] Verificar push notification al padre
- [ ] Probar en móvil (iOS + Android)
- [ ] Verificar PWA install prompt
