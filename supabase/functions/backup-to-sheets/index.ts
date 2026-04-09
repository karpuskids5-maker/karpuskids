/**
 * 📊 backup-to-sheets — Edge Function
 * Exporta datos críticos de Karpus Kids a Google Sheets automáticamente.
 *
 * Tablas que respalda:
 *   - students      → Hoja "Estudiantes"
 *   - payments      → Hoja "Pagos"
 *   - attendance    → Hoja "Asistencia" (últimos 30 días)
 *   - profiles      → Hoja "Personal"
 *
 * Cómo invocar:
 *   POST /functions/v1/backup-to-sheets
 *   Body: { "tables": ["students","payments"] }  ← opcional, sin body = todas
 *
 * Variables de entorno requeridas (Supabase Dashboard → Edge Functions → Secrets):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  — email de la cuenta de servicio
 *   GOOGLE_PRIVATE_KEY            — clave privada RSA (con \n reales)
 *   GOOGLE_SPREADSHEET_ID         — ID del Google Sheet destino
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// ── Google Sheets Auth (JWT Service Account) ──────────────────────────────────
async function getGoogleAccessToken(email: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: studiantes', rows);
        results.students = rows.length - 1;
      }

      if (table === 'payments') {
        const { data } = await supabase
          .from('payments')
          .select('id, student_id, students:student_id(name), amount, status, month_paid, due_date, paid_date, method, bank, reference, created_at')
          .order('created_at', { ascending: false })
          .limit(2000);

        rows = [
          ['ID', 'Estudiante', 'Monto', 'Estado', 'Mes', 'Fecha Límite', 'Fecha Pago', 'Método'`Backup: ${timestamp}`],
          ...(data || []).map(s => [
            s.id, s.name,
            (s.classrooms as { name?: string } | null)?.name ?? '',
            s.p1_name ?? '', s.p1_phone ?? '', s.p1_email ?? '',
            s.p2_name ?? '', s.p2_phone ?? '',
            s.is_active ? 'Sí' : 'No',
            s.monthly_fee ?? 0, s.due_day ?? 5,
            fmt(s.created_at)
          ])
        ];
        await ensureSheet(token, SHEET_ID, 'Estudiantes');
        await writeToSheet(token, SHEET_ID, 'Eng | number | null)[][] = [];

      if (table === 'students') {
        const { data } = await supabase
          .from('students')
          .select('id, name, classroom_id, classrooms:classroom_id(name), p1_name, p1_phone, p1_email, p2_name, p2_phone, is_active, monthly_fee, due_day, created_at')
          .order('name');

        rows = [
          ['ID', 'Nombre', 'Aula', 'Tutor 1', 'Tel. Tutor 1', 'Email Tutor 1', 'Tutor 2', 'Tel. Tutor 2', 'Activo', 'Mensualidad', 'Día Vencimiento', 'Fecha Registro', ué tablas respaldar (default: todas)
    let body: { tables?: string[] } = {};
    try { body = await req.json(); } catch (_) {}
    const tablesToBackup = body.tables || ['students', 'payments', 'attendance', 'profiles'];

    // Obtener token de Google
    const token = await getGoogleAccessToken(SA_EMAIL, SA_KEY.replace(/\\n/g, '\n'));

    const results: Record<string, number> = {};
    const timestamp = new Date().toLocaleString('es-DO');

    for (const table of tablesToBackup) {
      let rows: (striEY        = Deno.env.get('GOOGLE_PRIVATE_KEY')        ?? '';
    const SHEET_ID      = Deno.env.get('GOOGLE_SPREADSHEET_ID')     ?? '';

    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing Supabase env vars' }, 500);
    if (!SA_EMAIL || !SA_KEY || !SHEET_ID) return json({ error: 'Missing Google env vars. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SPREADSHEET_ID' }, 500);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Qst fmt = (d: string | null) => d ? new Date(d).toLocaleString('es-DO') : '';

// ── Main ──────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const SA_EMAIL      = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL') ?? '';
    const SA_Kring } }) => s.properties.title === sheetName);

  if (!exists) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: sheetName } } }]
        }),
      }
    );
  }
}

// ── Formatear fecha ───────────────────────────────────────────────────────────
coname}): ${err}`);
  }
}

// ── Asegurar que la hoja existe ───────────────────────────────────────────────
async function ensureSheet(token: string, spreadsheetId: string, sheetName: string) {
  // Obtener hojas existentes
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const data = await res.json();
  const exists = (data.sheets || []).some((s: { properties: { title: st if (!rows.length) return;

  // 2. Escribir nuevos datos
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: rows }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets write error (${sheetNstringify(tokenData));
  return tokenData.access_token;
}

// ── Escribir en Google Sheets ─────────────────────────────────────────────────
async function writeToSheet(
  token: string,
  spreadsheetId: string,
  sheetName: string,
  rows: (string | number | null)[][]
) {
  // 1. Limpiar hoja existente
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}:clear`,
    { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }
  );

 mCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${sigInput}.${sigB64}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Google auth failed: ' + JSON.
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(sigInput)
  );

  const sigB64 = btoa(String.fro'RS256', typ: 'JWT' };
  const payload = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const headerB64  = encode(header);
  const payloadB64 = encode(payload);
  const sigInput   = `${headerB64}.${payloadB64}`;

  // Import RSA private key
  const pemBody = privateKey