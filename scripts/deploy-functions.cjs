/**
 * 🚀 Karpus Kids — Deploy Edge Functions
 * Ejecutar: node scripts/deploy-functions.js
 */
const { execSync } = require('child_process');

const functions = [
  'send-email',
  'send-push',
  'process-event',
  'payment-reminders',
  'create-student-with-parent'
];

console.log('🚀 Deploying Karpus Kids Edge Functions...\n');

for (const fn of functions) {
  try {
    console.log(`📦 Deploying: ${fn}`);
    execSync(`npx supabase functions deploy ${fn} --no-verify-jwt`, {
      stdio: 'inherit',
      cwd: process.cwd()
    });
    console.log(`✅ ${fn} deployed\n`);
  } catch (e) {
    console.error(`❌ Failed to deploy ${fn}:`, e.message);
  }
}

console.log('\n✅ All functions deployed!');
console.log('\n📋 Next steps:');
console.log('1. Go to Supabase Dashboard → Settings → Edge Functions → Secrets');
console.log('2. Add: RESEND_API_KEY, ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY, FROM_EMAIL, SUPABASE_ANON_KEY');
console.log('3. Run db/production-fixes.sql in Supabase SQL Editor');
