const fs = require('fs');
const files = ['attendance.js', 'routine.js', 'tasks.js', 'students.js', 'chat_app.js'];
files.forEach(f => {
  const p = 'js/maestra/modules/' + f;
  let code = fs.readFileSync(p, 'utf8');
  // replace \` with `
  code = code.split('\\`').join('\`');
  // replace \$ with $
  code = code.split('\\$').join('$');
  fs.writeFileSync(p, code);
});
console.log('Fixed escape characters properly.');
