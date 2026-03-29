
import { createClient } from '@supabase/supabase-js';

// Reemplazar con tus credenciales si es necesario, aunque estas parecen ser las del proyecto actual
const SUPABASE_URL = "https://wwnfonkvemimwiqjpkij.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3bmZvbmt2ZW1pbXdpcWpwa2lqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzgzNjQzNSwiZXhwIjoyMDgzNDEyNDM1fQ.Lo8XF_CDN88_kkFaeU_mARVXsdwd_ZVbP-bTRVIa1qg";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function fixAuthActivation() {
  console.log('🚀 Iniciando proceso de activación forzada de usuarios...');

  try {
    // 1. Obtener lista de usuarios de Auth
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    
    if (listError) throw listError;

    console.log(`🔍 Se encontraron ${users.length} usuarios en total.`);

    for (const user of users) {
      if (!user.email_confirmed_at) {
        console.log(`✅ Confirmando correo para: ${user.email}...`);
        
        const { error: updateError } = await supabase.auth.admin.updateUserById(
          user.id,
          { email_confirm: true }
        );

        if (updateError) {
          console.error(`❌ Error confirmando a ${user.email}:`, updateError.message);
        } else {
          console.log(`✨ Usuario ${user.email} activado correctamente.`);
        }
      } else {
        console.log(`ℹ️ Usuario ${user.email} ya estaba activado.`);
      }
    }

    console.log('\n🏁 Proceso finalizado.');
    console.log('💡 RECOMENDACIÓN: Para producción real, configura un servicio SMTP (Resend, SendGrid) en el Dashboard de Supabase > Settings > Auth.');

  } catch (err) {
    console.error('💥 Error fatal:', err.message);
  }
}

fixAuthActivation();
