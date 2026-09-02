/**
 * 📄 upload-receipt — Edge Function
 * Sube el volante/justificante de una donación realizada de forma pública
 * (usuario NO autenticado) al bucket `karpus-uploads`, carpeta `donaciones/`.
 *
 * Seguridad:
 *  - No requiere sesión autenticada (verify_jwt = false); solo el anon key.
 *  - Usa la service role internamente para escribir (omite RLS de storage que
 *    solo permite inserts a usuarios autenticados).
 *  - Valida estrictamente el archivo (imagen o PDF, máx 5 MB) y la ruta
 *    (solo carpeta `donaciones/`, extensión permitida, sin traversal).
 *  - Genera un nombre único y aleatorio (no permite elegir la ruta).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const ALLOWED_BUCKETS = new Set(['karpus-uploads']);
const ALLOWED_EXTENSIONS = new Set(['webp', 'jpg', 'jpeg', 'png', 'gif', 'pdf']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing env vars' }, 500);

    const body = await req.json() as Record<string, unknown>;

    const base64 = String(body.base64 ?? '');
    const mimeType = String(body.mimeType ?? 'image/jpeg').toLowerCase();

    if (!base64) return json({ error: 'base64 is required' }, 400);
    if (base64.length > MAX_BYTES * 1.4) return json({ error: 'File too large (max 5 MB)' }, 400);

    // ── Validar mime ─────────────────────────────────────────────────────────
    const isImage = mimeType.startsWith('image/');
    const isPdf = mimeType === 'application/pdf';
    if (!isImage && !isPdf) return json({ error: 'Tipo de archivo no permitido' }, 400);

    // ── Decodificar ──────────────────────────────────────────────────────────
    let fileBytes: Uint8Array;
    try {
      const clean = base64.replace(/^data:[^;]+;base64,/, '');
      fileBytes = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
    } catch {
      return json({ error: 'base64 inválido' }, 400);
    }
    if (fileBytes.length === 0) return json({ error: 'Empty file' }, 400);
    if (fileBytes.length > MAX_BYTES) return json({ error: 'File too large (max 5 MB)' }, 400);

    // ── Extensión / ruta (generada por el servidor) ──────────────────────────
    let ext = isPdf
      ? 'pdf'
      : mimeType === 'image/png' ? 'png' : mimeType === 'image/gif' ? 'gif' : 'webp';
    if (!ALLOWED_EXTENSIONS.has(ext)) return json({ error: 'Extensión no permitida' }, 400);

    const path = `donaciones/receipt-${Date.now()}-${crypto.randomUUID()}.${ext}`;

    // ── Subir con service role (anula RLS de solo-autenticados) ──────────────
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const contentType = isPdf ? 'application/pdf' : ext === 'webp' ? 'image/webp' : mimeType;

    const { error: uploadError } = await supabase.storage
      .from('karpus-uploads')
      .upload(path, fileBytes, {
        contentType,
        upsert: false,
        cacheControl: '31536000',
      });

    if (uploadError) {
      console.error('[upload-receipt] Upload error:', uploadError.message);
      return json({ error: uploadError.message }, 500);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('karpus-uploads')
      .getPublicUrl(path);

    console.log(`[upload-receipt] ✅ ${path} | ${Math.round(fileBytes.length / 1024)}KB`);
    return json({ success: true, publicUrl, path, mimeType: contentType });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[upload-receipt] Unexpected error:', msg);
    return json({ error: msg }, 500);
  }
});
