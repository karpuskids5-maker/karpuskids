
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://wwnfonkvemimwiqjpkij.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3bmZvbmt2ZW1pbXdpcWpwa2lqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzgzNjQzNSwiZXhwIjoyMDgzNDEyNDM1fQ.Lo8XF_CDN88_kkFaeU_mARVXsdwd_ZVbP-bTRVIa1qg";

console.log("START CHECK");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function checkProfile() {
  try {
    console.log("Fetching users...");
    const { data, error: listError } = await supabase.auth.admin.listUsers();
    
    if(listError) {
        console.error("List Error:", listError);
        return;
    }

    const users = data.users || [];
    console.log(`Found ${users.length} users`);

    const maestra = users.find(u => u.email === 'maestra@karpus.local');
    if(!maestra) {
        console.log('Usuario maestra no encontrado en Auth');
        return;
    }

    console.log('Auth User:', maestra.id, maestra.email);

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', maestra.id)
        .maybeSingle(); // Use maybeSingle to avoid error if null

    if(profileError) {
        console.error('Error buscando perfil:', profileError);
    } else if (!profile) {
        console.log('Perfil NO existe. Creando...');
        // Manually create profile if missing
        const { error: insertError } = await supabase.from('profiles').insert({
            id: maestra.id,
            email: maestra.email,
            name: 'Maestra',
            role: 'maestra'
        });
        if(insertError) console.error("Error creating profile:", insertError);
        else console.log("Profile created manually.");
    } else {
        console.log('Perfil encontrado:', profile);
    }
  } catch(e) {
    console.error("CRITICAL:", e);
  }
}

checkProfile();
