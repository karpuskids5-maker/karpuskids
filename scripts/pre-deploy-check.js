import fs from 'fs';
import path from 'path';

console.log('🔍 Iniciando verificación pre-despliegue para Karpus Kids...');

// 1. Verificación de variables de entorno (Superficialmente, revisando .env)
const envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.warn('⚠️  ADVERTENCIA: No se encontró un archivo .env. Asegúrate de que las variables estén configuradas en tu servidor de despliegue (ej. Vercel, Supabase, Render).');
} else {
  console.log('✅ Archivo .env detectado.');
}

// 2. Verificación de Tailwind Compilado
const cssPath = path.resolve(process.cwd(), 'css', 'karpus-tailwind.css');
if (!fs.existsSync(cssPath)) {
  console.error('❌ ERROR FATAL: No se encontró el CSS compilado de Tailwind (karpus-tailwind.css).');
  console.error('👉 Ejecuta: "npm run build:css" ANTES de despegar a producción.');
  process.exit(1);
} else {
  const stats = fs.statSync(cssPath);
  if (stats.size < 1000) {
    console.warn('⚠️  ADVERTENCIA: El archivo karpus-tailwind.css parece estar vacío o corrupto. Verifica tu build.');
  } else {
    console.log('✅ Tailwind CSS compilado detectado.');
  }
}

// 3. Verificación de Módulos (Panel Maestra)
const modulesToCheck = ['attendance.js', 'routine.js', 'tasks.js', 'students.js', 'chat_app.js', 'ui.js'];
let missingModules = false;
console.log('Verificando módulos ES6 de Maestra...');
modulesToCheck.forEach(mod => {
  const modPath = path.resolve(process.cwd(), 'js', 'maestra', 'modules', mod);
  if (!fs.existsSync(modPath)) {
    console.error(`❌ ERROR: Falta el módulo ${mod}`);
    missingModules = true;
  }
});

if (missingModules) {
  process.exit(1);
} else {
  console.log('✅ Todos los módulos ES6 de Maestra están presentes.');
}

// 4. Verificación de Módulos (Panel Asistente)
const asstModulesToCheck = ['students.js', 'rooms.js', 'dashboard.js'];
let missingAsstModules = false;
console.log('Verificando módulos ES6 de Asistente...');
asstModulesToCheck.forEach(mod => {
  const modPath = path.resolve(process.cwd(), 'js', 'asistente', 'modules', mod);
  if (!fs.existsSync(modPath)) {
    console.error(`❌ ERROR: Falta el módulo de asistente ${mod}`);
    missingAsstModules = true;
  }
});

if (missingAsstModules) {
  process.exit(1);
} else {
  console.log('✅ Todos los módulos ES6 de Asistente están presentes.');
}

console.log('🎉 Verificación pre-despliegue superada. ¡Listo para producción!');
