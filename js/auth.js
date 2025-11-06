// js/auth.js

const Auth = (()=>{
  const KEY = 'karpus-auth';

  async function login(email, password){
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem(KEY, JSON.stringify(data.user));
        return data.user;
      } else {
        return null;
      }
    } catch (error) {
      console.error('Login failed:', error);
      return null;
    }
  }

  function logout(){
    localStorage.removeItem(KEY);
  }

  function currentUser(){
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e){ return null; }
  }

  function requireRole(role){
    const user = currentUser();
    if(!user) return { ok:false, reason:'no_user' };
    if(Array.isArray(role)) return { ok: role.includes(user.role) };
    return { ok: user.role === role };
  }

  function routeForRole(role){
    switch(role){
      case 'directora': return 'panel_directora.html';
      case 'maestra': return 'panel-maestra.html';
      case 'padre': return 'panel_padres.html';
      case 'asistente': return 'panel_asistente.html';
      default: return 'index.html';
    }
  }

  return { login, logout, currentUser, requireRole, routeForRole };
})();

// Expose globally
window.Auth = Auth;
