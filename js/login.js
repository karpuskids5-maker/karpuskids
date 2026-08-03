import { supabase, initOneSignal, TERMS_VERSION } from "./shared/supabase.js";

// ── Protección contra fuerza bruta (3 intentos → 1 min de espera) ─────────────
const RATE_LIMIT = {
  MAX_ATTEMPTS: 3,              // bloquear al 3er intento
  WINDOW_MS:    5 * 60 * 1000,  // ventana de 5 minutos
  LOCKOUT_MS:   60 * 1000,      // bloqueo de 1 minuto

  _key: 'karpus_login_attempts',

  getState() {
    try { return JSON.parse(localStorage.getItem(this._key) || '{}'); } catch (_) { return {}; }
  },

  isLocked() {
    const s = this.getState();
    if (!s.lockedUntil) return false;
    if (Date.now() < s.lockedUntil) return true;
    // Bloqueo expirado — limpiar
    localStorage.removeItem(this._key);
    return false;
  },

  getRemainingLockTime() {
    const s = this.getState();
    if (!s.lockedUntil) return 0;
    return Math.max(0, Math.ceil((s.lockedUntil - Date.now()) / 1000)); // segundos
  },

  recordFailure() {
    const s = this.getState();
    const now = Date.now();
    // Resetear si la ventana expiró
    if (s.windowStart && now - s.windowStart > this.WINDOW_MS) {
      localStorage.setItem(this._key, JSON.stringify({ attempts: 1, windowStart: now }));
      return false;
    }
    const attempts = (s.attempts || 0) + 1;
    const state = { attempts, windowStart: s.windowStart || now };
    if (attempts >= this.MAX_ATTEMPTS) {
      state.lockedUntil = now + this.LOCKOUT_MS;
    }
    localStorage.setItem(this._key, JSON.stringify(state));
    return attempts >= this.MAX_ATTEMPTS;
  },

  recordSuccess() {
    localStorage.removeItem(this._key);
  },

  getAttemptsLeft() {
    const s = this.getState();
    return Math.max(0, this.MAX_ATTEMPTS - (s.attempts || 0));
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  try { initOneSignal(); } catch (_) {}

  const acceptTerms  = document.getElementById('acceptTerms');
  const termsWrapper = document.getElementById('termsWrapper');
  const loginForm    = document.getElementById('loginForm');

  // ── Verificar si ya hay sesión activa ────────────────────────────────────
  const urlParams = new URLSearchParams(window.location.search);
  const reason    = urlParams.get('reason');

  const { data: { session } } = await supabase.auth.getSession();
  
  // Si es por falta de términos, mostrar mensaje y botón simplificado
  if (reason === 'terms' && termsWrapper && session?.user) {
    termsWrapper.classList.add('animate-pulse', 'ring-2', 'ring-orange-500', 'p-4', 'rounded-2xl', 'bg-orange-50/50');
    
    // Ocultar campos de login normales
    const emailField = document.getElementById('email')?.closest('.group');
    const passField  = document.getElementById('password')?.closest('.group');
    const submitBtn  = loginForm?.querySelector('button[type="submit"]');
    
    if (emailField) emailField.style.display = 'none';
    if (passField)  passField.style.display = 'none';
    
    if (submitBtn) {
      submitBtn.textContent = 'Aceptar Términos y Entrar 🚀';
      submitBtn.classList.remove('bg-gradient-to-r', 'from-blue-500', 'via-indigo-500', 'to-purple-600');
      submitBtn.classList.add('bg-orange-500');
      
      // Cambiar comportamiento del form
      loginForm.onsubmit = async (e) => {
        e.preventDefault();
        if (!acceptTerms.checked) { alert('Acepta los términos.'); return; }
        
        submitBtn.disabled = true;
        submitBtn.textContent = 'Guardando...';
        
        try {
          await supabase.from('terms_acceptance').upsert({
            user_id:       session.user.id,
            terms_version: TERMS_VERSION,
            accepted_at:   new Date().toISOString()
          }, { onConflict: 'user_id,terms_version' });
          
          localStorage.setItem('karpus_terms_accepted_' + TERMS_VERSION, 'true');
          await redirectByRole(session.user.id);
        } catch (err) {
          alert('Error al guardar. Intenta de nuevo.');
          submitBtn.disabled = false;
        }
      };
    }

    const msg = document.createElement('p');
    msg.className = 'text-xs text-orange-600 font-bold mt-2 text-center';
    msg.textContent = 'Hemos actualizado nuestras políticas. Por favor, acéptalas para continuar al panel.';
    termsWrapper.appendChild(msg);
    return; // No seguir con el resto de la lógica de sesión activa normal
  }

  if (session?.user) {
    // Ya está logueado y NO es por falta de términos — redirigir directamente
    await redirectByRole(session.user.id);
    return;
  }

  // Verificar si ya aceptó en este dispositivo (localStorage como caché rápida)
  const localAccepted = localStorage.getItem('karpus_terms_accepted_' + TERMS_VERSION);
  if (localAccepted === 'true' && acceptTerms) {
    acceptTerms.checked = true;
    if (termsWrapper) termsWrapper.style.opacity = '0.5';
  }

  if (!loginForm) return;

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Validar términos
    if (acceptTerms && !acceptTerms.checked) {
      alert('Debes aceptar la Política de Privacidad y los Términos de Uso para continuar.');
      acceptTerms.focus();
      return;
    }

    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const submitBtn = document.getElementById('btnLogin');
    const btnText   = document.getElementById('btnLoginText');
    const btnIcon   = document.getElementById('btnLoginIcon');
    const errorDiv  = document.getElementById('loginError');
    const originalText = btnText?.textContent || 'Ingresar al Panel';

    const showError = (msg) => {
      if (errorDiv) { errorDiv.textContent = msg; errorDiv.classList.remove('hidden'); }
      else alert(msg);
    };

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { showError('Ingresa un correo válido.'); return; }
    if (!password || password.length < 6) { showError('La contraseña debe tener al menos 6 caracteres.'); return; }

    // ── Verificar bloqueo por intentos fallidos ──────────────────────────────
    if (RATE_LIMIT.isLocked()) {
      const secs = RATE_LIMIT.getRemainingLockTime();
      showError(`Demasiados intentos. Espera ${secs} segundo${secs !== 1 ? 's' : ''}.`);
      // Countdown en tiempo real
      const countdownInterval = setInterval(() => {
        if (!RATE_LIMIT.isLocked()) {
          clearInterval(countdownInterval);
          const errorDiv = document.getElementById('loginError');
          if (errorDiv) errorDiv.classList.add('hidden');
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        const s = RATE_LIMIT.getRemainingLockTime();
        showError(`Demasiados intentos. Espera ${s} segundo${s !== 1 ? 's' : ''}.`);
      }, 1000);
      return;
    }

    if (errorDiv) errorDiv.classList.add('hidden');
    if (submitBtn) submitBtn.disabled = true;
    if (btnText) btnText.textContent = 'Verificando...';
    if (btnIcon) btnIcon.textContent = '⏳';

    try {
      // 1. Autenticación
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;

      const userId = authData.user.id;

      // 2. Registrar aceptación de términos si no está registrada
      if (acceptTerms?.checked) {
        localStorage.setItem('karpus_terms_accepted_' + TERMS_VERSION, 'true');
        await supabase.from('terms_acceptance').upsert({
          user_id:       userId,
          terms_version: TERMS_VERSION,
          accepted_at:   new Date().toISOString()
        }, { onConflict: 'user_id,terms_version', ignoreDuplicates: true });
      }

      // 3. OneSignal
      try { await initOneSignal(authData.user); } catch (_) {}

      // 4. Registrar login exitoso, actualizar último acceso y redirigir
      RATE_LIMIT.recordSuccess();
      
      // Actualizar último acceso en el perfil (Uso de then() para evitar TypeError)
      supabase.from('profiles')
        .update({ last_sign_in_at: new Date().toISOString() })
        .eq('id', userId)
        .then(() => {});

      supabase.from('login_attempts')
        .insert({ email, success: true })
        .then(() => {});

      localStorage.setItem('karpus_user', JSON.stringify({ id: userId }));
      await redirectByRole(userId);

    } catch (error) {
      const msg  = String(error?.message || '');
      const name = String(error?.name || '');
      const isNetwork = name === 'AuthRetryableFetchError' || msg.includes('Failed to fetch') || msg.includes('NetworkError');

      let errorMessage = 'Ocurrió un error inesperado. Intenta de nuevo.';
      if (isNetwork)                               errorMessage = 'Sin conexión. Verifica tu internet.';
      else if (msg.includes('Invalid login'))      errorMessage = 'Correo o contraseña incorrectos.';
      else if (msg.includes('Email not confirmed')) errorMessage = 'Confirma tu correo antes de ingresar.';

      // Registrar intento fallido en Supabase para rate limiting server-side
      if (!isNetwork && msg.includes('Invalid login')) {
        supabase.from('login_attempts')
          .insert({ email, success: false })
          .then(() => {});
          
        const locked = RATE_LIMIT.recordFailure();
        if (locked) {
          errorMessage = `Cuenta bloqueada por 1 minuto. Demasiados intentos fallidos.`;
        } else {
          const left = RATE_LIMIT.getAttemptsLeft();
          errorMessage = 'Correo o contraseña incorrectos.';
          if (left <= 2) errorMessage += ` (${left} intento${left !== 1 ? 's' : ''} restante${left !== 1 ? 's' : ''} antes del bloqueo)`;
        }
      }

      const errorDiv = document.getElementById('loginError');
      if (errorDiv) { errorDiv.textContent = errorMessage; errorDiv.classList.remove('hidden'); }
      else alert(errorMessage);

      if (submitBtn) submitBtn.disabled = false;
      if (btnText) btnText.textContent = originalText;
      if (btnIcon) btnIcon.textContent = '→';
    }
  });
});

async function redirectByRole(userId) {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;

    if (!profile) {
      alert('Tu cuenta no tiene un perfil configurado. Por favor, contacta al administrador.');
      await supabase.auth.signOut();
      window.location.reload();
      return;
    }

    const role = (profile?.role || '').toLowerCase();
    const routes = {
      directora: 'panel_directora.html',
      maestra:   'panel-maestra.html',
      padre:     'panel_padres.html',
      asistente: 'panel_asistente.html',
      admin:     'panel_control.html'
    };

    if (routes[role]) {
      window.location.href = routes[role];
    } else {
      await supabase.auth.signOut();
      window.location.reload();
    }
  } catch (e) {
    alert('Error al obtener el perfil. Intenta de nuevo.');
  }
}
