const fs = require('fs');

let code = fs.readFileSync('js/asistente/main.js', 'utf8');

const imports = \`import { StudentsModule } from './modules/students.js';
import { RoomsModule } from './modules/rooms.js';
import { DashboardModule } from './modules/dashboard.js';
\`;

// Insert imports at the top, just below ChatModule import
const importAnchor = "import { ChatModule } from '../shared/chat.js';";
if (code.includes(importAnchor)) {
    code = code.replace(importAnchor, importAnchor + '\\n' + imports);
} else {
    code = imports + code;
}

// Map window.App
const newAppMappings = \`
  Object.assign(window.App, {
    // Legacy maps (from generic UI if needed)
    _registerAccess: (sid, type) => AccessModule.register(sid, type),
    _confirmPayment: (id) => PaymentsModule.confirmPayment(id),
    _rejectPayment: (id) => PaymentsModule.rejectPayment(id),
    _deletePayment: (id) => PaymentsModule.deletePayment(id),
    _registerPayment: (sid) => PaymentsModule.openModal(sid),
    _openTeacherModal: (id) => TeachersModule.openModal(id),
    _toggleCommentSection: (id) => WallModule.toggleCommentSection(id),
    _deleteComment: (cid, pid) => WallModule.deleteComment(cid, pid),
    _sendComment: (pid) => sendComment(pid),
    _toggleLike: (pid) => WallModule.toggleLike(pid),
    _selectChatContact: (uid, name, role) => selectAssistantChat(uid, name, role),
    
    // New Modular mappings
    students: StudentsModule,
    rooms: RoomsModule
  });
\`;

code = code.replace(/Object\.assign\(window\.App,\s*\{[\s\S]*?\}\);/, newAppMappings);

// Replace loadAsistenteStudents call in initNavigation with StudentsModule.init()
code = code.replace(/await loadAsistenteStudents\(\);/g, "await StudentsModule.init();");

// Replace loadAsistenteRooms call in initNavigation with RoomsModule.init()
code = code.replace(/await loadAsistenteRooms\(\);/g, "await RoomsModule.init();");

// Replace initDashboard() call with DashboardModule.init()
code = code.replace(/initDashboard\(\)\.then/g, "DashboardModule.init().then");
code = code.replace(/initDashboard\(\);/g, "DashboardModule.init();");

// Obsolete old functions (to keep them from interfering but preserving them just in case)
const functionsToObsolete = [
    'initDashboard', 
    'loadAsistenteStudents', 
    'loadAsistenteRooms'
];

functionsToObsolete.forEach(fn => {
    const rx = new RegExp(\`(async\\s+)?function\\s+\${fn}\\s*\\(\`, 'g');
    code = code.replace(rx, \`$1function obsolete_\${fn}(\`);
});

fs.writeFileSync('js/asistente/main.js', code);
console.log('main.js for asistente updated successfully.');
