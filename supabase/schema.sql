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

-- Profesores / Maestros
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  specialty TEXT,
  avatar_url TEXT
);

-- Pagos
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('paid','pending','overdue')),
  due_date TEXT NOT NULL,
  paid_date TEXT,
  concept TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
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

-- Seeds para Profesores
INSERT INTO teachers (name, email, phone, specialty, avatar_url) VALUES
('Ana Gómez', 'ana.gomez@email.com', '+1 809 555 1234', 'Preescolar', 'https://placehold.co/100x100');

-- Seeds para Pagos
INSERT INTO payments (student_id, amount, status, due_date, concept) VALUES
(1, 5000.00, 'pending', DATE('now','+5 day'), 'Mensualidad Marzo');

-- Karpus Kids - Esquema de Base de Datos para Supabase (Postgres)

-- NOTA: No incluye seeds demo. Ejecútalo en el SQL editor de Supabase.

create table if not exists public.classrooms (
  id integer generated always as identity primary key,
  name text not null,
  level text not null
);

create table if not exists public.students (
  id integer generated always as identity primary key,
  first_name text not null,
  last_name text not null,
  classroom_id integer not null references public.classrooms(id) on delete cascade,
  avatar_url text
);

create table if not exists public.parents (
  id integer generated always as identity primary key,
  name text not null,
  email text,
  phone text,
  job text,
  bio text,
  avatar_url text
);

create table if not exists public.student_parents (
  student_id integer not null references public.students(id) on delete cascade,
  parent_id integer not null references public.parents(id) on delete cascade,
  primary key (student_id, parent_id)
);

create table if not exists public.attendance (
  id integer generated always as identity primary key,
  student_id integer not null references public.students(id) on delete cascade,
  date date not null,
  status text not null check (status in ('present','absent','late'))
);

create table if not exists public.tasks (
  id integer generated always as identity primary key,
  classroom_id integer not null references public.classrooms(id) on delete cascade,
  title text not null,
  description text,
  due_date timestamp without time zone not null
);

create table if not exists public.task_submissions (
  id integer generated always as identity primary key,
  task_id integer not null references public.tasks(id) on delete cascade,
  student_id integer not null references public.students(id) on delete cascade,
  submitted_at timestamp without time zone not null default now(),
  file_type text,
  comment text
);

create table if not exists public.grades (
  id integer generated always as identity primary key,
  task_id integer not null references public.tasks(id) on delete cascade,
  student_id integer not null references public.students(id) on delete cascade,
  grade integer,
  comment text
);

create table if not exists public.posts (
  id integer generated always as identity primary key,
  classroom_id integer not null references public.classrooms(id) on delete cascade,
  author_role text not null check (author_role in ('maestra','directora')),
  title text not null,
  content text,
  created_at timestamp without time zone not null default now()
);

create table if not exists public.post_attachments (
  id integer generated always as identity primary key,
  post_id integer not null references public.posts(id) on delete cascade,
  type text not null,
  url text not null
);

create table if not exists public.messages (
  id integer generated always as identity primary key,
  from_id text not null,
  to_id text not null,
  text text not null,
  created_at timestamp without time zone not null default now()
);

create table if not exists public.notifications (
  id integer generated always as identity primary key,
  classroom_id integer references public.classrooms(id) on delete set null,
  type text not null,
  text text not null,
  date timestamp without time zone not null default now(),
  sender_id text
);

create table if not exists public.teachers (
  id integer generated always as identity primary key,
  name text not null,
  email text,
  phone text,
  specialty text,
  avatar_url text
);

create table if not exists public.payments (
  id integer generated always as identity primary key,
  student_id integer not null references public.students(id) on delete cascade,
  amount numeric not null,
  status text not null check (status in ('paid','pending','overdue')),
  due_date timestamp without time zone not null,
  paid_date timestamp without time zone,
  concept text not null
);