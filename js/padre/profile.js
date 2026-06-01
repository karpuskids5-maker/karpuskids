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
    // Fecha de cumpleaños — usar birth_date si existe, sino start_date
    const birthDate = student.birth_date || student.start_date;
    set('inputStudentBirth', birthDate ? birthDate.split('T')[0] : '');
    set('inputStudentBlood', student.blood_type);
    set('inputStudentAllergy', student.allergies);
    set('profilePickupName', student.authorized_pickup);

    // Padre/Madre/Tutores (Mapeo de las columnas de students)
    set('profileFatherName', student.p1_name);
    set('profileFatherPhone', student.p1_phone);
    set('profileFatherEmail', student.p1_email);

    set('profileMotherName', student.p2_name);
    set('profileMotherPhone', student.p2_phone);
    set('profileMotherEmail', student.p2_email);

    // Si existen más campos en el perfil del usuario (auth)
    // set('profileName', profile.name);

    // Configurar subida de foto
    this.setupPhotoUpload();

    // Configurar guardado
    const btnSave = document.getElementById('btnSaveChanges');
    if (btnSave && !btnSave._initialized) {
      btnSave.onclick = () => this.save();
      btnSave._initialized = true;
    }

    // Generar QR para el padre (Carnet Digital)
    this.renderStudentQR();
  },

  /**
   * Genera el QR del estudiante en el perfil del padre
   */
  renderStudentQR() {
    const student = AppState.get('currentStudent');
    const container = document.getElementById('parentStudentQR'); // Asegúrate que este ID exista en el HTML
    if (!container || !student?.matricula) return;

    // Limpiar previo
    container.innerHTML = '';

    // Cargar librería si no está (fallback)
    if (!window.QRCode) {
      const s = document.createElement('script');
      s.src = 'js/shared/qrcode.min.js';
      s.onload = () => this._generateQR(container, student);
      document.head.appendChild(s);
    } else {
      this._generateQR(container, student);
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

    // Añadir botón de imprimir si no existe
    const btnPrint = document.getElementById('btnPrintStudentQR');
    if (btnPrint && !btnPrint._initialized) {
      btnPrint.onclick = () => {
        const canvas = container.querySelector('canvas');
        if (!canvas) return;
        const imgData = canvas.toDataURL("image/png");
        const win = window.open('', '_blank');
        import('./helpers.js').then(({ Helpers }) => {
          // Reutilizar la plantilla corporativa centralizada
          import('../shared/helpers.js').then(({ Helpers: SharedHelpers }) => {
             win.document.write(SharedHelpers.getQRPrintTemplate(imgData, student.name, student.matricula));
             win.document.close();
          });
        });
      };
      btnPrint._initialized = true;
    }
  },

  /**
   * Guarda cambios en el perfil (Principalmente datos del estudiante)
   */
  async save() {
    const student = AppState.get('currentStudent');
    if (!student) return;

    const get = (id) => document.getElementById(id)?.value.trim();

    const updates = {
      name: get('inputStudentName'),
      blood_type: get('inputStudentBlood'),
      allergies: get('inputStudentAllergy'),
      authorized_pickup: get('profilePickupName'),
      p1_name: get('profileFatherName'),
      p1_phone: get('profileFatherPhone'),
      p1_email: get('profileFatherEmail'),
      p2_name: get('profileMotherName'),
      p2_phone: get('profileMotherPhone'),
      p2_email: get('profileMotherEmail')
    };

    if (!updates.name) return Helpers.toast('El nombre del estudiante es obligatorio', 'warning');

    try {
      AppState.set('loading', true);
      const { error } = await supabase
        .from(TABLES.STUDENTS)
        .update(updates)
        .eq('id', student.id);

      if (error) throw error;

      AppState.set('currentStudent', { ...student, ...updates });
      Helpers.toast('Perfil actualizado correctamente');
    } catch (err) {
      Helpers.toast('Error al guardar cambios', 'error');
    } finally {
      AppState.set('loading', false);
    }
  },

  /**
   * Gestión de foto de perfil del estudiante
   */
  setupPhotoUpload() {
    const input = document.getElementById('studentAvatarInput');
    if (!input) return;

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) return Helpers.toast('Máximo 2MB permitido', 'error');
      if (!file.type.startsWith('image/')) return Helpers.toast('Formato de imagen no válido', 'error');

      try {
        AppState.set('loading', true);
        const student = AppState.get('currentStudent');
        const ext = file.name.split('.').pop();
        const path = `avatars/${student.id}_${Date.now()}.${ext}`;

        const { error: upErr } = await supabase.storage.from('classroom_media').upload(path, file);
        if (upErr) throw upErr;

        const { data: { publicUrl } } = supabase.storage.from('classroom_media').getPublicUrl(path);
        const { error: dbErr } = await supabase.from(TABLES.STUDENTS).update({ avatar_url: publicUrl }).eq('id', student.id);
        if (dbErr) throw dbErr;

        const updated = { ...student, avatar_url: publicUrl };
        AppState.set('currentStudent', updated);
        Helpers.toast('Foto actualizada correctamente');
      } catch (err) {
        Helpers.toast('Error al subir foto', 'error');
      } finally {
        AppState.set('loading', false);
      }
    };
  }
};
