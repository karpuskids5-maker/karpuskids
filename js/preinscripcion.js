/**
 * Preinscripcion — Karpus Kids
 * Wizard publico de 7 pasos. Inserta en student_preregistrations
 * y sube documentos comprimidos a Supabase Storage.
 */
const SUPABASE_URL      = "https://wwnfonkvemimwiqjpkij.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3bmZvbmt2ZW1pbXdpcWpwa2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MzY0MzUsImV4cCI6MjA4MzQxMjQzNX0.n5VW-3U0r2nRlwC8pDstQLowu9MZ3aWHMzXVVNFQaDo";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LEVELS_FALLBACK = ['Maternal','Infantes','Párvulos','Pre-Kinder','Kinder','Pre-Primaria','Primaria'];

const DOC_FIELDS = [
  { key: 'photo',        label: 'Foto del estudiante',        maxW: 900  },
  { key: 'acta',         label: 'Acta de nacimiento',         maxW: 1600 },
  { key: 'ced_front',    label: 'Cédula del tutor (frontal)',  maxW: 1400 },
  { key: 'ced_back',     label: 'Cédula del tutor (trasera)',  maxW: 1400 },
  { key: 'p1_ced_front', label: 'Cédula padre/madre (frontal)',maxW: 1400 },
  { key: 'p1_ced_back',  label: 'Cédula padre/madre (trasera)',maxW: 1400 },
  { key: 'p2_ced_front', label: 'Cédula 2º tutor (frontal)',   maxW: 1400 },
  { key: 'p2_ced_back',  label: 'Cédula 2º tutor (trasera)',   maxW: 1400 }
];

const STATE = {
  step: 1,
  docs: {},
  authorized: [],
  signature: null
};

