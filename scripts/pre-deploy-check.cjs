/**
 * ✅ Karpus Kids — Pre-Deploy Checklist
 * Ejecutar: node scripts/pre-deploy-check.js
 */

const fs   = require('fs');
const path = require('path');

const checks = [];
let passed = 0;
let failed = 0;

function check(name, condition, fix = '') {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    if (fix) console.log(`     → ${fix}`);
    failed++;
  }
  checks.push({ name, ok: condition, fix });
}

console.log('\n🔍 Karpus Kids — Pre-Deploy Checklist\n');

// ── Security ──────────────────────────────────────────────────
console.log('🔐 Security:');
const gitignore = fs.existsSync('.gitignore') ? fs.readFileSync('.gitignore', 'utf8') : '';
check('.env in .gitignore', gitignore.includes('.env'), 'Add .env to .gitignore');
check('.env file exists', fs.existsSync('.env'), 'Create .env with required variables');

const supabaseJs = fs.readFileSync('js/shared/supabase.js', 'utf8');
check('ANON_KEY in supabase.js (expected for frontend)', supabaseJs.includes('SUPABASE_ANON_KEY'), '');
check('No SERVICE_ROLE_KEY in frontend JS', !supabaseJs.includes('SERVICE_ROLE_KEY'), 'Remove SERVICE_ROLE_KEY from frontend code');

// ── Edge Functions ────────────────────────────────────────────
console.log('\n📦 Edge Functions:');
const fns = ['send-email','send-push','process-event','payment-reminders'];
for (const fn of fns) {
  check(`${fn}/index.ts exists`, fs.existsSync(`supabase/functions/${fn}/index.ts`), `Create supabase/functions/${fn}/index.ts`);
}

// ── Database ──────────────────────────────────────────────────
// El esquema vive en supabase/migrations/*.sql (14 migraciones consolidadas).
// La antigua ruta db/production-fixes.sql quedó obsoleta.
console.log('\n🗄️ Database:');
const MIGRATIONS_DIR = 'supabase/migrations';
const migrations = fs.existsSync(MIGRATIONS_DIR)
  ? fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
  : [];
check('supabase/migrations/ has SQL files', migrations.length > 0, 'Add SQL migrations to supabase/migrations/');
if (migrations.length) {
  check(`migrations sorted & newest is ${migrations[migrations.length - 1]}`, true, '');
  const idx = migrations.map((f, i) => [f, i]).filter(([f]) => /^\d{14}_\d{2}_/.test(f));
  check('migration filenames follow YYYYMMDDHHMMSS_NN_slug.sql', idx.length === migrations.length,
    `Rename to match convention: ${migrations.filter(f => !/^\d{14}_\d{2}_/.test(f)).join(', ')}`);
}

// ── PWA ───────────────────────────────────────────────────────
console.log('\n📱 PWA:');
check('manifest.json exists', fs.existsSync('manifest.json'), 'Create manifest.json');
check('sw.js exists', fs.existsSync('sw.js'), 'Create sw.js service worker');
check('OneSignalSDKWorker.js exists', fs.existsSync('OneSignalSDKWorker.js'), 'Create OneSignalSDKWorker.js');

const panels = ['panel_padres.html','panel-maestra.html','panel_directora.html','panel_asistente.html'];
for (const panel of panels) {
  if (fs.existsSync(panel)) {
    const html = fs.readFileSync(panel, 'utf8');
    check(`${panel} has SW registration`, html.includes('serviceWorker.register'), `Add SW registration to ${panel}`);
    check(`${panel} has manifest link`, html.includes('manifest.json'), `Add <link rel="manifest"> to ${panel}`);
  }
}

// ── Shared Modules ────────────────────────────────────────────
console.log('\n📁 Shared Modules:');
const modules = [
  'js/shared/supabase.js',
  'js/shared/helpers.js',
  'js/shared/chat.js',
  'js/shared/wall.js',
  'js/shared/badges.js',
  'js/shared/scroll.module.js',
  'js/shared/image-loader.js',
  'js/shared/payment-service.js',
  'js/shared/onboarding.js',
  'js/shared/videocall-ui.js',
  'js/shared/notify-permission.js',
];
for (const mod of modules) {
  check(`${path.basename(mod)} exists`, fs.existsSync(mod), `Create ${mod}`);
}

// ── Summary ───────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`✅ Passed: ${passed}  ❌ Failed: ${failed}`);

if (failed === 0) {
  console.log('\n🎉 All checks passed! Ready for production.\n');
} else {
  console.log(`\n⚠️  Fix ${failed} issue(s) before deploying.\n`);
  process.exit(1);
}
