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
    set('inputStudentBirth', student.start_date); // Usando start_date como placeholder o si hay birth_date
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
      console.error('Save profile error:', err);
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
        console.error('Upload photo error:', err);
        Helpers.toast('Error al subir foto', 'error');
      } finally {
        AppState.set('loading', false);
      }
    };
  }
};
