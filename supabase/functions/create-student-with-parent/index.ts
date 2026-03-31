import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { studentData, parentData } = await req.json();

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // 1. Crear el usuario padre en Supabase Auth
    const { data: { user }, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: parentData.email,
      password: parentData.password,
      email_confirm: true, // Auto-confirmar para simplificar
      user_metadata: {
        full_name: parentData.name,
        role: "padre",
      },
    });

    if (authError) {
      // Si el usuario ya existe, intentar obtenerlo
      if (authError.message.includes("already exists")) {
        console.warn("El padre ya existe, se reutilizará el usuario.");
        const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({ email: parentData.email });
        if (listError || !users || users.length === 0) {
          throw new Error(`El padre ya existe pero no se pudo encontrar: ${listError?.message || "Usuario no encontrado"}`);
        }
        user = users[0];
      } else {
        throw authError;
      }
    }

    // 2. Insertar el perfil del padre si no existe
    const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
      id: user.id,
      name: parentData.name,
      email: parentData.email,
      phone: parentData.phone,
      role: "padre",
    }, { onConflict: "id" });

    if (profileError) throw profileError;

    // 3. Insertar el estudiante, vinculándolo al padre
    const finalStudentData = {
      ...studentData,
      parent_id: user.id,
    };

    const { data: newStudent, error: studentError } = await supabaseAdmin
      .from("students")
      .insert(finalStudentData)
      .select()
      .single();

    if (studentError) throw studentError;

    return new Response(JSON.stringify({ student: newStudent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 201,
    });

  } catch (error) {
    console.error("Error creando estudiante:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
