# 💖 INFORME DE ESTRATEGIA UX Y SISTEMA DINÁMICO DE REFERIDOS
## PANEL DE PADRES KARPUS KIDS: EXPERIENCIA EMOCIONAL & PROGRAMA EMBAJADORES

---

### 1. RESUMEN EJECUTIVO Y PROPÓSITO ESTRATÉGICO

El **Panel de Padres** de Karpus Kids es la ventana digital diaria a la vida escolar de los niños. Para lograr que los padres sientan deseo y emoción cada vez que inician sesión, el panel debe evolucionar de ser una simple herramienta administrativa a convertirse en una **Experiencia Emocional e Interactiva de Orgullo Familiar**.

Además, dado que los padres satisfechos son los mejores promotores del colegio, este informe detalla la arquitectura de un **Sistema Dinámico de Referidos ("Programa Embajadores Karpus Kids")**. Mediante este sistema, los padres obtienen incentivos directos (como 1 mes gratis de mensualidad o descuentos en colegiatura) al recomendar la estancia infantil a nuevos miembros de la comunidad.

---

### 2. ESTRATEGIA DE CONEXIÓN EMOCIONAL Y DESEO EN EL PANEL DE PADRES (UX/UI)

Para cautivar al padre desde el primer segundo que entra al panel, implementamos 5 pilares de diseño emocional:

#### 2.1 Hero de Bienvenida Emocional ("El Resumen de Felicidad")
- **Cartel de Saludo Dinámico:**
  - *"¡Buenos días, Familia Perez! Hoy [Nombre del Niño] está explorando el mundo en Maternal A 🎈"*
- **Highlight Reel Diario (Historias tipo Instagram):**
  - Un carrusel superior con burbujas de historias de 24 horas subidas por la maestra (primer alimento, hora del juego, siesta reconfortante).
- **Indicador de Ánimo y Estado en Vivo:**
  - Insignia animada que muestra en tiempo real cómo se siente el pequeño: `😄 Feliz y Activo` · `🍎 Merendando` · `😴 En hora de Siesta`.

#### 2.2 Registro de Logros y Micro-Hitos ("Insignias de Orgullo")
- **Gamificación Infantil para Padres:**
  - Colección de medallas digitales que el niño gana por su desarrollo madurativo: `🎨 Primer Dibujo del Mes`, `🥗 Campeón de Comida Saludable`, `🤝 Compañero Solidario`, `🎵 Pequeño Músico`.
- **Compartir en Redes Sociales en 1 Clic:**
  - Botón *"Presumir Logro"* que genera automáticamente una tarjeta con diseño estético para subir a Instagram Stories o estados de WhatsApp.

#### 2.3 Galería de Recuerdos en Alta Resolución
- **Descarga Directa de Fotografías y Videos:**
  - Botón de descarga en alta calidad para guardar recuerdos del niño directamente en el carrete del smartphone.
- **Álbum Semanal Automatizado:**
  - Resumen fotográfico de los mejores momentos de la semana con música ambiental suave y animación tipo pase de diapositivas.

#### 2.4 Notificaciones de Conexión Cálida
- **Mensajes Positivos Inesperados:**
  - Notificaciones Push motivacionales durante la jornada escolar: *"¿Sabías que hoy [Nombre del Niño] compartió sus juguetes con una sonrisa enorme? 🌟"*
- **Reporte Diario de Rutina con Animaciones:**
  - Visualización intuitiva con iconos festivos para biberones, alimentos, siestas y control de esfínteres.

#### 2.5 Interfaz Visual "Mundo de Exploración"
- **Paleta de Colores Estimulante:**
  - Tonos Menta Suave (`#10B981`), Azul Cielo (`#0EA5E9`), Amarillo Sol (`#FACC15`) y Rosa Algodón (`#EC4899`).
- **Efectos de Micro-Interacción:**
  - Animaciones de confeti al completar pagos o ver buenas calificaciones, burbujas flotantes suaves y botones redondeados tipo "almohadilla táctil".

---

### 3. ARQUITECTURA DEL SISTEMA DINÁMICO DE REFERIDOS ("EMBAJADORES KARPUS")

Los padres son la fuente #1 de conversión de nuevas familias. El **Programa Embajadores Karpus Kids** convierte el boca a boca en un juego interactivo transparente con recompensas automatizadas.

```
┌─────────────────────────────────────────────────────────────────────────┐
│              SISTEMA EMBAJADORES KARPUS KIDS (REFERIDOS)                │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
   ┌─────────────────────────────────┴─────────────────────────────────┐
   ▼                                                                   ▼
1. ENLACE Y QR ÚNICO                                    2. MOTOR DE RECOMPENSAS
   - Código familiar: KARPUS-FAMILIA-P123                 - 1er Referido = 10% Descuento
   - QR imprimible / escaneable                           - 2do Referido = 25% Descuento
   - Enlace directo a Preinscripción                     - 3er Referido = 1 MES GRATIS 🎉
                                     │
   ┌─────────────────────────────────┘
   ▼
3. MONITOREO Y TRACKING EN TIEMPO REAL (DASHBOARD DEL PADRE)
   - Invitar por WhatsApp (Tarjeta precargada)
   - Estados: 🟡 Invitado → 🔵 Preinscrito → 🟢 Matriculado Confirmado
   - Monedero Digital Karpus: Billetera de créditos aplicables a colegiatura
```

---

### 4. COMPONENTES CLAVE DEL PROGRAMA DE REFERIDOS

#### 4.1 Código de Referido y QR Personalizado
- Cada familia inscrita recibe automáticamente un código único (Ej: `KARPUS-RODRIGUEZ-982`) y un código QR personalizado.
- **Enlace de Registro Directo:** `https://karpuskids.com/preinscripcion.html?ref=KARPUS-RODRIGUEZ-982`

