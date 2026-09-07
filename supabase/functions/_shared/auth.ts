import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthResult {
  ok: boolean;
  userId?: string;
  role?: string;
  email?: string;
  error?: string;
  status?: number;
}

/**
 * Verify caller JWT and return user profile with role.
 * Use this in ALL edge functions that require authentication.
 *
 * @param req - The incoming Request
 * @param allowedRoles - Array of allowed roles (e.g. ['admin', 'directora', 'asistente'])
 *                       If empty/undefined, any authenticated user is allowed.
 */
export async function verifyAuth(
  req: Request,
  allowedRoles?: string[]
): Promise<AuthResult> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!SUPABASE_URL || !ANON_KEY) {
    return { ok: false, error: 'Server configuration error', status: 500 };
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return { ok: false, error: 'No authorization provided', status: 401 };
  }

  // Create client with user's JWT to verify signature
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  });

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: 'Invalid or expired token', status: 401 };
  }

  // Get profile with role
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: profile, error: profileErr } = await adminClient
    .from('profiles')
    .select('role, email, name')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr || !profile) {
    return { ok: false, error: 'Profile not found', status: 403 };
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(profile.role)) {
    return { ok: false, error: 'Insufficient permissions', status: 403 };
  }

  return {
    ok: true,
    userId: user.id,
    role: profile.role,
    email: profile.email,
  };
}

/**
 * Create a service-role Supabase client (for internal operations).
 */
export function getServiceClient() {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}
