# 🚀 Karpus Kids — Checklist de Producción
**Última actualización:** Mayo 2026

---

## 🔴 CRÍTICO — Hacer ANTES de ir a producción

### 1. ~~Compilar Tailwind CSS (eliminar CDN)~~ ✅ COMPLETADO
El CSS compilado está en `css/karpus-tailwind.css` (84KB, todas las clases incluidas).
Todos los paneles ya usan el CSS local — el CDN fue eliminado.

Para recompilar si se agregan nuevas clases:
```bash
# Requiere tailwindcss.exe (Tailwind v3 standalone CLI)
.\tailwindcss.exe -c tailwind.v3.config.js -i css/tailwind.v3.css -o css/karpus-tailwind.css --minify
```

### 2. Ejecutar SQLs en Supabase (en orden)
Ir a **Supabase Dashboard → SQL Editor** y ejecutar en este orden:

```
1. fix_attendance_system.sql   → Sistema de ponche digital
2. fix_posts_rls.sql           → Muro visible para padres
3. fix_mora_system.sql         → Sistema de mora y exoneración
4. fix_security_audit.sql      → Auditoría inmutable + calc_mora en DB
5. fix_period_close.sql        → Cierre de período con promedios
6. fix_academic_lifecycle.sql  → Ciclo de vida académico (period_id en tasks/posts)
```

### 3. Desplegar Edge Functions
```bash
supabase functions deploy get-posts
supabase functions deploy send-email
supabase functions deploy send-push
supabase functions deploy process-event
supabase functions deploy payment-reminders
supabase functions deploy resize-image
supabase functions deploy admin-reset-password
```

### 4. Configurar Secrets en Supabase
**Dashboard → Settings → Edge Functions → Secrets:**
```
RESEND_API_KEY         = re_xxxxxxxxxx
FROM_EMAIL             = Karpus Kids <avisos@karpuskids.com>
SUPABASE_SERVICE_ROLE_KEY = eyJ...
ONESIGNAL_APP_ID       = 47ce2d1e-152e-4ea7-9ddc-8e2142992989
ONESIGNAL_REST_API_KEY = your_key
```

---

## 🟠 ALTO — Verificar antes del deploy

### 5. SQL adicional (si no se ha ejecutado)
```sql
-- Columna access_code para QR de personal
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS access_code text;
UPDATE public.profiles SET access_code = notes
WHERE notes LIKE 'DIR-%' OR notes LIKE 'TEA-%' OR notes LIKE 'ASI-%';

-- Rol admin
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('directora','maestra','padre','asistente','admin'));

-- Columna validated_by en payments
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS validated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
```

### 6. Variables de entorno del servidor
El archivo `.env` está en `.gitignore` ✅ — nunca commitear.
En producción (GitHub Pages / Netlify / Vercel), configurar como variables de entorno del servidor.

---

## ✅ Ya completado en código

### Seguridad
- [x] `SERVICE_ROLE_KEY` NO está en ningún archivo JS del frontend
- [x] `ANON_KEY` hardcodeada en `js/shared/supabase.js` (es pública por diseño de Supabase)
- [x] Headers de seguridad en todos los paneles (X-Content-Type-Options, Referrer-Policy)
- [x] CSP (Content Security Policy) en paneles directora y asistente
- [x] Anti-clickjacking script en todos los paneles
- [x] `robots: noindex` en paneles privados
- [x] `.env` en `.gitignore`
- [x] `data/*.db` en `.gitignore`

### Librerías locales (sin CDN)
- [x] `lucide.min.js` descargado localmente en `js/shared/`
- [x] `chart.min.js` en `js/shared/`
- [x] `jspdf.min.js` en `js/shared/`
- [x] `jspdf-autotable.min.js` en `js/shared/`

### Auditoría de pagos
- [x] Trigger `trg_audit_payment` (en `fix_security_audit.sql`)
- [x] RPC `approve_payment` — aprobación segura en servidor
- [x] RPC `delete_payment` — soft delete con auditoría
- [x] RPC `waive_payment_mora` — exoneración de mora con log
- [x] Vista `v_payment_audit` para consultar historial

### Funcionalidades
- [x] Recibo PDF descargable en panel padres (pagos aprobados)
- [x] Sistema de mora acumulativa (RD$50/día, RD$500/semana)
- [x] Correos automáticos de mora cada 3 días (Edge Function)
- [x] QR de personal con `access_code` (no `notes`)
- [x] MutationObserver para iconos Lucide en contenido dinámico

### Performance
- [x] 50+ console.log eliminados
- [x] Scripts duplicados eliminados
- [x] Lucide local (sin CDN bloqueado por Tracking Prevention)

---

## 📋 Pruebas funcionales antes de producción

- [ ] Login con cada rol: padre, maestra, directora, asistente
- [ ] Muro del padre muestra publicaciones generales y del aula
- [ ] Ponche QR: estudiante, maestra, asistente, directora
- [ ] Aprobar pago → recibo por email al padre
- [ ] Push notification al padre al aprobar pago
- [ ] Descargar recibo PDF desde panel padres
- [ ] Quitar mora desde panel directora/asistente
- [ ] Correo de mora automático (probar manualmente con `payment-reminders`)
- [ ] PWA install prompt en móvil (iOS + Android)
- [ ] Sidebar colapso/expansión en desktop
- [ ] Sidebar hamburger en móvil

---

## 🌐 Configuración del servidor web (producción)

Agregar estos headers HTTP en el servidor (nginx/apache/CDN):
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
Permissions-Policy: camera=(self), microphone=(self), geolocation=()
```

Para GitHub Pages (CNAME: karpuskids.com), estos headers se configuran
en el CDN/proxy delante del sitio (Cloudflare recomendado).

---

## 📊 Estado actual del proyecto

| Área | Estado |
|------|--------|
| Tailwind CSS compilado | ✅ Listo (84KB, sin CDN) |
| Lucide local | ✅ Listo (sin CDN) |
| Chart.js, jsPDF locales | ✅ Listo |
| Bootstrap Icons local | ✅ Listo (panel_control) |
| Supabase JS local | ✅ Listo |
| Seguridad frontend (CSP, headers) | ✅ Listo |
| Rate limiting (chat, uploads, pagos) | ✅ Listo |
| Auditoría inmutable de pagos | ⚠️ Ejecutar `fix_security_audit.sql` |
| Sistema de mora (cálculo correcto) | ✅ Corregido (normalización UTC) |
| Recuperación de contraseña | ✅ Listo (`recuperar.html`) |
| Ciclo de vida académico | ⚠️ Ejecutar `fix_academic_lifecycle.sql` |
| Cierre de período con promedios | ⚠️ Ejecutar `fix_period_close.sql` |
| Edge Functions | ⚠️ Pendiente de deploy |
| Pruebas funcionales | ⏳ Pendiente |
