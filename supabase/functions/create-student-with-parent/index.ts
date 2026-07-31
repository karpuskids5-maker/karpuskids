import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // ── Verificar autenticación del llamador (JWT) ─────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "No autenticado" }, 401);
    }

    const callerClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ error: "No autenticado" }, 401);

    // ── Verificar rol de staff (directora/admin/asistente) ──────────────
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();

    if (!profile || !["directora", "asistente", "admin"].includes(profile.role)) {
      return json({ error: "Acceso denegado. Solo staff autorizado." }, 403);
    }

    const body = await req.json();
    const studentData = body?.studentData;
    const parentData = body?.parentData;

    if (!studentData || !parentData || !parentData.email || !parentData.name) {
      return json({ error: "Faltan datos: studentData, parentData" }, 400);
    }

    // Validar email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(parentData.email))) {
      return json({ error: "Email del padre inválido" }, 400);
    }

    // 1. Crear el usuario padre en Supabase Auth
    let user: { id: string };
    const { data, error: authError } = await supabaseAdmin.auth.admin.createUser({
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
    } else if (data?.user) {
      user = data.user;
    } else {
      throw new Error("No se pudo crear el usuario del padre");
    }

    // 2. Insertar el perfil del padre si no existe
    const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
      id: user.id,
      name: String(parentData.name).slice(0, 200),
      email: String(parentData.email),
      phone: parentData.phone ? String(parentData.phone).slice(0, 50) : null,
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

    return json({ student: newStudent }, 201);
  } catch (error) {
    console.error("Error creando estudiante:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
