import { supabase } from "./supabase.js";

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const submitBtn = loginForm.querySelector('button');
      const originalText = submitBtn.textContent;

      try {
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
        else alert('Rol no reconocido');

      } catch (error) {
        console.error(error);
        alert('Error de acceso: ' + (error.message || 'Credenciales incorrectas'));
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });
  }
});