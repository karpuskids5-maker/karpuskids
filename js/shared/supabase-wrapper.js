/**
 * Wrapper ESM para supabase-js UMD local.
 * Carga el bundle UMD via script tag y expone createClient como ESM export.
 * Esto evita la dependencia del CDN de jsdelivr.
 */

// El UMD ya fue cargado como <script> en el HTML antes de los módulos.
// window.supabase estará disponible.
// Si no está disponible (carga asíncrona), esperamos.

function getSupabaseLib() {
  if (window.supabase && window.supabase.createClient) {
    return window.supabase;
  }
  throw new Error('[supabase-wrapper] window.supabase no disponible. Asegúrate de cargar js/shared/supabase-js.min.js antes de los módulos.');
}

export function createClient(url, key, opts) {
  return getSupabaseLib().createClient(url, key, opts);
}
