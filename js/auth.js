// Simple auth module using localStorage (demo only)
const Auth = (function(){
  const KEY = 'karpus_current_user';
  const USERS = [
    { email: 'directora@karpus.local', password: '123456', role: 'directora', name: 'Directora' },
    { email: 'maestra@karpus.local', password: '123456', role: 'maestra', name: 'Maestra' },
    { email: 'padre@karpus.local', password: '123456', role: 'padre', name: 'Padre/Madre' },
    { email: 'asistente@karpus.local', password: '123456', role: 'asistente', name: 'Recepcionista' },
  ];

  function login(email, password){
    const user = USERS.find(u => u.email.toLowerCase() === String(email).toLowerCase() && u.password === String(password));
    if(!user) return null;
    try { localStorage.setItem(KEY, JSON.stringify({ email: user.email, role: user.role, name: user.name })); } catch(e) {}
    return { email: user.email, role: user.role, name: user.name };
  }

  function logout(){
    try { localStorage.removeItem(KEY); } catch(e) {}
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

  // Helper: enforce role and redirect to login when mismatched or no user
  function enforceRole(role){
    const check = requireRole(role);
    if(!check.ok){
      try { logout(); } catch (e) {}
      if (typeof window !== 'undefined') {
        window.location.href = 'login.html';
      }
      return false;
    }
    return true;
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

  return { login, logout, currentUser, requireRole, enforceRole, routeForRole };
})();

// Expose globally
window.Auth = Auth;
