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

