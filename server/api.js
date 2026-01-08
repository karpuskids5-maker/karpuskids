import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { useSupabase, supabase } from './dbProvider.js';

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database('./data/karpus.db');

function rows(sql, params = []) {
  return db.prepare(sql).all(...params);
}
function row(sql, params = []) {
  return db.prepare(sql).get(...params);
}
function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

// Classrooms
app.get('/api/classrooms', async (req, res) => {
  try {
    if (useSupabase) {
      const { data, error } = await supabase
        .from('classrooms')
        .select('id,name,level')
        .order('id', { ascending: true });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }
    const list = rows('SELECT id, name, level FROM classrooms ORDER BY id');
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Posts by class level (Pequeños/Medianos/Grandes)
app.get('/api/posts', async (req, res) => {
  try {
    const cls = req.query.class; // level
    if (useSupabase) {
      // Obtener aulas por nivel (si se filtra)
      let classroomIds = [];
      if (cls) {
        const { data: classrooms, error: clsErr } = await supabase
          .from('classrooms')
          .select('id')
          .eq('level', cls);
        if (clsErr) return res.status(500).json({ error: clsErr.message });
        classroomIds = (classrooms || []).map(c => c.id);
      }
      // Posts
      let postsQuery = supabase
        .from('posts')
        .select('id,classroom_id,author_role,title,content,created_at')
        .order('created_at', { ascending: false });
      if (cls && classroomIds.length) postsQuery = postsQuery.in('classroom_id', classroomIds);
      const { data: posts, error } = await postsQuery;
      if (error) return res.status(500).json({ error: error.message });
      const ids = (posts || []).map(p => p.id);
      let atts = [];
      if (ids.length) {
        const { data: attachments, error: attErr } = await supabase
          .from('post_attachments')
          .select('id,post_id,type,url')
          .in('post_id', ids);
        if (attErr) return res.status(500).json({ error: attErr.message });
        atts = attachments || [];
      }
      // Map classroom_id -> level
      const clsIds = [...new Set((posts || []).map(p => p.classroom_id))];
      let levelMap = new Map();
      if (clsIds.length) {
        const { data: clsRows, error: mapErr } = await supabase
          .from('classrooms')
          .select('id,level')
          .in('id', clsIds);
        if (mapErr) return res.status(500).json({ error: mapErr.message });
        levelMap = new Map((clsRows || []).map(c => [c.id, c.level]));
      }
      const shaped = (posts || []).map(p => ({
        id: p.id,
        class: levelMap.get(p.classroom_id) || 'General',
        teacher: p.author_role === 'maestra' ? 'Maestra' : 'Directora',
        date: p.created_at,
        text: p.title + (p.content ? ': ' + p.content : ''),
        photo: '',
        video: '',
        docUrl: '',
        docType: '',
        comments: [],
        reactions: { likes: 0, emoji: {} },
        attachments: atts.filter(a => a.post_id === p.id)
      }));
      return res.json(shaped);
    }
    // SQLite
    const posts = rows(`
      SELECT p.id, c.level AS class, p.author_role, p.title, p.content, p.created_at
      FROM posts p
      JOIN classrooms c ON c.id = p.classroom_id
      ${cls ? 'WHERE c.level = ?' : ''}
      ORDER BY p.created_at DESC
    `, cls ? [cls] : []);
    const ids = posts.map(p => p.id);
    let atts = [];
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      atts = rows(`SELECT id, post_id, type, url FROM post_attachments WHERE post_id IN (${placeholders})`, ids);
    }
    const withAtts = posts.map(p => ({
      id: p.id,
      class: p.class,
      teacher: p.author_role === 'maestra' ? 'Maestra' : 'Directora',
      date: p.created_at,
      text: p.title + (p.content ? ': ' + p.content : ''),
      photo: '',
      video: '',
      docUrl: '',
      docType: '',
      comments: [],
      reactions: { likes: 0, emoji: {} },
      attachments: atts.filter(a => a.post_id === p.id)
    }));
    res.json(withAtts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tasks by class level
app.get('/api/tasks', async (req, res) => {
  try {
    const cls = req.query.class; // level
    if (useSupabase) {
      // Obtener aulas por nivel
      let classroomIds = [];
      if (cls) {
        const { data: classrooms, error: clsErr } = await supabase
          .from('classrooms')
          .select('id')
          .eq('level', cls);
        if (clsErr) return res.status(500).json({ error: clsErr.message });
        classroomIds = (classrooms || []).map(c => c.id);
      }
      let tasksQuery = supabase
        .from('tasks')
        .select('id,classroom_id,title,description,due_date')
        .order('id', { ascending: false });
      if (cls && classroomIds.length) tasksQuery = tasksQuery.in('classroom_id', classroomIds);
      const { data: tasks, error } = await tasksQuery;
      if (error) return res.status(500).json({ error: error.message });

      const ids = (tasks || []).map(t => t.id);
      let subs = [], grades = [];
      if (ids.length) {
        const { data: submissions, error: subErr } = await supabase
          .from('task_submissions')
          .select('id,task_id,student_id,submitted_at,file_type,comment')
          .in('task_id', ids);
        if (!subErr) subs = submissions || [];
        const { data: gradeRows, error: gradeErr } = await supabase
          .from('grades')
          .select('id,task_id,student_id,grade,comment')
          .in('task_id', ids);
        if (!gradeErr) grades = gradeRows || [];
      }
      const { data: students, error: stuErr } = await supabase
        .from('students')
        .select('id,first_name,last_name');
      if (stuErr) return res.status(500).json({ error: stuErr.message });
      const studentsMap = new Map((students || []).map(s => [s.id, `${s.first_name} ${s.last_name}`]));

      // Map classroom_id -> level
      const clsIds = [...new Set((tasks || []).map(t => t.classroom_id))];
      let levelMap = new Map();
      if (clsIds.length) {
        const { data: clsRows } = await supabase
          .from('classrooms')
          .select('id,level')
          .in('id', clsIds);
        levelMap = new Map((clsRows || []).map(c => [c.id, c.level]));
      }

      const shaped = (tasks || []).map(t => ({
        id: t.id,
        class: levelMap.get(t.classroom_id) || 'General',
        title: t.title,
        desc: t.description,
        publish: t.due_date,
        due: t.due_date,
        attachments: [],
        submissions: (subs || []).filter(s => s.task_id === t.id).map(s => ({
          parent: studentsMap.get(s.student_id) || 'Estudiante',
          comment: s.comment,
          fileType: s.file_type,
          files: [],
          date: s.submitted_at
        })),
        grades: (grades || []).filter(g => g.task_id === t.id).map(g => ({
          student: studentsMap.get(g.student_id) || 'Estudiante',
          grade: g.grade,
          comment: g.comment,
          date: ''
        }))
      }));
      return res.json(shaped);
    }
    // SQLite
    const tasks = rows(`
      SELECT t.id, c.level AS class, t.title, t.description, t.due_date
      FROM tasks t
      JOIN classrooms c ON c.id = t.classroom_id
      ${cls ? 'WHERE c.level = ?' : ''}
      ORDER BY t.id DESC
    `, cls ? [cls] : []);
    const ids = tasks.map(t => t.id);
    let subs = [], grades = [];
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      subs = rows(`SELECT id, task_id, student_id, submitted_at, file_type, comment FROM task_submissions WHERE task_id IN (${placeholders})`, ids);
      grades = rows(`SELECT id, task_id, student_id, grade, comment FROM grades WHERE task_id IN (${placeholders})`, ids);
    }
    const studentsMap = new Map(rows('SELECT id, first_name, last_name FROM students').map(s => [s.id, `${s.first_name} ${s.last_name}`]));
    const shaped = tasks.map(t => ({
      id: t.id,
      class: t.class,
      title: t.title,
      desc: t.description,
      publish: t.due_date,
      due: t.due_date,
      attachments: [],
      submissions: subs.filter(s => s.task_id === t.id).map(s => ({
        parent: studentsMap.get(s.student_id) || 'Estudiante',
        comment: s.comment,
        fileType: s.file_type,
        files: [],
        date: s.submitted_at
      })),
      grades: grades.filter(g => g.task_id === t.id).map(g => ({
        student: studentsMap.get(g.student_id) || 'Estudiante',
        grade: g.grade,
        comment: g.comment,
        date: ''
      }))
    }));
    res.json(shaped);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/task/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (useSupabase) {
      const { data: taskRows, error } = await supabase
        .from('tasks')
        .select('id,classroom_id,title,description,due_date')
        .eq('id', id)
        .limit(1);
      if (error) return res.status(500).json({ error: error.message });
      const t = (taskRows || [])[0];
      if (!t) return res.status(404).json({ error: 'Not found' });
      let level = 'General';
      if (t.classroom_id) {
        const { data: clsRows } = await supabase
          .from('classrooms')
          .select('id,level')
          .eq('id', t.classroom_id)
          .limit(1);
        level = (clsRows && clsRows[0] && clsRows[0].level) || 'General';
      }
      return res.json({ id: t.id, class: level, title: t.title, desc: t.description, due: t.due_date });
    }
    const t = row(`
      SELECT t.id, c.level AS class, t.title, t.description, t.due_date
      FROM tasks t
      JOIN classrooms c ON c.id = t.classroom_id
      WHERE t.id = ?
    `, [id]);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json({ id: t.id, class: t.class, title: t.title, desc: t.description, due: t.due_date });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/task/:id/submissions', async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { studentId, fileType, comment } = req.body || {};
    if (!studentId) return res.status(400).json({ error: 'studentId requerido' });
    if (useSupabase) {
      const { error } = await supabase
        .from('task_submissions')
        .insert({ task_id: taskId, student_id: studentId, submitted_at: new Date().toISOString(), file_type: fileType || 'archivo', comment: comment || '' });
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true });
    }
    run('INSERT INTO task_submissions (task_id, student_id, submitted_at, file_type, comment) VALUES (?, ?, DATE("now"), ?, ?)', [taskId, studentId, fileType || 'archivo', comment || '']);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Notifications
app.get('/api/notifications', async (req, res) => {
  try {
    const cls = req.query.class; // level or 'General'
    if (useSupabase) {
      const { data: notifs, error } = await supabase
        .from('notifications')
        .select('id,classroom_id,type,text,date,sender_id')
        .order('id', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      const ids = [...new Set((notifs || []).map(n => n.classroom_id).filter(Boolean))];
      let levelMap = new Map();
      if (ids.length) {
        const { data: clsRows } = await supabase
          .from('classrooms')
          .select('id,level')
          .in('id', ids);
        levelMap = new Map((clsRows || []).map(c => [c.id, c.level]));
      }
      let items = (notifs || []).map(n => ({ id: n.id, class: levelMap.get(n.classroom_id) || 'General', type: n.type, text: n.text, date: n.date, senderId: n.sender_id }));
      if (cls) items = items.filter(n => n.class === cls || n.class === 'General');
      return res.json(items);
    }
    let items = rows(`
      SELECT n.id, n.classroom_id, n.type, n.text, n.date, n.sender_id, c.level AS class
      FROM notifications n
      LEFT JOIN classrooms c ON c.id = n.classroom_id
      ORDER BY n.id DESC
    `);
    items = items.map(n => ({ id: n.id, class: n.class || 'General', type: n.type, text: n.text, date: n.date, senderId: n.sender_id }));
    if (cls) items = items.filter(n => n.class === cls || n.class === 'General');
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Contacts (adultos institucionales)
app.get('/api/contacts', (req, res) => {
  res.json([
    { id: 'maestra', name: 'Maestra Ana' },
    { id: 'directora', name: 'Directora' }
  ]);
});

// Messages
app.get('/api/messages', async (req, res) => {
  try {
    const participants = (req.query.participants || '').split(',').map(s => s.trim()).filter(Boolean).sort();
    if (participants.length < 2) return res.status(400).json({ error: 'participants requeridos' });
    if (useSupabase) {
      const { data: msgs, error } = await supabase
        .from('messages')
        .select('id,from_id,to_id,text,created_at')
        .in('from_id', participants)
        .in('to_id', participants)
        .order('id');
      if (error) return res.status(500).json({ error: error.message });
      const thread = (msgs || []).filter(m => participants.includes(m.from_id) && participants.includes(m.to_id));
      return res.json({ participants, messages: thread.map(m => ({ id: m.id, from: m.from_id, text: m.text, date: m.created_at, status: 'sent', seenAt: '' })) });
    }
    const msgs = rows('SELECT id, from_id, to_id, text, created_at FROM messages ORDER BY id');
    const thread = msgs.filter(m => participants.includes(m.from_id) && participants.includes(m.to_id));
    res.json({ participants, messages: thread.map(m => ({ id: m.id, from: m.from_id, text: m.text, date: m.created_at, status: 'sent', seenAt: '' })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { participants, from, text } = req.body || {};
    const parts = Array.isArray(participants) ? participants.map(String) : [];
    if (parts.length < 2 || !from || !text) return res.status(400).json({ error: 'datos inválidos' });
    const to = parts.find(p => p !== from);
    if (useSupabase) {
      const { error } = await supabase
        .from('messages')
        .insert({ from_id: from, to_id: to, text, created_at: new Date().toISOString() });
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true });
    }
    run('INSERT INTO messages (from_id, to_id, text, created_at) VALUES (?, ?, ?, DATE("now"))', [from, to, text]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Profiles
app.get('/api/profiles/:role', (req, res) => {
  const role = req.params.role;
  if (role === 'teacher') return res.json({ name: 'Ana Pérez', email: 'ana@karpus.edu', bio: 'Educadora apasionada con experiencia en desarrollo infantil.', avatar: 'https://placehold.co/200x200' });
  if (role === 'director') return res.json({ name: 'Karonlyn García', bio: 'Fundadora de Karpus Kids.', avatar: 'img/mundo.jpg' });
  res.status(404).json({ error: 'role inválido' });
});

const PORT = process.env.PORT || 5600;
app.listen(PORT, () => {
  console.log(`API escuchando en http://127.0.0.1:${PORT}`);
});
