import { supabase, initOneSignal } from "./supabase.js";

const TERMS_VERSION = '1.0';

document.addEventListener('DOMContentLoaded', async () => {
  try { initOneSignal(); } catch (_) {}

  // ── Verificar si ya hay sesión activa ────────────────────────────────────
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    // Ya está logueado — redirigir directamente
    await redirectByRole(session.user.id);
    return;
  }

  // ── Manejar checkbox de términos ─────────────────────────────────────────
  const acceptTerms = document.getElementById('acceptTerms');
  const termsWrapper = document.getElementById('termsWrapper');

  // Verificar si ya aceptó en este dispositivo (localStorage como caché rápida)
  const localAccepted = localStorage.getItem('karpus_terms_accepted_' + TERMS_VERSION);
  if (localAccepted === 'true' && acceptTerms) {
    acceptTerms.checked = true;
    if (termsWrapper) termsWrapper.style.opacity = '0.5';
  }

  const loginForm = document.getElementById('loginForm');
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
    const submitBtn = loginForm.querySelector('button[type="submit"]') || loginForm.querySelector('button');
    const originalHTML = submitBtn.innerHTML;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { alert('Ingrese un correo válido.'); return; }
    if (!password || password.length < 6) { alert('La contraseña debe tener al menos 6 caracteres.'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Verificando...';

    try {
      // 1. Autenticación
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;

      const userId = authData.user.id;

      // 2. Registrar aceptación de términos si no está registrada
      if (acceptTerms?.checked) {
        // Guardar en localStorage para no volver a preguntar en este dispositivo
        localStorage.setItem('karpus_terms_accepted_' + TERMS_VERSION, 'true');

        // Guardar en Supabase (upsert — no duplica si ya existe)
        await supabase.from('terms_acceptance').upsert({
          user_id:       userId,
          terms_version: TERMS_VERSION,
          accepted_at:   new Date().toISOString()
        }, { onConflict: 'user_id,terms_version', ignoreDuplicates: true });
      }

      // 3. OneSignal
      try { await initOneSignal(authData.user); } catch (_) {}

      // 4. Redirigir
      localStorage.setItem('karpus_user', JSON.stringify({ id: userId }));
      await redirectByRole(userId);

    } catch (error) {
      console.error('Error en el inicio de sesión:', error);
      const msg  = String(error?.message || '');
      const name = String(error?.name || '');
      const isNetwork = name === 'AuthRetryableFetchError' || msg.includes('Failed to fetch') || msg.includes('NetworkError');

      let errorMessage = 'Ocurrió un error inesperado. Por favor, intente de nuevo.';
      if (isNetwork)                              errorMessage = 'Sin conexión. Verifica tu internet e intenta de nuevo.';
      else if (msg.includes('Invalid login'))     errorMessage = 'Correo o contraseña incorrectos.';
      else if (msg.includes('Email not confirmed')) errorMessage = 'Confirma tu correo antes de ingresar.';

      alert(errorMessage);
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalHTML;
    }
  });
});

async function redirectByRole(userId) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    const role = (profile?.role || '').toLowerCase();
    const routes = {
      directora: 'panel_directora.html',
      maestra:   'panel-maestra.html',
      padre:     'panel_padres.html',
      asistente: 'panel_asistente.html'
    };

    if (routes[role]) window.location.href = routes[role];
    else alert('Rol no reconocido: ' + role);
  } catch (e) {
    console.error('Error obteniendo perfil:', e);
    alert('Error al obtener el perfil. Intenta de nuevo.');
  }
}
