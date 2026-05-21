# 🚀 Karpus Kids — Checklist de Producción

## ✅ CÓDIGO (ya listo)
- [x] Todos los paneles tienen supabase-js.min.js local
- [x] Todos los paneles tienen lucide.min.js local
- [x] Todos los paneles tienen karpus-tailwind.css local
- [x] Todos los paneles tienen karpus-modern.css local
- [x] Sin CDNs críticos (solo Google Fonts y Jitsi que son externos por diseño)
- [x] Sin console.log en producción
- [x] Sin SERVICE_ROLE_KEY en frontend
- [x] .gitignore protege .env y scripts/
- [x] PWA configurado (manifest.json + sw.js)
- [x] Sistema de badges funcionando en todos los paneles
- [x] Sistema de ponche con notificaciones al padre
- [x] Chat con nombre de estudiante + padre visible
- [x] Panel control con cache localStorage

## 🗄️ SUPABASE — SQL (ejecutar en orden)

### Obligatorio antes de ir live:
- [ ] 1. `DEPLOY_PRODUCTION.sql` — SQL consolidado principal
- [ ] 2. `fix_security_audit.sql` — RPCs de pagos seguros
- [ ] 3. `fix_mora_system.sql` — Sistema de mora RD$50/día
- [ ] 4. `fix_academic_lifecycle.sql` — Períodos académicos
- [ ] 5. `fix_period_close.sql` — Cierre de período con promedios
- [ ] 6. `fix_production_security.sql` — Seguridad adicional
- [ ] 7. `fix_production_final.sql` — Cron jobs y storage policies

### Verificar después de ejecutar:
```sql
-- Verificar tablas críticas
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Verificar funciones críticas
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('process_door_punch','send_notification','get_my_role',
                       'get_unread_counts','find_or_create_private_conversation');

-- Verificar perfil admin
SELECT id, email, role FROM public.profiles WHERE role = 'admin';
```

## ⚡ SUPABASE — Edge Functions (desplegar)

```bash
# Instalar Supabase CLI si no está instalado
npm install -g supabase

# Login
supabase login

# Desplegar todas las funciones
supabase functions deploy send-push
supabase functions deploy send-email
supabase functions deploy process-event
supabase functions deploy payment-reminders
supabase functions deploy auto-payment-cycle
supabase functions deploy get-posts
supabase functions deploy create-student-with-parent
supabase functions deploy resize-image
```

### Variables de entorno en Supabase (Dashboard → Settings → Edge Functions):
```
SUPABASE_URL=https://wwnfonkvemimwiqjpkij.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<tu service role key>
ONESIGNAL_APP_ID=<tu app id de onesignal>
ONESIGNAL_REST_API_KEY=<tu rest api key de onesignal>
RESEND_API_KEY=<tu api key de resend>
FROM_EMAIL=Karpus Kids <avisos@karpuskids.com>
```

## 🌐 HOSTING (GitHub Pages / Netlify / Vercel)

### Si usas GitHub Pages:
1. Push al branch `main`
2. Settings → Pages → Source: `main` branch, `/ (root)`
3. El CNAME ya apunta a `karpuskids.com`

### Headers de seguridad recomendados (si usas Netlify/Vercel):
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

## 🔔 ONESIGNAL (notificaciones push)

1. Dashboard → App Settings → verificar que el dominio sea `karpuskids.com`
2. Verificar que `gcm_sender_id: "482941778795"` en manifest.json coincide con tu proyecto
3. Probar una notificación de prueba desde el dashboard

## 📱 PWA — Verificar en producción

1. Abrir `https://karpuskids.com/panel_padres.html` en Chrome móvil
2. Debe aparecer el banner "Agregar a pantalla de inicio"
3. Verificar que el ícono aparece correctamente (192x192 y 512x512)
4. Verificar que funciona offline (al menos la pantalla de login)

## 🔐 SEGURIDAD — Verificar en Supabase

- [ ] RLS habilitado en todas las tablas (verificar en Dashboard → Table Editor)
- [ ] Políticas de storage configuradas para `karpus-uploads` y `classroom_media`
- [ ] Email confirmación desactivada o configurada según necesidad
- [ ] Rate limiting en Auth configurado

## 🧪 PRUEBAS ANTES DE LANZAR

- [ ] Login con cada rol (padre, maestra, directora, asistente, admin)
- [ ] Ponche QR con matrícula de estudiante real
- [ ] Notificación push llega al padre después del ponche
- [ ] Email llega al padre después del ponche
- [ ] Publicar post en el muro (panel maestra)
- [ ] Padre ve el post en su muro
- [ ] Chat entre padre y maestra funciona
- [ ] Pago: padre sube comprobante → directora lo aprueba → padre recibe notificación
- [ ] Panel control carga con usuario admin

## 📋 ORDEN DE DEPLOY

1. Ejecutar SQL en Supabase
2. Desplegar Edge Functions
3. Configurar variables de entorno en Edge Functions
4. Push código a GitHub
5. Verificar que GitHub Pages sirve el sitio
6. Probar cada panel con usuario real
7. Activar OneSignal en producción
