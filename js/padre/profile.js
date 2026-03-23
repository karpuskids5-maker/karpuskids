import { supabase } from '../supabase.js';
import { AppState, TABLES, GlobalCache } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';
import { initFeedRealtime } from './feed.js';
import { initLiveClassListener } from './attendance_live.js';
import { initGlobalRealtime } from './chat.js';


// 📌 PERFIL
export async function populateProfile() {
  const profile = AppState.get('profile');
  if (!profile) return;

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value || '';
  };

  set('profileName', profile.name);
  set('profilePhone', profile.phone);
  set('profileAddress', profile.address);
}


// 💾 GUARDAR PERFIL
export async function saveAllProfile() {
  const user = AppState.get('user');
  if (!user) return;

  const name = document.getElementById('profileName')?.value.trim();
  const phone = document.getElementById('profilePhone')?.value.trim();
  const address = document.getElementById('profileAddress')?.value.trim();

  if (!name) {
    Helpers.toast('El nombre es obligatorio', 'error');
    return;
  }

  try {
    const { error } = await supabase
      .from(TABLES.PROFILES)
      .update({ name, phone, address })
      .eq('id', user.id);

    if (error) throw error;

    const updatedProfile = { ...AppState.get('profile'), name, phone, address };
    AppState.set('profile', updatedProfile);

    // 🔥 SIEMPRE usar nombre del estudiante (consistencia total)
    const student = AppState.get('student');
    const displayName = student?.name || name || 'Familia';

    document.querySelectorAll('.guardian-name-display')
      .forEach(el => el.textContent = escapeHtml(displayName));

    // sidebar email
    const sidebarEmail = document.getElementById('sidebarEmail');
    if (sidebarEmail && updatedProfile.email) {
      sidebarEmail.textContent = updatedProfile.email;
    }

    // avatar
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    const avatarUrl = student?.avatar_url || updatedProfile.avatar_url;

    if (sidebarAvatar && avatarUrl) {
      if (sidebarAvatar.tagName === 'IMG') {
        sidebarAvatar.src = avatarUrl;
      } else {
        sidebarAvatar.innerHTML = `<img src="${avatarUrl}" class="w-full h-full object-cover">`;
      }
    }

    Helpers.toast('Perfil actualizado correctamente', 'success');

  } catch (err) {
    console.error('Error guardando perfil:', err);
    Helpers.toast('Error al guardar perfil', 'error');
  }
}


// 👨‍🎓 CARGAR ESTUDIANTE
export async function loadStudentData() {
  try {
    let student = GlobalCache.get("student");

    if (!student) {
      const { data, error } = await supabase
        .from(TABLES.STUDENTS)
        .select(`
          *,
          classrooms(name, level, teacher_id)
        `)
        .eq('parent_id', AppState.get('user')?.id)
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      student = data;

      if (student) {
        GlobalCache.set("student", student, 300000);
      }
    }

    if (!student) {
      Helpers.toast('No hay estudiante vinculado', 'info');
      updateStudentUI(null);
      return;
    }

    AppState.set('student', student);
    updateStudentUI(student);

    // 🔥 realtime seguros
    initGlobalRealtime();
    initFeedRealtime();

    if (student.classroom_id) {
      await initLiveClassListener(student.classroom_id);
    }

  } catch (err) {
    console.error('Error cargando estudiante:', err);
    Helpers.toast('Error al cargar estudiante', 'error');
    updateStudentUI(null);
  }
}


// 🎨 UI ESTUDIANTE
export function updateStudentUI(student) {
  const displayName = student?.name ? escapeHtml(student.name) : 'No asignado';

  const cls = Array.isArray(student?.classrooms)
    ? student.classrooms[0]
    : student?.classrooms;

  const classroomInfo = cls
    ? (cls.level
        ? `${escapeHtml(cls.name)} • ${escapeHtml(cls.level)}`
        : escapeHtml(cls.name))
    : 'Sin aula asignada';

  document.querySelectorAll('.student-name-display')
    .forEach(el => {
      el.textContent = displayName;
      el.setAttribute('aria-label', `Estudiante: ${displayName}`);
    });

  document.querySelectorAll('.classroom-name-display')
    .forEach(el => el.textContent = classroomInfo);

  const avatarUrl = student?.avatar_url || 'img/mundo.jpg';

  const setImg = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'IMG') {
      el.src = avatarUrl;
    } else {
      el.innerHTML = `<img src="${avatarUrl}" class="w-full h-full object-cover">`;
    }
  };

  setImg('sidebarAvatar');
  setImg('studentAvatarPreview');
  setImg('headerStudentAvatar');
  setImg('headerAvatarMobile');

  const sidebarName = document.getElementById('sidebar-student-name');
  if (sidebarName) sidebarName.textContent = displayName;
}


// 📸 FOTO PERFIL
export function setupProfilePhotoUpload() {
  const input = document.getElementById('studentAvatarInput');
  if (!input) return;

  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      Helpers.toast('Máximo 2MB', 'error');
      return;
    }

    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      Helpers.toast('Formato inválido', 'error');
      return;
    }

    try {
      const student = AppState.get('student');
      if (!student) throw new Error('No hay estudiante');

      Helpers.toast('Subiendo...', 'info');

      const ext = file.name.split('.').pop();
      const path = `avatars/avatar_${student.id}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('classroom_media')
        .upload(path, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('classroom_media')
        .getPublicUrl(path);

      const publicUrl = data.publicUrl;

      const { error: updateError } = await supabase
        .from(TABLES.STUDENTS)
        .update({ avatar_url: publicUrl })
        .eq('id', student.id);

      if (updateError) throw updateError;

      // 🔥 actualizar cache + estado
      const updated = { ...student, avatar_url: publicUrl };
      AppState.set('student', updated);
      GlobalCache.set("student", updated, 300000);

      updateStudentUI(updated);

      Helpers.toast('Foto actualizada', 'success');

    } catch (err) {
      console.error(err);
      Helpers.toast('Error subiendo foto', 'error');
    }
  });
}