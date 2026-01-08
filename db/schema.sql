-- Karpus Kids - Esquema de Base de Datos (SQLite)

PRAGMA foreign_keys = ON;

-- Aulas / Clases
CREATE TABLE IF NOT EXISTS classrooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  level TEXT NOT NULL -- Pequeños / Medianos / Grandes
);

-- Estudiantes
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  classroom_id INTEGER NOT NULL,
  avatar_url TEXT,
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
);

-- Padres / Tutores
CREATE TABLE IF NOT EXISTS parents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  job TEXT,
  bio TEXT,
  avatar_url TEXT
);

-- Relación estudiante ↔ padre
CREATE TABLE IF NOT EXISTS student_parents (
  student_id INTEGER NOT NULL,
  parent_id INTEGER NOT NULL,
  PRIMARY KEY (student_id, parent_id),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE
);

-- Asistencia
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  date TEXT NOT NULL, -- ISO yyyy-mm-dd
  status TEXT NOT NULL CHECK (status IN ('present','absent','late')),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- Tareas / Actividades
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  classroom_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT NOT NULL,
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
);

-- Entregas de tareas (evidencia)
CREATE TABLE IF NOT EXISTS task_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  submitted_at TEXT NOT NULL,
  file_type TEXT,
  comment TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- Calificaciones / Observaciones
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  grade INTEGER,
  comment TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- Publicaciones en el Muro del Aula
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  classroom_id INTEGER NOT NULL,
  author_role TEXT NOT NULL CHECK (author_role IN ('maestra','directora')),
  title TEXT NOT NULL,
  content TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  type TEXT NOT NULL, -- image, file, link
  url TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- Mensajes privados (chat)
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id TEXT NOT NULL, -- e.g., 'padre_andrea', 'maestra'
  to_id TEXT NOT NULL,   -- e.g., 'maestra', 'directora'
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Notificaciones generales
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  classroom_id INTEGER, -- NULL para General
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  date TEXT NOT NULL,
  sender_id TEXT,
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE SET NULL
);

-- Seeds mínimos para demo

INSERT INTO classrooms (name, level) VALUES
('Aula 1', 'Pequeños'),
('Aula 2', 'Medianos');

INSERT INTO students (first_name, last_name, classroom_id, avatar_url) VALUES
('Andrea', 'Flores', 1, 'https://placehold.co/120x120');

INSERT INTO parents (name, email, phone, job, bio, avatar_url) VALUES
('Juan Pérez', 'juan.perez@email.com', '+1 829 555 0101', 'Empresa S.A.', '', '');

INSERT INTO student_parents (student_id, parent_id) VALUES (1, 1);

-- Tareas de ejemplo
INSERT INTO tasks (classroom_id, title, description, due_date) VALUES
(1, 'Tarea 1: Lectura de cuento', 'Leer un cuento y resumir en 3 líneas', DATE('now','+3 day')),
(1, 'Tarea 2: Dibujo libre', 'Dibuja tu animal favorito', DATE('now','+7 day'));

-- Publicación en el aula
INSERT INTO posts (classroom_id, author_role, title, content, created_at) VALUES
(1, 'maestra', 'Bienvenida', '¡Bienvenidos al Aula 1!', DATE('now'));

-- Notificación general de mensaje
INSERT INTO notifications (classroom_id, type, text, date, sender_id) VALUES
(NULL, 'message', 'La Maestra Ana te ha enviado un mensaje nuevo.', DATE('now'), 'maestra');

-- Mensajes iniciales (hilo entre padre y maestra)
INSERT INTO messages (from_id, to_id, text, created_at) VALUES
('maestra', 'padre_andrea', 'Hola, ¿cómo va Andrea con la lectura?', DATE('now')),
('padre_andrea', 'maestra', 'Va muy bien, gracias por preguntar.', DATE('now'));

