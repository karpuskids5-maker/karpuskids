/**
 * 🖼️ resize-image — Edge Function
 * Redimensiona y comprime imágenes a WebP antes de guardarlas en Supabase Storage.
 *
 * Seguridad:
 *  - Requiere JWT válido del llamador (supabase.functions.invoke adjunta el token).
 *  - Solo buckets permitidos.
 *  - Valida la ruta: sin traversal, carpetas conocidas, extensiones permitidas.
 *  - Rutas personales (avatars/directors/profiles) deben contener el id del llamador.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_BUCKETS = new Set(['karpus-uploads', 'classroom_media', 'avatars']);
const ALLOWED_FOLDERS = new Set([
  'avatars', 'directors', 'students', 'staff', 'posts',
  'evidence', 'activities', 'payments', 'reports', 'carnets', 'profiles',
]);
const ALLOWED_EXTENSIONS = new Set(['webp', 'jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov', 'webm', 'pdf']);
const PERSONAL_FOLDERS = new Set(['avatars', 'directors', 'profiles']);

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// ── Validación de schema ──────────────────────────────────────────────────────
function validateInput(body: Record<string, unknown>): string | null {
  if (!body.base64 || typeof body.base64 !== 'string') return 'base64 is required';
  if (!body.path   || typeof body.path   !== 'string') return 'path is required';
  if (body.maxWidth  && (typeof body.maxWidth  !== 'number' || body.maxWidth  < 1 || body.maxWidth  > 4000)) return 'maxWidth must be 1-4000';
  if (body.maxHeight && (typeof body.maxHeight !== 'number' || body.maxHeight < 1 || body.maxHeight > 4000)) return 'maxHeight must be 1-4000';
  if (body.quality   && (typeof body.quality   !== 'number' || body.quality   < 1 || body.quality   > 100))  return 'quality must be 1-100';
  if (body.base64.length > 7_000_000) return 'Image too large (max ~5MB)';
  return null;
}

// ── Validación de ruta (previene escritura arbitraria de archivos) ───────────
function validatePath(path: string, bucket: string, callerId: string): string | null {
  if (path.length === 0 || path.length > 200) return 'Invalid path length';
  if (/^\/|\.\.|\\|[\u0000-\u001F ]/.test(path)) return 'Invalid path';
  const parts = path.split('/');
  const folder = parts[0];
  if (!ALLOWED_FOLDERS.has(folder)) return 'Invalid folder';
  if (bucket !== 'avatars' && folder === 'avatars') return 'Bucket mismatch';
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.has(ext)) return 'Invalid extension';
  if (PERSONAL_FOLDERS.has(folder) && !path.includes(callerId)) {
    return 'Cannot write to another user\u0027s personal folder';
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing env vars' }, 500);

    // ── Verificar autenticación del llamador ───────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'No autenticado' }, 401);

    const callerClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ error: 'No autenticado' }, 401);

    const body = await req.json() as Record<string, unknown>;

    // Validar schema
    const validationError = validateInput(body);
    if (validationError) return json({ error: validationError }, 400);

    const {
      base64,
      mimeType  = 'image/jpeg',
      bucket    = 'karpus-uploads',
      path,
      maxWidth  = 800,
      maxHeight = 800,
      quality   = 82,
    } = body as {
      base64: string; mimeType?: string; bucket?: string; path: string;
      maxWidth?: number; maxHeight?: number; quality?: number;
    };

    // Validar bucket y ruta (anti arbitrary-file-write)
    if (!ALLOWED_BUCKETS.has(String(bucket))) {
      return json({ error: 'Bucket no permitido' }, 403);
    }
    const pathError = validatePath(String(path), String(bucket), caller.id);
    if (pathError) return json({ error: pathError }, 403);

    // ── Decodificar base64 ────────────────────────────────────────────────────
    const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
    let imageBytes: Uint8Array;
    try {
      imageBytes = Uint8Array.from(atob(cleanBase64), c => c.charCodeAt(0));
    } catch {
      return json({ error: 'base64 inválido' }, 400);
    }
    if (imageBytes.length === 0) return json({ error: 'Empty image' }, 400);

    // ── Redimensionar con ImageMagick via Deno ────────────────────────────────
    let processedBytes: Uint8Array;
    let outputMime = 'image/webp';

    try {
      const tmpIn  = `/tmp/karpus_in_${Date.now()}_${caller.id}`;
      const tmpOut = `/tmp/karpus_out_${Date.now()}_${caller.id}.webp`;

      await Deno.writeFile(tmpIn, imageBytes);

      const cmd = new Deno.Command('convert', {
        args: [
          tmpIn,
          '-resize', `${maxWidth}x${maxHeight}>`,
          '-quality', String(quality),
          '-strip',
          '-auto-orient',
          `webp:${tmpOut}`
        ],
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stderr } = await cmd.output();

      if (code !== 0) {
        const errMsg = new TextDecoder().decode(stderr);
        console.error('[resize-image] ImageMagick error:', errMsg);
        processedBytes = imageBytes;
        outputMime = String(mimeType);
      } else {
        processedBytes = await Deno.readFile(tmpOut);
        await Deno.remove(tmpIn).catch(() => {});
        await Deno.remove(tmpOut).catch(() => {});
      }
    } catch (imgErr) {
      console.warn('[resize-image] ImageMagick not available, uploading original:', imgErr);
      processedBytes = imageBytes;
      outputMime = String(mimeType);
    }

    // ── Subir a Supabase Storage ──────────────────────────────────────────────
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false }
    });

    const finalPath = outputMime === 'image/webp' && !path.endsWith('.webp')
      ? path.replace(/\.[^.]+$/, '.webp')
      : path;

    const { error: uploadError } = await supabase.storage
      .from(String(bucket))
      .upload(finalPath, processedBytes, {
        contentType: outputMime,
        upsert:      true,
        cacheControl: '3600',
      });

    if (uploadError) {
      console.error('[resize-image] Upload error:', uploadError.message);
      return json({ error: uploadError.message }, 500);
    }

    const { data: { publicUrl } } = supabase.storage
      .from(String(bucket))
      .getPublicUrl(finalPath);

    const originalSize  = imageBytes.length;
    const processedSize = processedBytes.length;
    const savings       = originalSize > 0
      ? Math.round((1 - processedSize / originalSize) * 100)
      : 0;

    console.log(`[resize-image] ✅ ${finalPath} | ${Math.round(originalSize/1024)}KB → ${Math.round(processedSize/1024)}KB (${savings}% savings)`);

    return json({
      success:       true,
      publicUrl,
      path:          finalPath,
      originalSize,
      processedSize,
      savings:       `${savings}%`,
      format:        outputMime,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[resize-image] Unexpected error:', msg);
    return json({ error: msg }, 500);
  }
});
