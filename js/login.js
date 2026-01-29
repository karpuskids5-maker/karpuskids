import { supabase } from "./supabase.js";

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const submitBtn = loginForm.querySelector('button');
      const originalText = submitBtn.textContent;

      try {
        // Validación básica antes de llamar a Supabase
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          alert('Ingrese un correo válido.');
          return;
        }
        if (!password || password.length < 6) {
          alert('La contraseña debe tener al menos 6 caracteres.');
          return;
        }
        
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verificando...';

        // 1. Autenticación con Supabase
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (authError) throw authError;

        // 2. Obtener rol del perfil
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role, name')
          .eq('id', authData.user.id)
          .single();

        if (profileError) throw profileError;

        // 3. Redirección según rol
        localStorage.setItem('karpus_user', JSON.stringify(profile));
        
        if (profile.role === 'directora') window.location.href = 'panel_directora.html';
        else if (profile.role === 'maestra') window.location.href = 'panel-maestra.html'; // Ajustado al nombre real de tu archivo
        else if (profile.role === 'padre') window.location.href = 'panel_padres.html';
        else if (profile.role === 'asistente') window.location.href = 'panel_asistente.html';
        else alert('Rol no reconocido');

      } catch (error) {
        console.error('Error en el inicio de sesión:', error);
        let errorMessage = 'Ocurrió un error inesperado. Por favor, intente de nuevo.';
        const msg = String(error?.message || '');
        const name = String(error?.name || '');
        const isNetwork =
          name === 'AuthRetryableFetchError' ||
          msg.includes('Failed to fetch') ||
          msg.includes('ERR_NAME_NOT_RESOLVED') ||
          msg.includes('TypeError') ||
          msg.includes('NetworkError');
        if (isNetwork) {
          errorMessage = 'No se pudo conectar al servicio de autenticación. Verifique su conexión a internet y que la configuración de Supabase (URL y clave) sea correcta.';
        } else if (msg.includes('Invalid login credentials')) {
          errorMessage = 'El correo electrónico o la contraseña son incorrectos. Por favor, verifique sus datos.';
        } else if (msg.includes('Email not confirmed')) {
          errorMessage = 'Su cuenta aún no ha sido confirmada. Por favor, revise su correo electrónico y haga clic en el enlace de confirmación.';
        }
        alert(errorMessage);
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });
  }
});
