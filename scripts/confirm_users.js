
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://wwnfonkvemimwiqjpkij.supabase.co";
// Using Service Role Key to bypass email confirmation requirement
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3bmZvbmt2ZW1pbXdpcWpwa2lqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzgzNjQzNSwiZXhwIjoyMDgzNDEyNDM1fQ.Lo8XF_CDN88_kkFaeU_mARVXsdwd_ZVbP-bTRVIa1qg";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const usersToConfirm = [
  'maestra@karpus.local',
  'directora@karpus.local',
  'padre@karpus.local',
  'asistente@karpus.local'
];

async function confirmUsers() {
  console.log('Iniciando confirmación de usuarios...');

  for (const email of usersToConfirm) {
    try {
      // 1. Get user by email to find ID
      // Admin API uses listUsers
      const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
      
      if (listError) {
        console.error(`Error listando usuarios: ${listError.message}`);
        continue;
      }

      const user = users.find(u => u.email === email);

      if (!user) {
        console.log(`Usuario ${email} no encontrado. Intentando crearlo...`);
        // Create user if not exists
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: email,
          password: 'password123', // Default password
          email_confirm: true,
          user_metadata: { role: email.split('@')[0] } // role based on email prefix
        });

        if (createError) {
          console.error(`Error creando ${email}: ${createError.message}`);
        } else {
          console.log(`Usuario ${email} creado y confirmado.`);
        }
      } else {
        if (user.email_confirmed_at) {
            console.log(`Usuario ${email} ya estaba confirmado.`);
        } else {
            // 2. Update user to set email_confirmed_at
            const { data, error: updateError } = await supabase.auth.admin.updateUserById(
                user.id,
                { email_confirm: true }
            );

            if (updateError) {
                console.error(`Error confirmando ${email}: ${updateError.message}`);
            } else {
                console.log(`Usuario ${email} confirmado exitosamente.`);
            }
        }
      }

    } catch (e) {
      console.error(`Excepción procesando ${email}:`, e);
    }
  }
}

confirmUsers();