function toast(msg, type = 'success') {
  document.querySelectorAll('.pi-toast').forEach(t => t.remove());
  const colors = { success: 'bg-slate-900', error: 'bg-rose-500', warning: 'bg-amber-500' };
  const el = document.createElement('div');
  el.className = `pi-toast fixed bottom-6 left-1/2 -translate-x-1/2 z-[999] px-6 py-3 rounded-2xl shadow-2xl text-sm font-bold text-white transition-all ${colors[type] || colors.success}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
}

function digitsOf(v) { return String(v || '').replace(/\D/g, ''); }

// Validacion de cedula dominicana (algoritmo modulo 10 / Luhn)
function validateCedula(v) {
  const d = digitsOf(v);
  if (d.length !== 11) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let prod = parseInt(d[i], 10) * (i % 2 === 0 ? 1 : 2);
    if (prod >= 10) prod -= 9;
    sum += prod;
  }
  return ((10 - (sum % 10)) % 10) === parseInt(d[10], 10);
}

function maskCedula(v) {
  const d = digitsOf(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 10) return d.slice(0, 3) + '-' + d.slice(3);
  return d.slice(0, 3) + '-' + d.slice(3, 10) + '-' + d.slice(10);
}

function maskPhone(v) {
  const d = digitsOf(v).slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return d.slice(0, 3) + '-' + d.slice(3);
  return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
}

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

function computeAge(birth) {
  if (!birth) return '';
  const [y, m, d] = birth.split('-').map(Number);
  const now = new Date();
  let years = now.getFullYear() - y;
  let months = now.getMonth() + 1 - m;
  if (now.getDate() < d) months--;
  if (months < 0) { years--; months += 12; }
  if (years < 0) return '';
  const parts = [];
  if (years > 0) parts.push(`${years} año${years === 1 ? '' : 's'}`);
  if (months > 0) parts.push(`${months} mes${months === 1 ? '' : 'es'}`);
  if (parts.length === 0) parts.push('Recién nacido');
  return parts.join(' y ');
}

function compressImage(file, maxW = 1400, targetKB = 500) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        let quality = 0.82;
        canvas.toBlob((b) => {
          if (!b) return reject(new Error('No se pudo comprimir la imagen'));
          resolve({ blob: b, preview: canvas.toDataURL('image/jpeg', 0.7), size: b.size });
        }, 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('Imagen inválida'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

async function loadDynamicData() {
  try {
    const { data: years } = await supabase
      .from('school_years')
      .select('id, name')
      .in('status', ['enrollment','reenrollment','active','draft'])
      .order('start_date', { ascending: false })
      .limit(5);
    const sel = $('#pi_school_year');
    if (years?.length) {
      sel.innerHTML = years.map(y => `<option value="${esc(y.name)}">${esc(y.name)}</option>`).join('');
    } else {
      const y = new Date().getFullYear();
      sel.innerHTML = `<option value="${y}-${y + 1}">${y}-${y + 1}</option>`;
    }
  } catch (_) {
    const y = new Date().getFullYear();
    $('#pi_school_year').innerHTML = `<option value="${y}-${y + 1}">${y}-${y + 1}</option>`;
  }

  try {
    const { data: rooms } = await supabase
      .from('classrooms')
      .select('level')
      .not('level', 'is', null);
    const levels = [...new Set((rooms || []).map(r => r.level).filter(Boolean))];
    $('#pi_level').innerHTML = (levels.length ? levels : LEVELS_FALLBACK)
      .map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
  } catch (_) {
    $('#pi_level').innerHTML = LEVELS_FALLBACK.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
  }

}

const STEP_TITLES = {
  1: 'Datos del niño(a)', 2: 'Padres / Tutores', 3: 'Emergencia y autorizados',
  4: 'Información médica', 5: 'Documentos', 6: 'Autorizaciones y firma', 7: 'Resumen y envío',
};

function goTo(step) {
  STATE.step = step;
  const pct = Math.round(((step - 1) / 6) * 100);
  $$('.step-card').forEach(s => s.classList.toggle('active', Number(s.dataset.step) === step));
  $$('#progressBar [data-step-btn]').forEach(btn => {
    const n = Number(btn.dataset.stepBtn);
    btn.classList.remove('current', 'done');
    if (n === step) btn.classList.add('current');
    else if (n < step) btn.classList.add('done');
  });
  const fill = $('#progressFill');
  if (fill) fill.style.width = pct + '%';
  const title = $('#stepTitle');
  if (title) title.textContent = STEP_TITLES[step] || ('Paso ' + step);
  const pctEl = $('#stepPct');
  if (pctEl) pctEl.textContent = pct + '%';
  $('#stepLabel').textContent = `${step} / 7`;
  if (step === 7) renderSummary();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function validateStep(step) {
  if (step === 1) return validateStep1();
  if (step === 2) return validateStep2();
  if (step === 3) return validateStep3();
  if (step === 6) return validateStep6();
  return true;
}

function validateStep1() {
  const req = ['pi_student_name', 'pi_birth_date', 'pi_gender', 'pi_school_year', 'pi_level', 'pi_schedule'];
  let ok = true;
  req.forEach(id => {
    const el = document.getElementById(id);
    const bad = !el || !String(el.value || '').trim();
    el?.classList.toggle('invalid', bad);
    const err = el?.nextElementSibling;
    if (err && err.classList.contains('err-msg')) err.style.display = bad ? 'block' : 'none';
    if (bad) ok = false;
  });
  return ok;
}

function validateStep2() {
  const req = ['pi_p1_name', 'pi_p1_relationship', 'pi_p1_cedula', 'pi_p1_phone', 'pi_p1_email', 'pi_p1_address'];
  let ok = true;
  req.forEach(id => {
    const el = document.getElementById(id);
    const bad = !el || !String(el.value || '').trim();
    el?.classList.toggle('invalid', bad);
    const err = el?.nextElementSibling;
    if (err && err.classList.contains('err-msg')) err.style.display = bad ? 'block' : 'none';
    if (bad) ok = false;
  });
  const p2NameEl = document.getElementById('pi_p2_name');
  const p2Filled = p2NameEl && String(p2NameEl.value || '').trim();
  if (p2Filled) {
    ['pi_p2_relationship', 'pi_p2_cedula', 'pi_p2_phone', 'pi_p2_email'].forEach(id => {
      const el = document.getElementById(id);
      const bad = !el || !String(el.value || '').trim();
      el?.classList.toggle('invalid', bad);
      const err = el?.nextElementSibling;
      if (err && err.classList.contains('err-msg')) err.style.display = bad ? 'block' : 'none';
      if (bad) ok = false;
    });
  }
  ['pi_p1_cedula', 'pi_p2_cedula'].forEach(id => {
    const el = document.getElementById(id);
    if (el && String(el.value || '').trim() && !validateCedula(el.value)) {
      el.classList.add('invalid');
      if (el.nextElementSibling?.classList.contains('err-msg')) {
        el.nextElementSibling.textContent = 'Cédula inválida (módulo 10 no coincide).';
        el.nextElementSibling.style.display = 'block';
      }
      ok = false;
    }
  });
  ['pi_p1_email', 'pi_p2_email'].forEach(id => {
    const el = document.getElementById(id);
    if (el && String(el.value || '').trim() && !isEmail(el.value)) {
      el.classList.add('invalid');
      if (el.nextElementSibling?.classList.contains('err-msg')) el.nextElementSibling.style.display = 'block';
      ok = false;
    }
  });
  return ok;
}

function validateStep3() {
  const req = ['pi_emg_name', 'pi_emg_relationship', 'pi_emg_cedula', 'pi_emg_phone'];
  let ok = true;
  req.forEach(id => {
    const el = document.getElementById(id);
    const bad = !el || !String(el.value || '').trim();
    el?.classList.toggle('invalid', bad);
    const err = el?.nextElementSibling;
    if (err && err.classList.contains('err-msg')) err.style.display = bad ? 'block' : 'none';
    if (bad) ok = false;
  });
  const emgCed = document.getElementById('pi_emg_cedula');
  if (emgCed && String(emgCed.value || '').trim() && !validateCedula(emgCed.value)) {
    emgCed.classList.add('invalid');
    if (emgCed.nextElementSibling?.classList.contains('err-msg')) emgCed.nextElementSibling.style.display = 'block';
    ok = false;
  }
  return ok;
}

function validateStep6() {
  const boxes = ['pi_auth_data', 'pi_auth_correct', 'pi_auth_contact', 'pi_auth_regulations'];
  const allChecked = boxes.every(id => document.getElementById(id)?.checked);
  $('#pi_auth_error').style.display = allChecked ? 'none' : 'block';
  if (!allChecked) return false;
  if (!STATE.signature) {
    $('#pi_signature_status').textContent = '⚠ Firma requerida';
    return false;
  }
  $('#pi_signature_status').textContent = '✓ Firma capturada';
  return true;
}

function wireMasks() {
  document.querySelectorAll('[data-cedula]').forEach(el => {
    el.addEventListener('input', () => {
      const clean = digitsOf(el.value);
      el.value = maskCedula(el.value);
      el.classList.remove('invalid');
      const err = el.nextElementSibling;
      if (err && err.classList.contains('err-msg')) { err.textContent = 'Cédula inválida (verifica los 11 dígitos).'; err.style.display = 'none'; }
      if (clean.length === 11) {
        const ok = validateCedula(clean);
        el.classList.toggle('invalid', !ok);
        if (!ok && err && err.classList.contains('err-msg')) {
          err.textContent = 'Cédula inválida (módulo 10 no coincide).';
          err.style.display = 'block';
        }
      }
    });
  });
  document.querySelectorAll('[data-phone]').forEach(el => {
    el.addEventListener('input', () => { el.value = maskPhone(el.value); });
  });
  document.querySelectorAll('.field').forEach(el => {
    el.addEventListener('input', () => { el.classList.remove('invalid'); if (el.nextElementSibling?.classList.contains('err-msg')) el.nextElementSibling.style.display = 'none'; });
    el.addEventListener('change', () => { el.classList.remove('invalid'); if (el.nextElementSibling?.classList.contains('err-msg')) el.nextElementSibling.style.display = 'none'; });
  });
}

function wireAge() {
  $('#pi_birth_date')?.addEventListener('change', () => {
    $('#pi_calculated_age').value = computeAge($('#pi_birth_date').value);
  });
}

function wireSiblings() {
  $$('.chip[data-sib]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.chip[data-sib]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = btn.dataset.sib === 'true';
      $('#pi_sibling_wrap').classList.toggle('hidden', !val);
    });
  });
}

function renderAuthorized() {
  const list = $('#pi_authorized_list');
  if (!list) return;
  list.innerHTML = STATE.authorized.map((p, i) => `
    <div class="flex flex-col md:flex-row gap-3 bg-slate-50 border border-slate-100 rounded-2xl p-3 items-start md:items-center" data-idx="${i}">
      <input class="field flex-1" placeholder="Nombre completo" value="${esc(p.name)}" data-au="name">
      <input class="field md:w-40" placeholder="Parentesco" value="${esc(p.relationship)}" data-au="relationship">
      <input class="field md:w-44" placeholder="Teléfono" maxlength="12" value="${esc(p.phone)}" data-au="phone">
      <button onclick="window.Preinscripcion.removeAuthorized(${i})" class="px-3 py-2.5 bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white rounded-xl transition-all" title="Quitar">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
      </button>
    </div>`).join('');
  list.querySelectorAll('[data-au]').forEach(input => {
    input.addEventListener('input', (e) => {
      const row = e.target.closest('[data-idx]');
      const idx = Number(row.dataset.idx);
      STATE.authorized[idx][e.target.dataset.au] = e.target.value;
    });
  });
  list.querySelectorAll('[data-au="phone"]').forEach(el => {
    el.addEventListener('input', () => { el.value = maskPhone(el.value); });
  });
}

function renderDocs() {
  const grid = $('#pi_docs_grid');
  grid.innerHTML = DOC_FIELDS.map(d => {
    const doc = STATE.docs[d.key];
    return `
      <div class="doc-box p-4 relative" id="doc_${d.key}">
        <div class="flex items-center gap-3">
          <div class="doc-thumb bg-slate-100 flex items-center justify-center overflow-hidden shrink-0" id="thumb_${d.key}">
            ${doc ? `<img src="${doc.preview}" class="w-full h-full object-cover">` : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>'}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-black text-slate-700 truncate">${d.label}</p>
            <p class="text-[10px] font-bold text-slate-400" id="sizelabel_${d.key}">${doc ? (doc.size / 1024).toFixed(0) + ' KB' : 'Sin archivo'}</p>
          </div>
          <button type="button" class="text-[10px] font-black uppercase tracking-widest bg-orange-50 text-orange-600 hover:bg-orange-100 px-3 py-2 rounded-xl transition-all" onclick="document.getElementById('fu_${d.key}').click()">
            ${doc ? 'Reemplazar' : 'Subir'}
          </button>
        </div>
        <input type="file" id="fu_${d.key}" accept="image/*" class="hidden" data-dockey="${d.key}">
      </div>`;
  }).join('');

  grid.querySelectorAll('input[type=file]').forEach(input => {
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      const key = input.dataset.dockey;
      if (!file) return;
      const field = DOC_FIELDS.find(d => d.key === key);
      try {
        toast('Comprimiendo imagen…', 'warning');
        const res = await compressImage(file, field.maxW, 500);
        STATE.docs[key] = res;
        renderDocs();
        toast('Documento listo (' + (res.size / 1024).toFixed(0) + ' KB)', 'success');
      } catch (err) {
        toast(err.message || 'Error al procesar la imagen', 'error');
        input.value = '';
      }
    });
  });
}

function wireSignature() {
  const canvas = $('#pi_signature');
  const ctx = canvas.getContext('2d');
  let drawing = false;
  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const pt = e.touches ? e.touches[0] : e;
    return { x: (pt.clientX - rect.left) * scaleX, y: (pt.clientY - rect.top) * scaleY };
  };
  const getSignature = () => {
    const w = canvas.width, h = canvas.height;
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    tctx.fillStyle = '#ffffff';
    tctx.fillRect(0, 0, w, h);
    tctx.drawImage(canvas, 0, 0);
    const data = tctx.getImageData(0, 0, w, h).data;
    let hasInk = false;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] !== 0 && (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200)) { hasInk = true; break; }
    }
    return hasInk ? tmp.toDataURL('image/png') : null;
  };
  const updateSigStatus = () => {
    $('#pi_signature_status').textContent = STATE.signature ? '✓ Firma capturada' : '';
  };
  canvas.addEventListener('mousedown', (e) => { drawing = true; ctx.beginPath(); ctx.moveTo(pos(e).x, pos(e).y); });
  canvas.addEventListener('mousemove', (e) => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
  ['mouseup', 'mouseleave'].forEach(ev => canvas.addEventListener(ev, () => { drawing = false; STATE.signature = getSignature(); updateSigStatus(); }));
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }, { passive: false });
  canvas.addEventListener('touchend', () => { drawing = false; STATE.signature = getSignature(); updateSigStatus(); });
}

function collect() {
  const v = (id) => document.getElementById(id)?.value?.trim() || null;
  const p1 = {
    name: v('pi_p1_name'), relationship: v('pi_p1_relationship'), cedula: digitsOf(v('pi_p1_cedula')),
    phone: digitsOf(v('pi_p1_phone')), whatsapp: digitsOf(v('pi_p1_whatsapp')), email: v('pi_p1_email'),
    address: v('pi_p1_address'), occupation: v('pi_p1_occupation'), profession: v('pi_p1_profession'), workplace: v('pi_p1_workplace')
  };
  const p2 = {
    name: v('pi_p2_name'), relationship: v('pi_p2_relationship'), cedula: digitsOf(v('pi_p2_cedula')),
    phone: digitsOf(v('pi_p2_phone')), whatsapp: digitsOf(v('pi_p2_whatsapp')), email: v('pi_p2_email'),
    address: v('pi_p2_address'), occupation: v('pi_p2_occupation'), profession: v('pi_p2_profession'), workplace: v('pi_p2_workplace')
  };
  return {
    student_name: v('pi_student_name'),
    student_last_name: v('pi_student_last_name'),
    birth_date: v('pi_birth_date'),
    gender: v('pi_gender'),
    nationality: v('pi_nationality') || 'Dominicana',
    school_year_requested: v('pi_school_year'),
    level_requested: v('pi_level'),
    schedule: v('pi_schedule'),
    estimated_entry_date: v('pi_entry_date'),
    has_siblings: !$('#pi_sibling_wrap')?.classList.contains('hidden'),
    sibling_name: v('pi_sibling_name'),
    parent_1: p1,
    parent_2: p2,
    emergency_contact: {
      name: v('pi_emg_name'), relationship: v('pi_emg_relationship'),
      cedula: digitsOf(v('pi_emg_cedula')), phone: digitsOf(v('pi_emg_phone')), observations: v('pi_emg_observations')
    },
    authorized_people: STATE.authorized.map(a => ({ ...a, phone: digitsOf(a.phone) })),
    medical: {
      blood_type: v('pi_blood_type'), allergies: v('pi_allergies'), medical_conditions: v('pi_conditions'),
      medications: v('pi_medications'), food_restrictions: v('pi_food_restrictions'), medical_notes: v('pi_medical_notes')
    },
    consents: {
      data_treatment: $('#pi_auth_data')?.checked,
      correct_info: $('#pi_auth_correct')?.checked,
      contact: $('#pi_auth_contact')?.checked,
      regulations: $('#pi_auth_regulations')?.checked
    },
    contact_email: p1.email,
    contact_phone: p1.phone
  };
}

const block = (title, pairs) => `
  <div class="summary-block">
    <h5>${title}</h5>
    ${pairs.filter(([k]) => k).map(([k, val]) => val ? `<p><b>${k}:</b> ${esc(String(val))}</p>` : '').join('')}
  </div>`;

function renderSummary() {
  const d = collect();
  const docsCount = Object.keys(STATE.docs).length;
  $('#pi_review_summary').innerHTML = [
    block('Datos del niño', [
      ['Nombres', d.student_name], ['Apellidos', d.student_last_name],
      ['Nacimiento', d.birth_date], ['Sexo', d.gender], ['Nacionalidad', d.nationality],
      ['Año escolar', d.school_year_requested], ['Nivel', d.level_requested],
      ['Horario', d.schedule], ['Ingreso estimado', d.estimated_entry_date],
      ['Hermano inscrito', d.sibling_name ? ('Sí · ' + d.sibling_name) : 'No']
    ]),
    block('Padre / Tutor', [
      ['Nombre', d.parent_1.name], ['Parentesco', d.parent_1.relationship],
      ['Cédula', d.parent_1.cedula], ['Teléfono', d.parent_1.phone],
      ['Correo', d.parent_1.email], ['Dirección', d.parent_1.address],
      ['Ocupación', d.parent_1.occupation], ['Profesión', d.parent_1.profession],
      ['Trabajo', d.parent_1.workplace]
    ]),
    block('Madre / Tutora', [
      ['Nombre', d.parent_2.name], ['Parentesco', d.parent_2.relationship],
      ['Cédula', d.parent_2.cedula], ['Teléfono', d.parent_2.phone],
      ['Correo', d.parent_2.email], ['Dirección', d.parent_2.address],
      ['Profesión', d.parent_2.profession]
    ]),
    block('Emergencia', [
      ['Contacto', d.emergency_contact.name], ['Parentesco', d.emergency_contact.relationship],
      ['Cédula', d.emergency_contact.cedula], ['Teléfono', d.emergency_contact.phone],
      ['Instrucciones', d.emergency_contact.observations],
      ['Autorizados', d.authorized_people.map(a => a.name + (a.phone ? ' (' + a.phone + ')' : '')).join(', ')]
    ]),
    block('Salud', [
      ['Sangre', d.medical.blood_type], ['Alergias', d.medical.allergies],
      ['Condiciones', d.medical.medical_conditions], ['Medicamentos', d.medical.medications],
      ['Dieta', d.medical.food_restrictions], ['Observaciones', d.medical.medical_notes]
    ]),
    block('Documentos y firmas', [
      ['Adjuntos', docsCount + ' de ' + DOC_FIELDS.length + ' subidos'],
      ['Firma', STATE.signature ? '✓ Capturada' : 'Pendiente'],
      ['Autorizaciones', Object.values(d.consents).every(Boolean) ? '✓ Todas aceptadas' : 'Pendiente']
    ])
  ].join('');
}

async function submit() {
  if (!validateStep1() || !validateStep2() || !validateStep3() || !validateStep6()) {
    toast('Revisa los pasos pendientes antes de enviar', 'error');
    goTo(1);
    return;
  }
  const btn = $('#pi_submit_btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Enviando…';

  const payload = collect();
  try {
    const { data: rowId, error } = await supabase.rpc('submit_preinscripcion', {
      payload: { ...payload, documents: {}, signature_data: STATE.signature, user_agent: navigator.userAgent.slice(0, 250) }
    });
    if (error) throw error;

    const docs = {};
    const keys = Object.keys(STATE.docs);
    await Promise.all(keys.map(async (key) => {
      const doc = STATE.docs[key];
      const path = `${rowId}/${key}_${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from('preinscripcion-docs')
        .upload(path, doc.blob, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) return;
      const { data } = supabase.storage.from('preinscripcion-docs').getPublicUrl(path);
      docs[key] = data.publicUrl;
    }));
    if (keys.length) {
      try {
        const { error: docsErr } = await supabase.rpc('set_preinscripcion_documents', { p_id: rowId, documents: docs });
        if (docsErr) console.error('set_preinscripcion_documents:', docsErr);
      } catch (e) {
        console.error('set_preinscripcion_documents:', e);
      }
    }

    $('#wizardContainer').classList.add('hidden');
    $('#progressBar').classList.add('hidden');
    $('#pi_success').classList.remove('hidden');
    $('#pi_folio').textContent = 'KP-' + String(rowId).padStart(4, '0');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    toast('Error al enviar: ' + (err.message || err), 'error');
    btn.disabled = false;
    btn.innerHTML = 'Enviar preinscripción';
  }
}

window.Preinscripcion = {
  next() { if (validateStep(STATE.step)) goTo(STATE.step + 1); },
  prev() { if (STATE.step > 1) goTo(STATE.step - 1); },
  addAuthorized() { STATE.authorized.push({ name: '', relationship: '', phone: '' }); renderAuthorized(); },
  removeAuthorized(i) { STATE.authorized.splice(i, 1); renderAuthorized(); },
  clearSignature() {
    const canvas = $('#pi_signature');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    STATE.signature = null;
    $('#pi_signature_status').textContent = '';
  },
  submit
};

document.addEventListener('DOMContentLoaded', () => {
  wireMasks();
  wireAge();
  wireSiblings();
  renderAuthorized();
  renderDocs();
  wireSignature();
  loadDynamicData();
});
