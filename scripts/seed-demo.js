// Seed mínimo para demo de Karpus Kids
// Ejecuta: npm run seed
const Database = require('better-sqlite3');
const path = require('path');

function run() {
  const dbPath = path.join(__dirname, '..', 'data', 'karpus.db');
  const db = new Database(dbPath);

  const tx = db.transaction(() => {
    // Helpers idempotentes
    const getClassroomByName = db.prepare('SELECT id FROM classrooms WHERE name = ? LIMIT 1');
    const insertClassroom = db.prepare('INSERT INTO classrooms (name, level) VALUES (?, ?)');

    const upsertClassroom = (name, level) => {
      const row = getClassroomByName.get(name);
      if (row && row.id) return row.id;
      const info = insertClassroom.run(name, level);
      return info.lastInsertRowid;
    };

    const getStudentByName = db.prepare('SELECT id FROM students WHERE first_name = ? AND last_name = ? LIMIT 1');
    const insertStudent = db.prepare('INSERT INTO students (first_name, last_name, classroom_id, avatar_url) VALUES (?, ?, ?, ?)');
    const updateStudentClassroom = db.prepare('UPDATE students SET classroom_id = ?, avatar_url = ? WHERE id = ?');

    const upsertStudent = (firstName, lastName, classroomId, avatarUrl) => {
      const row = getStudentByName.get(firstName, lastName);
      if (row && row.id) {
        updateStudentClassroom.run(classroomId, avatarUrl, row.id);
        return row.id;
      }
      const info = insertStudent.run(firstName, lastName, classroomId, avatarUrl);
      return info.lastInsertRowid;
    };

    const getParentByEmail = db.prepare('SELECT id FROM parents WHERE email = ? LIMIT 1');
    const getParentByName = db.prepare('SELECT id FROM parents WHERE name = ? LIMIT 1');
    const insertParent = db.prepare('INSERT INTO parents (name, email, phone, job, bio, avatar_url) VALUES (?, ?, ?, ?, ?, ?)');
    const updateParent = db.prepare('UPDATE parents SET phone = ?, job = ?, bio = ?, avatar_url = ? WHERE id = ?');

    const upsertParent = (name, email, phone, job, bio, avatarUrl) => {
      let row = null;
      if (email && email.trim()) row = getParentByEmail.get(email);
      if (!row) row = getParentByName.get(name);
      if (row && row.id) {
        updateParent.run(phone, job, bio, avatarUrl, row.id);
        return row.id;
      }
      const info = insertParent.run(name, email, phone, job, bio, avatarUrl);
      return info.lastInsertRowid;
    };

    const getLink = db.prepare('SELECT id FROM student_parents WHERE student_id = ? AND parent_id = ? LIMIT 1');
    const insertLink = db.prepare('INSERT INTO student_parents (student_id, parent_id) VALUES (?, ?)');

    const linkStudentParent = (studentId, parentId) => {
      const row = getLink.get(studentId, parentId);
      if (!row) insertLink.run(studentId, parentId);
    };

    const getTaskByTitle = db.prepare('SELECT id FROM tasks WHERE classroom_id = ? AND title = ? LIMIT 1');
    const insertTask = db.prepare('INSERT INTO tasks (classroom_id, title, description, due_date) VALUES (?, ?, ?, ?)');

    const upsertTask = (classroomId, title, description, dueDateSQL) => {
      const row = getTaskByTitle.get(classroomId, title);
      if (row && row.id) return row.id;
      const info = insertTask.run(classroomId, title, description, dueDateSQL);
      return info.lastInsertRowid;
    };

    const getPostByTitle = db.prepare('SELECT id FROM posts WHERE classroom_id = ? AND title = ? LIMIT 1');
    const insertPost = db.prepare('INSERT INTO posts (classroom_id, author_role, title, content, created_at) VALUES (?, ?, ?, ?, DATE("now"))');

    const upsertPost = (classroomId, authorRole, title, content) => {
      const row = getPostByTitle.get(classroomId, title);
      if (row && row.id) return row.id;
      const info = insertPost.run(classroomId, authorRole, title, content);
      return info.lastInsertRowid;
    };

    const getNotificationByText = db.prepare('SELECT id FROM notifications WHERE text = ? LIMIT 1');
    const insertNotification = db.prepare('INSERT INTO notifications (classroom_id, type, text, date, sender_id) VALUES (?, ?, ?, DATE("now"), ?)');

    const upsertNotification = (classroomIdNullable, type, text, senderId) => {
      const row = getNotificationByText.get(text);
      if (row && row.id) return row.id;
      const info = insertNotification.run(classroomIdNullable, type, text, senderId);
      return info.lastInsertRowid;
    };

    const getMessage = db.prepare('SELECT id FROM messages WHERE from_id = ? AND to_id = ? AND text = ? LIMIT 1');
    const insertMessage = db.prepare('INSERT INTO messages (from_id, to_id, text, created_at) VALUES (?, ?, ?, DATE("now"))');

    const upsertMessage = (fromId, toId, text) => {
      const row = getMessage.get(fromId, toId, text);
      if (row && row.id) return row.id;
      const info = insertMessage.run(fromId, toId, text);
      return info.lastInsertRowid;
    };

    // 1) Aulas
    const aula1Id = upsertClassroom('Aula 1', 'Pequeños');
    upsertClassroom('Aula 2', 'Medianos');

    // 2) Estudiante Andrea en Aula 1
    const andreaId = upsertStudent('Andrea', 'Flores', aula1Id, 'https://placehold.co/120x120');

    // 3) Padre Juan Pérez y enlace
    const juanId = upsertParent('Juan Pérez', 'juan.perez@email.com', '+1 829 555 0101', 'Empresa S.A.', '', '');
    linkStudentParent(andreaId, juanId);

    // 4) Tareas demo
    upsertTask(aula1Id, 'Tarea 1: Lectura de cuento', 'Leer un cuento y resumir en 3 líneas', "DATE('now','+3 day')");
    upsertTask(aula1Id, 'Tarea 2: Dibujo libre', 'Dibuja tu animal favorito', "DATE('now','+7 day')");

    // 5) Publicación de bienvenida
    upsertPost(aula1Id, 'maestra', 'Bienvenida', '¡Bienvenidos al Aula 1!');

    // 6) Notificación general
    upsertNotification(null, 'message', 'La Maestra Ana te ha enviado un mensaje nuevo.', 'maestra');

    // 7) Mensajes iniciales (hilo padre <-> maestra)
    upsertMessage('maestra', 'padre_andrea', 'Hola, ¿cómo va Andrea con la lectura?');
    upsertMessage('padre_andrea', 'maestra', 'Va muy bien, gracias por preguntar.');
  });

  tx();
  console.log('Seeds demo aplicados correctamente.');
}

if (require.main === module) {
  run();
}