#### 4.2 Botonera de Compartir en 1 Clic (Viralidad Orgánica)
- **WhatsApp:** Abre directamente un mensaje personalizado precargado:
  > *"¡Hola! 🎈 Formo parte de la familia Karpus Kids y la atención a nuestro hijo ha sido maravillosa. Si estás buscando un lugar seguro y lleno de amor para tu pequeño, te regalo un descuento especial en su inscripción usando mi enlace: [LINK]"*
- **Instagram / Facebook:** Descarga de tarjeta gráfica promocional en alta definición lista para publicar en historias con el QR familiar.

#### 4.3 Niveles de Recompensas Gamificados (Escala de Beneficios)
| Nivel de Embajador | Referidos Matriculados | Recompensa para la Familia Promotora | Beneficio para la Familia Nueva |
| :--- | :---: | :--- | :--- |
| **Bronce** | 1 Niño | 15% de Descuento en la próxima mensualidad | 10% Descuento en Cuota de Inscripción |
| **Plata** | 2 Niños | 35% de Descuento en la próxima mensualidad | 15% Descuento en Cuota de Inscripción |
| **Oro (Embajador)** | **3 Niños** | **🎉 1 MES TOTALMENTE GRATIS DE MENSUALIDAD** | **20% Descuento en Cuota de Inscripción** |
| **Leyenda Karpus** | +4 Niños | $100 USD Crédito acumulable en Monedero Escolar | 20% Descuento en Inscripción |

#### 4.4 Panel de Seguimiento Transparente para el Padre (*Referral Dashboard*)
Ubicado dentro de la sección **"Mi Perfil / Embajadores"** en `panel_padres.html`:
1. **Línea de Tiempo del Referido:**
   - 💬 *Familia Gómez:* Enlace enviado (12 Feb)
   - 📝 *Familia Gómez:* Formulario de preinscripción completado (14 Feb)
   - 🏫 *Familia Gómez:* Visita al colegio agendada (16 Feb)
   - ✅ *Familia Gómez:* Matrícula oficializada → **¡Crédito de $RD 8,500 acreditado!**
2. **Monedero Digital Karpus (*Karpus Wallet*):**
   - Muestra el saldo acumulado en créditos de compensación.
   - Botón *"Aplicar Crédito a la Mensualidad del Mes"* con validación automática en la factura del día 25.

---

### 5. ARQUITECTURA TÉCNICA E IMPLEMENTACIÓN EN BASE DE DATOS (SUPABASE)

Para dar soporte completo al sistema de referidos en la infraestructura existente:

#### 5.1 Estructura de Tablas PostgreSQL

```sql
-- 1. Tabla de Códigos de Referido por Familia
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  code VARCHAR(50) UNIQUE NOT NULL,
  qr_url TEXT,
  total_invites_sent INT DEFAULT 0,
  successful_conversions INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Registro de Seguimiento de Referidos
CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_parent_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_family_name VARCHAR(150) NOT NULL,
  referred_email VARCHAR(150),
  referred_phone VARCHAR(50),
  status VARCHAR(30) DEFAULT 'invited' CHECK (status IN ('invited', 'registered', 'visited', 'enrolled', 'rejected')),
  reward_status VARCHAR(30) DEFAULT 'pending' CHECK (reward_status IN ('pending', 'approved', 'applied', 'expired')),
  discount_amount NUMERIC(10,2) DEFAULT 0.00,
  enrolled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Monedero Digital y Recompensas
CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  referral_id UUID REFERENCES public.referrals(id) ON DELETE CASCADE,
  reward_type VARCHAR(50) DEFAULT 'monthly_discount', -- 'monthly_discount', 'free_month', 'cashback'
  amount NUMERIC(10,2) NOT NULL,
  is_used BOOLEAN DEFAULT FALSE,
  applied_to_payment_id UUID REFERENCES public.payments(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 5.2 Lógica de Automatización (Edge Function & Triggers)
1. **Trigger al Matricular Nuevo Alumno (`on_student_enrolled`):**
   - Cuando la Directora aprueba la matrícula de un niño con un código `ref` activo, el sistema actualiza el estado del referido a `enrolled`.
2. **Generación Automática del Crédito:**
   - Se calcula el nivel del embajador (1, 2 o 3 referidos) e inserta el crédito correspondiente en `referral_rewards`.
3. **Descuento Automático en el Cobro del Día 25:**
   - El script de facturación periódica detecta si el padre tiene un crédito activo en `referral_rewards` sin usar y descuenta el monto directamente de su cuota mensual.
4. **Notificación de Celebración (Push + Confeti):**
   - Al abrir el panel de padres, se dispara un modal de felicitación con animación de confeti:
     > *"¡Felicidades! La Familia Gómez completó su inscripción. Has ganado un 100% de descuento en tu próxima mensualidad 🎉"*

---

### 6. PLAN DE ACCIÓN RECOMENDADO Y CONCLUSIÓN

1. **Lanzar la Experiencia Emocional UX en el Panel de Padres:**
   - Inyectar el widget de historias diarias, insignias de orgullo y saludos dinámicos en `panel_padres.html`.
2. **Desplegar la Pestaña "Embajadores Karpus" en el Perfil:**
   - Incorporar el generador de QR, botón de compartir por WhatsApp y el contador de recompensas.
3. **Instalar la Migración de Base de Datos `referrals.sql`:**
   - Habilitar las tablas y políticas RLS para garantizar la privacidad de los datos.

Este informe sienta las bases para transformar el Panel de Padres de Karpus Kids en un **motor de retención emocional y adquisición orgánica de clientes**.
