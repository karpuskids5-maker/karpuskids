import { ensureRole, supabase, initOneSignal } from '../shared/supabase.js';
import { AppState } from './state.js';
import { Helpers } from '../shared/helpers.js';
import { WallModule } from './wall.module.js';
import { DashboardService } from '../directora/dashboard.service.js';
import { VideoCallModule } from '../shared/videocall.js';
import { UIHelpers, DirectorUI } from './ui.module.js';
import { StudentsModule } from './students.module.js';
import { TeachersModule } from './teachers.module.js';
import { PaymentsModule } from './payments.module.js';
import { GradesModule } from './grades.module.js';
import { AttendanceModule } from './attendance.module.js';
import { ChatModule } from './chat.module.js';
import { InquiriesModule } from './inquiries.module.js';
import { RoomsModule } from './rooms.module.js';

window.App = {
  navigation: { goTo: goToSection },
  students: StudentsModule,
  teachers: { ...TeachersModule, edit: (id) => TeachersModule.openModal(id) },
  rooms: RoomsModule,
  payments: PaymentsModule,
  attendance: AttendanceModule,
  grades: GradesModule,
  ui: { ...UIHelpers, ...DirectorUI },
  inquiries: InquiriesModule,
  chat: ChatModule,
  wall: {
    toggleCommentSection: (pid) => WallModule.toggleCommentSection(pid),
    sendComment: (pid) => WallModule.sendComment(pid),
    deletePost: (pid) => WallModule.deletePost(pid),
    toggleLike: (pid) => WallModule.toggleLike(pid),
    openNewPostModal: () => WallModule.openNewPostModal(),
    loadPosts: (container) => WallModule.loadPosts(container || 'muroPostsContainer')
  }
};

window.WallModule = WallModule;

window.openGlobalModal = function(html) {
  const container = document.getElementById('globalModalContainer');
  if (!container) return;
  container.innerHTML = `<div class="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">${html}</div>`;
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  if (window.lucide) lucide.createIcons();
};


async function loadProfile() {
  try {
    const profile = AppState.get('profile');
    if (!profile) return;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('confDirName', profile.name);
    setVal('confDirTitle', profile.title);
    setVal('confDirBio', profile.bio);
    setVal('confPhone', profile.phone);
    setVal('confEmail', profile.email);
    setVal('confAddress', profile.address);
    const nameEl = document.getElementById('sidebarName'); if(nameEl) nameEl.textContent = profile.name || 'Directora';
    const avatarEl = document.getElementById('sidebarAvatar');
    if (avatarEl) {
      avatarEl.innerHTML = profile.avatar_url
        ? `<img src="${profile.avatar_url}" class="w-full h-full object-cover" onerror="this.src='i