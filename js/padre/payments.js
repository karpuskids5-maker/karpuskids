import { supabase } from '../supabase.js';
import { AppState, TABLES, GlobalCache } from './appState.js';
import { Helpers, escapeHtml, sendEmail } from './helpers.js';

export async function loadPayments() {
  const container = document.getElementById('paymentsList');
  if (!container) return;
  
  container.innerHTML = Helpers.skeleton(3, 'h-20');
  const student = AppState.get('student');
  if (!student) return;

  try {
    let data = GlobalCache.get('payments');
    if (!data) {
      const { data: freshData, error } = await supabase
        .from(TABLES.PAYMENTS)
        .select('*')
        .eq('student_id', student.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      data = freshData || [];
      GlobalCache.set('payments', data, 30000);
    }

    if (!data.length) {
      container.innerHTML = Helpers.emptyState('No hay registros de pagos');
      return;
    }

    container.innerHTML = data.map(p => `
      <div class="bg-white p-4 rounded-xl border border-slate-100 flex justify-between items-center shadow-sm">
        <div>
          <p class="font-bold text-slate-800">${escapeHtml(p.month_paid)}</p>
          <p class="text-xs text-slate-500">${new Date(p.created_at).toLocaleDateString()} • ${escapeHtml(p.method)}</p>
        </div>
        <div class="text-right">
          <p class="font-bold text-slate-900">$${p.amount.toFixed(2)}</p>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
            p.status === 'validado' ? 'bg-emerald-100 text-emerald-700' : 
            p.status === 'pendiente' ? 'bg-amber-100 text-amber-700' : 
            'bg-rose-100 text-rose-700'
          }">${escapeHtml(p.status)}</span>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error pagos:', err);
    container.innerHTML = Helpers.emptyState('Error al cargar pagos');
  }
}

export async function submitPaymentProof(e) {
  e.preventDefault();
  const student = AppState.get('student');
  if (!student) return;
  const file = document.getElementById('paymentFileInput').files[0];
  const amount = parseFloat(document.getElementById('paymentAmount').value || '0');
  const month_paid = document.getElementById('paymentMonth').value.trim();
  const method = document.getElementById('paymentMethod').value;
  
  if (!file || !amount || !month_paid) {
    Helpers.toast('Completa todos los campos', 'error');
    return;
  }
  
  if(file.size > 5 * 1024 * 1024){ 
    Helpers.toast('Archivo demasiado grande (máx 5MB)', 'error'); 
    return; 
  }
  
  const allowed = ['image/jpeg','image/png','image/webp'];
  if(!allowed.includes(file.type)){
    Helpers.toast('Formato no permitido (solo JPG, PNG, WEBP)', 'error');
    return;
  }

  try {
    const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
    const name = `${student.id}_${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('classroom_media').upload(`payments/${name}`, file);
    if (upErr) throw upErr;
    
    const { data } = await supabase.storage.from('classroom_media').createSignedUrl(`payments/${name}`, 31536000);
    
    const { error } = await supabase.from(TABLES.PAYMENTS).insert({
      student_id: student.id,
      amount,
      month_paid,
      method,
      proof_url: data?.signedUrl,
      status: 'pendiente'
    });
    
    if (error) throw error;
    
    Helpers.toast('Comprobante enviado', 'success');
    await notifyPaymentSubmittedEmail(student, amount, month_paid, method);
    loadPayments();
    document.getElementById('paymentForm').reset();
  } catch (err) {
    console.error(err);
    Helpers.toast('Error enviando comprobante', 'error');
  }
}

async function notifyPaymentSubmittedEmail(student, amount, month_paid, method) {
  try {
    const user = AppState.get('user');
    const profile = AppState.get('profile');
    const safeAmount = Number(amount) || 0; 
    const parentEmail = user && user.email;
    const parentName = profile && profile.name ? profile.name : 'Familia Karpus';
    const studentName = student && student.name ? student.name : '';
    const classroomId = student && student.classroom_id;
    const baseUrl = window.location.origin || '';
    const parentLink = `${baseUrl}/panel_padres.html#payments`;
    const assistantLink = `${baseUrl}/panel_asistente.html`;
    const directorLink = `${baseUrl}/panel_directora.html`;
    const monthLabel = month_paid || '';
    
    if (parentEmail) {
      const subjectParent = `Comprobante de pago recibido (${monthLabel})`;
      const htmlParent = `
        <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#0f172a;">
          <h2 style="color:#16a34a;">Hemos recibido tu comprobante de pago</h2>
          <p>Hola ${escapeHtml(parentName)},</p>
          <p>Registramos un comprobante de pago para ${escapeHtml(studentName || 'tu hija o hijo')}.</p>
          <p><strong>Mes:</strong> ${escapeHtml(monthLabel)}<br><strong>Monto reportado:</strong> $${safeAmount.toFixed(2)}<br><strong>Método:</strong> ${escapeHtml(method)}</p>
          <p>El equipo de Karpus revisará el comprobante y te avisará cuando el pago sea confirmado.</p>
          <p style="margin:24px 0;">
            <a href="${parentLink}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#ffffff;border-radius:999px;text-decoration:none;font-weight:600;">
              Ver estado de mis pagos
            </a>
          </p>
          <p style="font-size:12px;color:#64748b;">Si el botón no funciona, copia y pega esta dirección en tu navegador: ${parentLink}</p>
        </div>
      `;
      const textParent = `Hemos recibido tu comprobante de pago de ${monthLabel} por $${safeAmount.toFixed(2)}. Revisaremos tu pago y podrás ver el estado en tu panel: ${parentLink}`;
      await sendEmail(parentEmail, subjectParent, htmlParent, textParent);
    }
    
    let classroomName = '';
    let teacherEmail = null;
    if (classroomId) {
      const { data: classroom } = await supabase
        .from('classrooms')
        .select('name, teacher_id')
        .eq('id', classroomId)
        .maybeSingle();
      if (classroom) {
        classroomName = classroom.name || '';
        if (classroom.teacher_id) {
          const { data: teacher } = await supabase
            .from('profiles')
            .select('email, name')
            .eq('id', classroom.teacher_id)
            .maybeSingle();
          teacherEmail = teacher && teacher.email ? teacher.email : null;
        }
      }
    }
    
    const { data: staff } = await supabase
      .from('profiles')
      .select('email, role')
      .in('role', ['asistente', 'directora']);
    const assistantEmails = (staff || [])
      .filter(p => p.role === 'asistente' && p.email)
      .map(p => p.email);
    const directorEmails = (staff || [])
      .filter(p => p.role === 'directora' && p.email)
      .map(p => p.email);
    const subjectStaff = `Nuevo comprobante de pago enviado (${monthLabel})`;
    
    const commonHtmlStaff = (roleLabel, link) => `
      <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#0f172a;">
        <h2 style="color:#0f172a;">Nuevo comprobante de pago recibido</h2>
        <p>Se ha registrado un nuevo comprobante de pago${studentName ? ` para ${escapeHtml(studentName)}` : ''}${classroomName ? ` del aula ${escapeHtml(classroomName)}` : ''}.</p>
        <p><strong>Mes:</strong> ${escapeHtml(monthLabel)}<br><strong>Monto reportado:</strong> $${amount.toFixed(2)}<br><strong>Método:</strong> ${escapeHtml(method)}</p>
        <p>Ingresa a tu panel de ${roleLabel} para revisar y validar el pago.</p>
        <p style="margin:24px 0;">
          <a href="${link}" style="display:inline-block;padding:10px 18px;background:#0ea5e9;color:#ffffff;border-radius:999px;text-decoration:none;font-weight:600;">
            Revisar pagos pendientes
          </a>
        </p>
      </div>
    `;
    const textStaff = `Se registró un comprobante de pago${studentName ? ` para ${studentName}` : ''} del mes ${monthLabel} por $${amount.toFixed(2)}. Revisa los pagos pendientes en tu panel.`;
    
    if (teacherEmail) {
      const subjectTeacher = `Tu grupo tiene un nuevo comprobante de pago (${monthLabel})`;
      const htmlTeacher = commonHtmlStaff('maestra', `${baseUrl}/panel-maestra.html`);
      await sendEmail(teacherEmail, subjectTeacher, htmlTeacher, textStaff);
    }
    
    await Promise.all(assistantEmails.map(email => 
      sendEmail(email, subjectStaff, commonHtmlStaff('asistente', assistantLink), textStaff)
    ));
    await Promise.all(directorEmails.map(email => 
      sendEmail(email, subjectStaff, commonHtmlStaff('directora', directorLink), textStaff)
    ));
  } catch (e) {
    console.error('Error enviando correos de comprobante de pago', e);
  }
}

export function initPaymentForm() {
  const form = document.getElementById('paymentForm');
  if (form && !form.dataset.initialized) {
    form.addEventListener('submit', submitPaymentProof);
    form.dataset.initialized = 'true';
  }
}
