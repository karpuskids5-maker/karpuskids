const fs = require('fs');

// Fix maestra/main.js - replace joinMeeting embed with window.open
let c = fs.readFileSync('js/maestra/main.js', 'utf8');
const idx = c.indexOf('VideoCallModule.joinMeeting(meeting,');
if (idx > -1) {
  // Find the line start
  const lineStart = c.lastIndexOf('\n', idx) + 1;
  const lineEnd = c.indexOf('\n', idx) + 1;
  const oldLine = c.substring(lineStart, lineEnd);
  const newLines = `    // 4. Abrir en nueva pestana (evita lobby membersOnly)
    const _fullRoom = 'karpuskids-edu-2026_' + meeting.room_name;
    window.open('https://meet.jit.si/' + _fullRoom, '_blank');
`;
  // Also replace the comment line before it
  const commentStart = c.lastIndexOf('\n', lineStart - 2) + 1;
  const commentLine = c.substring(commentStart, lineStart);
  if (commentLine.includes('Renderizar Jitsi')) {
    c = c.substring(0, commentStart) + newLines + c.substring(lineEnd);
  } else {
    c = c.substring(0, lineStart) + newLines + c.substring(lineEnd);
  }
  fs.writeFileSync('js/maestra/main.js', c, 'utf8');
  console.log('Fixed maestra/main.js');
} else {
  console.log('joinMeeting not found in maestra/main.js');
}

// Fix padre/main.js - replace VideoCallModule.joinMeeting in checkActiveMeetings
let p = fs.readFileSync('js/padre/main.js', 'utf8');
const pidx = p.indexOf('VideoCallModule.joinMeeting(active,');
if (pidx > -1) {
  const lineStart = p.lastIndexOf('\n', pidx) + 1;
  const lineEnd = p.indexOf('\n', pidx) + 1;
  const newLine = `          window.open('https://meet.jit.si/karpuskids-edu-2026_' + active.room_name, '_blank');
`;
  p = p.substring(0, lineStart) + newLine + p.substring(lineEnd);
  fs.writeFileSync('js/padre/main.js', p, 'utf8');
  console.log('Fixed padre/main.js');
} else {
  console.log('joinMeeting not found in padre/main.js');
}
