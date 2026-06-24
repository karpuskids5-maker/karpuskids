import { supabase } from '../shared/supabase.js';
import { AppState, TABLES } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';

/**
 * 👤 MÓDULO DE PERFIL (PADRES)
 */
export const ProfileModule = {
  /**
   * Inicializa y rellena el perfil
   */
  async init() {
    const profile = AppState.get('profile');
    const student = AppState.get('currentStudent');
    
    if (!profile || !student) return;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };

    // Estudiante
    set('inputStudentName', student.name);
    set('inputStudentBlood', student.blood_type);
    set('inputStudentAllergy', student.allergies);
    set('profilePickupName', student.authorized_pickup);
    set('profilePickupPhone', student.authorized_pickup_phone);

    // Padre/Tutor 1
    set('profileFatherName', student.p1_name);
    set('profileFatherPhone', student.p1_phone);
    // Email es readonly en el HTML — solo poblamos, no incluimos en save
    set('profileFatherEmail', student.p1_email || profile.email || '');

    // Padre/Tutor 2
    set('profileMotherName', student.p2_name);
    set('profileMotherPhone', student.p2_phone);
    set('profileMotherEmail', student.p2_email || '');

    // Initialize profileAvatarDisplay
    const profileAvatarDisplay = document.getElementById('profileAvatarDisplay');
    if (profileAvatarDisplay) {
      if (student.avatar_url) {
        profileAvatarDisplay.innerHTML = `<img src="${student.avatar_url}" class="w-full h-full object-cover">`;
      } else {
        const studentName = student.name || 'Estudiante';
        profileAvatarDisplay.innerHTML = `<span class="text-4xl font-black text-emerald-700">${studentName.charAt(0)}</span>`;
      }
    }

    // Configurar subida de foto
    this.setupPhotoUpload();

    // Configurar guardado — siempre reasignar para evitar handlers perdidos
    const btnSave = document.getElementById('btnSaveChanges');
    if (btnSave) {
      // Remover handler anterior antes de asignar uno nuevo
      btnSave.onclick = null;
      btnSave.onclick = () => this.save();
    }

    // Generar QR del estudiante en el perfil
    await this._initQR(student);
  },

  /**
   * Genera el QR del estudiante en el perfil
   */
  async _initQR(student) {
    if (!student?.matricula) return;

    // El HTML tiene #padre-qr-container y etiquetas #padre-qr-matricula / #padre-qr-name
    const container = document.getElementById('padre-qr-container');
    const matriculaEl = document.getElementById('padre-qr-matricula');
    const nameEl = document.getElementById('padre-qr-name');

    if (matriculaEl) matriculaEl.textContent = student.matricula;
    if (nameEl) nameEl.textContent = student.name || '--';

    if (!container) return;
    container.innerHTML = '';

    const generate = () => {
      if (window.QRCode) {
        this._generateQR(container, student);
      }
    };

    if (!window.QRCode) {
      const s = document.createElement('script');
      s.src = 'js/shared/qrcode.min.js';
      s.onload = generate;
      document.head.appendChild(s);
    } else {
      generate();
    }
  },

  _generateQR(container, student) {
    new QRCode(container, {
      text: student.matricula,
      width: 160,
      height: 160,
      colorDark: "#0f172a",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  },

  /**
   * Guarda cambios en el perfil (Principalmente datos del estudiante)
   */
  async save() {
    const student = AppState.get('currentStudent');
    if (!student) return;

    const get = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : undefined;
    };

    const name = get('inputStudentName');
    if (!name) return Helpers.toast('El nombre del estudiante es obligatorio', 'warning');

    // Solo incluir campos que tengan valor o que el padre haya borrado explícitamente
    // Los emails son readonly — no se actualizan
    const updates = {
      name,
      blood_type:             get('inputStudentBlood')   ?? student.blood_type,
      allergies:              get('inputStudentAllergy')  ?? student.allergies,
      authorized_pickup:      get('profilePickupName')    ?? student.authorized_pickup,
      authorized_pickup_phone: get('profilePickupPhone') ?? student.authorized_pickup_phone,
      p1_name:              get('profileFatherName')    ?? student.p1_name,
      p1_phone:             get('profileFatherPhone')   ?? student.p1_phone,
      p2_name:              get('profileMotherName')    ?? student.p2_name,
      p2_phone:             get('profileMotherPhone')   ?? student.p2_phone,
    };

    // Botón: estado de carga
    const btn = document.getElementById('btnSaveChanges');
    const original = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" class="w-5 h-5 animate-spin"></i> Guardando...';
      if (window.lucide) lucide.createIcons();
    }

    try {
      const { error } = await supabase
        .from(TABLES.STUDENTS)
        .update(updates)
        .eq('id', student.id);

      if (error) {
        // RLS o permiso denegado
        if (error.code === '42501' || error.message?.includes('permission') || error.message?.includes('policy')) {
          Helpers.toast('Sin permiso para editar. Contacta a la escuela.', 'error');
        } else {
          Helpers.toast(`Error: ${error.message}`, 'error');
        }
        return;
      }

      AppState.set('currentStudent', { ...student, ...updates });
      Helpers.toast('Perfil actualizado correctamente ✅', 'success');
    } catch (err) {
      Helpers.toast('Error al guardar cambios', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = original;
        if (window.lucide) lucide.createIcons();
      }
    }
  },

  /**
   * Gestión de foto de perfil del estudiante
   * Bucket: avatars (público, sin RLS restrictiva)
   */
  setupPhotoUpload() {
    const input = document.getElementById('studentAvatarInput');
    if (!input) return;

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 5 * 1024 * 1024) return Helpers.toast('Máximo 5MB permitido', 'error');
      if (!file.type.startsWith('image/')) return Helpers.toast('Formato de imagen no válido', 'error');

      const student = AppState.get('currentStudent');
      if (!student) return;

      // Preview inmediato antes de subir
      const objectUrl = URL.createObjectURL(file);
      this._setAvatarPreview(objectUrl);

      const label = input.closest('label');
      if (label) label.style.opacity = '0.6';

      try {
        const ext = file.name.split('.').pop().toLowerCase().replace('jpeg', 'jpg');
        const path = `students/${student.id}_${Date.now()}.${ext}`;

        // Intentar subir al bucket avatars; si falla, intentar karpus-uploads
        let publicUrl = null;
        for (const bucket of ['avatars', 'karpus-uploads', 'classroom_media']) {
          const { error: upErr } = await supabase.storage
            .from(bucket)
            .upload(path, file, { upsert: true, contentType: file.type });

          if (!upErr) {
            const { data } = supabase.storage.from(bucket).getPublicUrl(path);
            publicUrl = data.publicUrl;
            break;
          }
        }

        if (!publicUrl) throw new Error('No se pudo subir la imagen a ningún bucket');

        const { error: dbErr } = await supabase
          .from(TABLES.STUDENTS)
          .update({ avatar_url: publicUrl })
          .eq('id', student.id);

        if (dbErr) throw dbErr;

        const updated = { ...student, avatar_url: publicUrl };
        AppState.set('currentStudent', updated);

        // Actualizar todos los avatares en el header/sidebar
        const profile = AppState.get('profile');
        const allStudents = AppState.get('students') || [updated];
        if (window.updateHeaderProfile) {
          updateHeaderProfile(profile, updated, allStudents);
        }

        // Mostrar URL real con cache bust
        this._setAvatarPreview(publicUrl + '?t=' + Date.now());
        URL.revokeObjectURL(objectUrl);

        Helpers.toast('Foto actualizada ✅', 'success');
      } catch (err) {
        // Revertir preview al avatar anterior
        this._setAvatarPreview(student.avatar_url || null, student.name);
        URL.revokeObjectURL(objectUrl);
        Helpers.toast('Error al subir foto: ' + (err.message || err), 'error');
      } finally {
        if (label) label.style.opacity = '';
        // Limpiar el input para permitir re-seleccionar el mismo archivo
        input.value = '';
      }
    };
  },

  /** Actualiza el contenedor de avatar con una URL o iniciales */
  _setAvatarPreview(url, name) {
    const el = document.getElementById('profileAvatarDisplay');
    if (!el) return;
    if (url) {
      el.innerHTML = `<img src="${url}" class="w-full h-full object-cover" alt="Avatar">`;
    } else {
      const initial = (name || 'E').charAt(0).toUpperCase();
      el.innerHTML = `<span class="text-4xl font-black text-emerald-700">${initial}</span>`;
    }
  }
};
