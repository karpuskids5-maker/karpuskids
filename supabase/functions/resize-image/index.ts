/**
 * 🖼️ resize-image — Edge Function
 * Redimensiona y comprime imágenes a WebP antes de guardarlas en Supabase Storage.
 *
 * Uso desde el cliente:
 *   const { data } = await supabase.functions.invoke('resize-image', {
 *     body: { base64: '<base64_string>', filename: 'avatar.jpg', bucket: 'karpus-uploads', path: 'avatars/user_id.webp', maxWidth: 400, quality: 85 }
 *   });
 *   // data.publicUrl → URL pública de la imagen optimizada
 *
 * Parámetros:
 *   base64    — imagen en base64 (sin prefijo data:image/...)
 *   mimeType  — tipo MIME original (default: 'image/jpeg')
 *   filename  — nombre original del archivo
 *   bucket    — bucket de Supabase Storage (default: 'karpus-uploads')
 *   path      — ruta destino en el bucket (ej: 'avatars/user123.webp')
 *   maxWidth  — ancho máximo en px (default: 800)
 *   maxHeight — alto máximo en px (default: 800)
 *   quality   — calidad WebP 1-100 (default: 82)
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

// ── Validación de schema ──────────────────────────────────────────────────────
function validateInput(body: Record<string, unknown>): string | null {
  if (!body.base64 || typeof body.base64 !== 'string') return 'base64 is required';
  if (!body.path   || typeof body.path   !== 'string') return 'path is required';
  if (body.maxWidth  && (typeof body.maxWidth  !== 'number' || body.maxWidth  < 1 || body.maxWidth  > 4000)) return 'maxWidth must be 1-4000';
  if (body.maxHeight && (typeof body.maxHeight !== 'number' || body.maxHeight < 1 || body.maxHeight > 4000)) return 'maxHeight must be 1-4000';
  if (body.quality   && (typeof body.quality   !== 'number' || body.quality   < 1 || body.quality   > 100))  return 'quality must be 1-100';
  // Limitar tamaño del base64 (max ~5MB de imagen original)
  if (body.base64.length > 7_000_000) return 'Image too large (max ~5MB)';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing env vars' }, 500);

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

    // ── Decodificar base64 ────────────────────────────────────────────────────
    // Limpiar prefijo data:image/...;base64, si existe
    const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
    const imageBytes  = Uint8Array.from(atob(cleanBase64), c => c.charCodeAt(0));

    // ── Redimensionar con ImageMagick via Deno ────────────────────────────────
    // Deno Edge Functions tienen acceso a ImageMagick via Deno.Command
    let processedBytes: Uint8Array;
    let outputMime = 'image/webp';

    try {
      // Escribir imagen temporal
      const tmpIn  = `/tmp/karpus_in_${Date.now()}`;
      const tmpOut = `/tmp/karpus_out_${Date.now()}.webp`;

      await Deno.writeFile(tmpIn, imageBytes);

      // Ejecutar ImageMagick: redimensionar + convertir a WebP
      const cmd = new Deno.Command('convert', {
        args: [
          tmpIn,
          '-resize', `${maxWidth}x${maxHeight}>`,  // > = solo reducir, nunca ampliar
          '-quality', String(quality),
          '-strip',                                  // eliminar metadatos EXIF
          '-auto-orient',                            // corregir orientación EXIF
          `webp:${tmpOut}`
        ],
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stderr } = await cmd.output();

      if (code !== 0) {
        const errMsg = new TextDecoder().decode(stderr);
        console.error('[resize-image] ImageMagick error:', errMsg);
        // Fallback: subir imagen original sin procesar
        processedBytes = imageBytes;
        outputMime = String(mimeType);
      } else {
        processedBytes = await Deno.readFile(tmpOut);
        // Limpiar temporales
        await Deno.remove(tmpIn).catch(() => {});
        await Deno.remove(tmpOut).catch(() => {});
      }
    } catch (imgErr) {
      // ImageMagick no disponible — subir original
      console.warn('[resize-image] ImageMagick not available, uploading original:', imgErr);
      processedBytes = imageBytes;
      outputMime = String(mimeType);
    }

    // ── Subir a Supabase Storage ──────────────────────────────────────────────
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false }
    });

    // Asegurar extensión .webp si se procesó
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

    // Obtener URL pública
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
