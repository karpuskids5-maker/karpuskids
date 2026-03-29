const fs = require('fs');

let mainJs = fs.readFileSync('js/maestra/main.js', 'utf8');

// 1. Fix the classroom query from maybeSingle to order().limit().maybeSingle()
mainJs = mainJs.replace(
  /.eq\('teacher_id', auth.user.id\)\s*\n\s*\.maybeSingle\(\);/,
  ".eq('teacher_id', auth.user.id)\\n      .order('name')\\n      .limit(1)\\n      .maybeSingle();"
);

// 2. Remove old function implementations to avoid duplicate declarations and force using new ones.
// We'll replace the word 'function' with 'const obsolete_' for specific functions
const functionsToObsolete = [
  'initAttendance', 'markAllPresent', 'registerAttendance',
  'initRoutine', 'updateRoutineField', 'saveRoutineLog', 'openNewRoutineModal',
  'initTasks', 'openEditTaskModal', 'deleteTask', 'openNewTaskModal', 'viewTaskSubmissions', 'submitGrade',
  'openStudentProfile', 'registerIncidentModal',
  'initChat', 'selectChatContact', 'loadChatMessages', 'renderMessages', 'sendChatMessage', 'subscribeToChat'
];

functionsToObsolete.forEach(fn => {
  const regex = new RegExp(`(async\\s+)?function\\s+${fn}\\s*\\(`, 'g');
  mainJs = mainJs.replace(regex, `$1function obsolete_${fn}(`);
});

// 3. Delete old safeToast and safeEscapeHTML and createOrGetModal manually to prevent duplicates
mainJs = mainJs.replace(/const safeToast = /g, 'const obsolete_safeToast = ');
mainJs = mainJs.replace(/const safeEscapeHTML = /g, 'const obsolete_safeEscapeHTML = ');
mainJs = mainJs.replace(/const Modal = /g, 'const obsolete_Modal = ');
mainJs = mainJs.replace(/function createOrGetModal\(id,\s*content\)/g, 'function obsolete_createOrGetModal(id, content)');

// 4. Update the App mappings at the top
const newMappings = `
  Object.assign(window.App, {
    // UI Helpers
    safeToast: UI.safeToast,
    safeEscapeHTML: UI.safeEscapeHTML,
    Modal: UI.Modal,

    // Attendance
    registerAttendance: Attendance.registerAttendance,
    markAllPresent: Attendance.markAllPresent,
    initAttendance: Attendance.initAttendance,

    // Routine
    initRoutine: Routine.initRoutine,
    updateRoutineField: Routine.updateRoutineField,
    saveRoutineLog: Routine.saveRoutineLog,
    openNewRoutineModal: Routine.openNewRoutineModal,

    // Tasks
    initTasks: Tasks.initTasks,
    openEditTaskModal: Tasks.openEditTaskModal,
    deleteTask: Tasks.deleteTask,
    openNewTaskModal: Tasks.openNewTaskModal,
    viewTaskSubmissions: Tasks.viewTaskSubmissions,
    submitGrade: Tasks.submitGrade,

    // Students
    openStudentProfile: Students.openStudentProfile,
    registerIncidentModal: Students.registerIncidentModal,

    // Chat
    initChat: ChatApp.initChat,
    selectChatContact: ChatApp.selectChatContact,

    // Fallbacks to old ones not ported yet
    _showClassroomDetail: showClassroomDetail,
    _startJitsi: startJitsi,
    _openNewPostModal: openNewPostModal,
    _submitNewPost: submitNewPost
  });
`;

mainJs = mainJs.replace(/Object\.assign\(window\.App,\s*\{[\s\S]*?\}\);/, newMappings);

// 5. Update direct local variable calls in main.js initNavigation and others to point to Modules.
// Since we renamed local functions to `obsolete_...`, if main.js calls `initAttendance()`, it will crash.
// We must replace these calls with their namespaced version, OR just use the imports directly if we rename them.
// Wait, the easiest way is to NOT use name-spaced imports, but named imports that replace the locals.
// Since ES6 imports are hoisted, they act just like the old functions used to.
const imports = `import * as Attendance from './modules/attendance.js';
import * as Routine from './modules/routine.js';
import * as Tasks from './modules/tasks.js';
import * as Students from './modules/students.js';
import * as ChatApp from './modules/chat_app.js';
import * as UI from './modules/ui.js';

// Re-expose legacy calls to the old code that still expects global/local functions
window.safeToast = UI.safeToast;
const { safeToast, safeEscapeHTML, Modal } = UI;
const { initAttendance, markAllPresent, registerAttendance } = Attendance;
const { initRoutine, updateRoutineField, saveRoutineLog, openNewRoutineModal } = Routine;
const { initTasks, openEditTaskModal, deleteTask, openNewTaskModal, viewTaskSubmissions, submitGrade } = Tasks;
const { openStudentProfile, registerIncidentModal } = Students;
const { initChat, selectChatContact } = ChatApp;

`;

// Insert after the original imports
const lastImportIdx = mainJs.lastIndexOf("import ");
const insertPos = mainJs.indexOf("\\n", lastImportIdx) + 1;
mainJs = mainJs.slice(0, insertPos) + "\\n" + imports + mainJs.slice(insertPos);

fs.writeFileSync('js/maestra/main.js', mainJs);
console.log('Main.js fully refactored and updated.');
