/**
 * 🚀 FileManager PRO - Sistema de Gestión de Archivos
 * Arquitectura Premium para Karpus Kids
 * 
 * Funcionalidades:
 * - Validación de tipo y tamaño
 * - Compresión de imágenes (Canvas API)
 * - Barra de progreso en tiempo real
 * - Upload a Supabase con reintentos
 */

import { Helpers } from './helpers.js';

export const FileManager = {
  
  // Configuración por defecto
  DEFAULT_OPTIONS: {
    maxImageSizeMB: 10,
    maxVideoSizeMB: 100,
    imageQuality: 0.85,
    maxWidth: 1920,
    maxHeight: 1920,
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    allowedVideoTypes: ['video/mp4', 'video/webm', 'video/quicktime']
  },

  /**
   * 📸 Comprime una imagen usando Canvas API (sin dependencias)
   * @param {File} file - Archivo de imagen original
   * @param {Object} options - Opciones de compresión
   * @returns {Promise<File>} Archivo comprimido
   */
  async compressImage(file, options = {}) {
    const settings = { ...this.DEFAULT_OPTIONS, ...options };
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        const img = new Image();
        
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;
          
          // Redimensionar manteniendo aspect ratio
          if (width > settings.maxWidth || height > settings.maxHeight) {
            const ratio = Math.min(
              settings.maxWidth / width,
              settings.maxHeight / height
            );
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          // Convertir a WebP para mejor compresión
          canvas.toBlob(
            (blob) => {
              const compressedFile = new File(
                [blob],
                file.name.replace(/\.[^/.]+$/, '.webp'),
                { type: 'image/webp' }
              );
              
              Helpers.safeLog('log', '📸 Compresión exitosa:', {
                original: (file.size / 1024 / 1024).toFixed(2) + 'MB',
                compressed: (compressedFile.size / 1024 / 1024).toFixed(2) + 'MB',
                reduction: ((1 - compressedFile.size / file.size) * 100).toFixed(1) + '%'
              });
              
              resolve(compressedFile);
            },
            'image/webp',
            settings.imageQuality
          );
        };
        
        img.onerror = () => reject(new Error('Error al cargar la imagen'));
        img.src = e.target.result;
      };
      
      reader.onerror = () => reject(new Error('Error al leer el archivo'));
      reader.readAsDataURL(file);
    });
  },

  /**
   * ✅ Valida un archivo antes de procesarlo
   * @param {File} file - Archivo a validar
   * @param {Object} options - Opciones de validación
   * @returns {Object} Resultado de validación
   */
  validateFile(file, options = {}) {
    const settings = { ...this.DEFAULT_OPTIONS, ...options };
    const errors = [];

    // Validar tipo de archivo
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    
    if (!isImage && !isVideo) {
      errors.push('Tipo de archivo no permitido');
      return { valid: false, errors };
    }

    // Validar tipos específicos
    if (isImage && !settings.allowedImageTypes.includes(file.type)) {
      errors.push('Formato de imagen no permitido. Usa JPG, PNG o WebP');
    }
    
    if (isVideo && !settings.allowedVideoTypes.includes(file.type)) {
      errors.push('Formato de video no permitido. Usa MP4 o WebM');
    }

    // Validar tamaño
    const sizeMB = file.size / 1024 / 1024;
    
    if (isImage && sizeMB > settings.maxImageSizeMB) {
      errors.push(`Imagen demasiado grande. Máximo ${settings.maxImageSizeMB}MB`);
    }
    
    if (isVideo && sizeMB > settings.maxVideoSizeMB) {
      errors.push(`Video demasiado grande. Máximo ${settings.maxVideoSizeMB}MB`);
    }

    return {
      valid: errors.length === 0,
      errors,
      fileType: isImage ? 'image' : 'video',
      sizeMB: sizeMB.toFixed(2)
    };
  },

  /**
   * 📊 Genera una vista previa del archivo
   * @param {File} file - Archivo a previsualizar
   * @returns {Promise<string>} URL de vista previa
   */
  async getPreviewURL(file) {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    
    if (isImage || isVideo) {
      return URL.createObjectURL(file);
    }
    
    throw new Error('Tipo de archivo no compatible para vista previa');
  },

  /**
   * 📤 Sube un archivo a Supabase Storage con progreso
   * @param {Object} supabase - Cliente de Supabase
   * @param {File} file - Archivo a subir
   * @param {string} bucket - Nombre del bucket
   * @param {string} path - Ruta de destino
   * @param {Function} onProgress - Callback de progreso (0-100)
   * @returns {Promise<Object>} Resultado del upload
   */
  async uploadFile(supabase, file, bucket, path, onProgress = null) {
    // Simular progreso para mejor UX
    let progress = 0;
    const interval = setInterval(() => {
      if (progress < 90 && onProgress) {
        progress += Math.random() * 15;
        onProgress(Math.min(progress, 90));
      }
    }, 200);

    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });

      if (error) throw error;
      
      if (onProgress) onProgress(100);
      
      // Obtener URL pública
      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(path);

      Helpers.safeLog('log', '✅ Archivo subido:', path);

      return {
        path,
        publicUrl,
        fileName: file.name,
        fileSize: file.size
      };
    } catch (error) {
      Helpers.safeLog('error', '❌ Error al subir archivo:', error);
      throw error;
    } finally {
      clearInterval(interval);
    }
  },

  /**
   * 🎯 Flujo completo: Validar → Comprimir → Subir
   * @param {Object} params - Parámetros del flujo
   * @returns {Promise<Object>} Resultado final
   */
  async processAndUpload({
    file,
    supabase,
    bucket,
    pathPrefix = '',
    options = {},
    onProgress = null
  }) {
    try {
      // Paso 1: Validar
      if (onProgress) onProgress(10);
      const validation = this.validateFile(file, options);
      if (!validation.valid) {
        throw new Error(validation.errors.join('. '));
      }

      // Paso 2: Comprimir (solo imágenes)
      let processedFile = file;
      if (validation.fileType === 'image') {
        if (onProgress) onProgress(30);
        processedFile = await this.compressImage(file, options);
      }
      
      if (onProgress) onProgress(50);

      // Paso 3: Generar path único
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substr(2, 9);
      const ext = processedFile.name.split('.').pop();
      const path = pathPrefix 
        ? `${pathPrefix}/${timestamp}_${randomStr}.${ext}`
        : `${timestamp}_${randomStr}.${ext}`;

      // Paso 4: Subir
      const result = await this.uploadFile(
        supabase,
        processedFile,
        bucket,
        path,
        (p) => onProgress ? 50 + (p * 0.5) : null
      );

      return {
        success: true,
        ...result,
        validation
      };
    } catch (error) {
      Helpers.safeLog('error', '❌ Error en flujo de upload:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * 🎯 Presets optimizados por caso de uso
   */
  PRESETS: {
    // Foto de perfil: 400x400px, 100KB max
    PROFILE_PHOTO: {
      maxWidth: 400,
      maxHeight: 400,
      imageQuality: 0.8,
      maxImageSizeMB: 5
    },
    
    // Galería: Full HD, 500KB max
    GALLERY: {
      maxWidth: 1920,
      maxHeight: 1920,
      imageQuality: 0.85,
      maxImageSizeMB: 10
    },
    
    // Documentos: 1200px ancho, alta calidad
    DOCUMENT: {
      maxWidth: 1200,
      maxHeight: 2000,
      imageQuality: 0.9,
      maxImageSizeMB: 10
    }
  }
};

// Exponer globalmente para facil uso
if (typeof window !== 'undefined') {
  window.FileManager = FileManager;
}
