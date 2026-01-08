// Inicializa SQLite con schema y seeds
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = path.join(root, 'data');
const dbPath = path.join(dataDir, 'karpus.db');
const schemaPath = path.join(root, 'db', 'schema.sql');
const seedPath = path.join(root, 'db', 'seed.sql');

const reset = process.argv.includes('--reset');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readSql(file) {
  if (!fs.existsSync(file)) throw new Error(`No se encontró: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function runSql(db, sql) {
  const statements = sql
    .split(/;\s*\n/) // separa por ; fin de línea
    .map(s => s.trim())
    .filter(Boolean);
  const tx = db.transaction(() => {
    for (const s of statements) db.prepare(s).run();
  });
  tx();
}

function main() {
  ensureDir(dataDir);
  if (reset && fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('DB anterior eliminada.');
  }

  const isNew = !fs.existsSync(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const schema = readSql(schemaPath);
  runSql(db, schema);
  console.log('Esquema aplicado.');

  if (isNew || reset) {
    const seed = readSql(seedPath);
    runSql(db, seed);
    console.log('Seeds cargados.');
  } else {
    console.log('DB ya existía; omitidos seeds. Usa --reset para recrear.');
  }

  const row = db.prepare('SELECT name, level FROM classrooms LIMIT 1').get();
  console.log('Aula inicial:', row);
  db.close();
  console.log(`Base de datos lista en: ${dbPath}`);
}

main();

