/**
 * 🧾 Módulo compartido de Facturación PDF
 * Genera la factura de pago (A4) con jsPDF + autotable + QR.
 * Lo usan tanto la Directora como el Panel de Padres para que el
 * documento tenga SIEMPRE el mismo formato oficial.
 */
import { supabase } from './supabase.js';

export const CENTRO = {
  nombre: 'Karpus Kids',
  eslogan: 'Centro Educativo de Estancia Infantil',
  telefono: '829-803-8424',
  whatsapp: '',
  email: 'karpuskids@gmail.com',
  direccion: 'San Cristóbal',
  horario: 'Lun–Vie: 7:00 AM – 6:00 PM',
  rnc: '', // Sin RNC publicado por el momento
  url: 'https://karpuskids.com'
};

export const LOGO_URL = `${window.location.origin}/img/mundo.jpg`;

const VERIFY_BASE = 'https://karpuskids.com/verificar/';

let _libs = null;
let _logoDataUrl = null;

/* ── Carga perezosa de librerías ─────────────────────────────── */

async function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

export async function loadFacturaLibs() {
  if (window.jspdf && window.QRCode) return true;
  if (_libs) return _libs;
  if (!window.jspdf) {
    await loadScript('/js/shared/jspdf.min.js');
    await loadScript('/js/shared/jspdf-autotable.min.js');
  }
  if (!window.QRCode) {
    await loadScript('/js/shared/qrcode.min.js').catch(() => {});
  }
  _libs = (!!window.jspdf) && (!!window.QRCode);
  return _libs;
}

async function loadLogo() {
  if (_logoDataUrl) return _logoDataUrl;
  try {
    _logoDataUrl = await new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(c.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = reject;
      img.src = LOGO_URL;
    });
  } catch (_) { _logoDataUrl = null; }
  return _logoDataUrl;
}

async function generateQR(text) {
  if (!window.QRCode) return null;
  try {
    return await new Promise(resolve => {
      const temp = document.createElement('div');
      temp.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:260px;height:260px;';
      document.body.appendChild(temp);
      try {
        new window.QRCode(temp, {
          text,
          width: 260,
          height: 260,
          colorDark: '#1D4ED8',
          colorLight: '#ffffff',
          correctLevel: window.QRCode.CorrectLevel.H,
        });
        setTimeout(() => {
          const canvas = temp.querySelector('canvas');
          let dataUrl = null;
          if (canvas) dataUrl = canvas.toDataURL('image/png');
          else {
            const img = temp.querySelector('img');
            if (img) dataUrl = img.src;
          }
          document.body.removeChild(temp);
          resolve(dataUrl);
        }, 150);
      } catch (e) {
        document.body.removeChild(temp);
        resolve(null);
      }
    });
  } catch (_) { return null; }
}

/* ── Utilidades ──────────────────────────────────────────────── */

export function fmtRD(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function facturaNo(id) {
  return 'FAC-' + String(id || 0).padStart(6, '0');
}

/** Código de verificación determinista a partir del número de factura. */
export function codigoVerificacion(receiptNo) {
  let hash = 0;
  const src = String(receiptNo || '');
  for (let i = 0; i < src.length; i++) {
    hash = ((hash << 5) - hash + src.charCodeAt(i)) | 0;
  }
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  let n = (hash >>> 0);
  for (let i = 0; i < 4; i++) {
    code = chars[(n >>> 0) % chars.length] + code;
    n = (n / chars.length) | 0;
  }
  return 'KK-' + src + '-' + code;
}

export function stateLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'paid' || s === 'pagado' || s === 'approved') return 'PAGADA';
  if (s === 'overdue' || s === 'vencida') return 'VENCIDA';
  if (s === 'cancelled' || s === 'anulada' || s === 'void') return 'ANULADA';
  return 'PENDIENTE';
}

/** Obtiene el período académico activo (nombre). */
export async function getActivePeriodLabel() {
  try {
    const { data } = await supabase.rpc('get_school_year_status');
    if (data?.active_period?.name) return data.active_period.name;
    if (data?.school_year_name) return data.school_year_name;
  } catch (_) {}
  return null;
}

/* ── Construcción del documento ──────────────────────────────── */

/**
 * @param {object} p          cursor de `payments` (con students anidados)
 * @param {object} opts       { amount, tendered, change, month, method, concept,
 *                              dueDate, paidDate, receiptNo, status, subtotal,
 *                              descuento, recargo, period, student, parent }
 * @returns {{doc, data, pdfBase64, blob}}
 */
export async function buildFactura(p, opts = {}) {
  await loadFacturaLibs();

  const st = opts.student || p?.students || {};
  const parent = opts.parent || null;
  const statusLabel = stateLabel(opts.status ?? p?.status);
  const receiptNo = opts.receiptNo || facturaNo(p?.id);
  const verif = codigoVerificacion(receiptNo);

  const amount = Number(opts.amount ?? p?.amount ?? 0);
  const subtotal = Number(opts.subtotal ?? amount);
  const descuento = Number(opts.descuento ?? 0);
  const recargo = Number(opts.recargo ?? 0);
  const total = Number(opts.total ?? (subtotal - descuento + recargo));
  const tendered = Number(opts.tendered ?? total);
  const change = Number(opts.change ?? (tendered > 0 ? Math.max(0, tendered - total) : 0));

  const month = opts.month || p?.month_paid || 'Colegiatura';
  const method = opts.method || p?.method || 'efectivo';
  const concept = opts.concept || p?.concept || 'Mensualidad';

  const today = new Date();
  const paidDate = opts.paidDate ? new Date(opts.paidDate) : today;
  const paidDateStr = paidDate.toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' });
  const dueDate = opts.dueDate
    ? new Date(opts.dueDate + (String(opts.dueDate).length <= 10 ? 'T00:00:00' : '')).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null;

  const approvedBy = opts.approvedBy || 'Administración Karpus Kids';

  const periodLabel = opts.period || (await getActivePeriodLabel()) || month;

  const data = {
    receiptNo,
    verif,
    verifyUrl: VERIFY_BASE + receiptNo,
    statusLabel,
    amount,
    subtotal,
    descuento,
    recargo,
    total,
    tendered,
    change,
    month,
    method,
    concept,
    dueDate,
    paidDateStr,
    periodLabel,
    student: st,
    parent,
    approvedBy
  };

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  const CW = W - M * 2;

  const logo = await loadLogo();
  let y = 0;

  // ── 1) Encabezado con logo + datos del centro ────────────────
  doc.setFillColor(20, 28, 48);
  doc.rect(0, 0, W, 52, 'F');
  // banda decorativa inferior
  doc.setFillColor(251, 146, 60);
  doc.rect(0, 52, W, 1.5, 'F');

  if (logo) {
    try {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(M, 8, 34, 34, 4, 4, 'F');
      doc.addImage(logo, 'JPEG', M + 2, 10, 30, 30);
    } catch (_) {}
  } else {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(M, 8, 34, 34, 4, 4, 'F');
    doc.setTextColor(251, 146, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('K', M + 17, 30, { align: 'center' });
  }

  const tx = M + 42;
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(CENTRO.nombre, tx, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(226, 232, 240);
  doc.text(CENTRO.eslogan, tx, 22);
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text('\u2302 ' + CENTRO.direccion, tx, 29);
  doc.text('\u260E ' + CENTRO.telefono, tx, 34);
  doc.text('\u2709 ' + CENTRO.email, tx, 39);
  if (CENTRO.rnc) doc.text('\u26C5 RNC: ' + CENTRO.rnc, tx, 48.5);

  // ── 2) Tarjeta COMPROBANTE DE PAGO ───────────────────────────
  const carteY = 58;
  const cardH = 30;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.roundedRect(M, carteY, CW, cardH, 4, 4, 'FD');

  let statusColor = [22, 163, 74];
  if (statusLabel === 'VENCIDA') statusColor = [234, 88, 12];
  else if (statusLabel === 'ANULADA') statusColor = [220, 38, 38];
  else if (statusLabel === 'PENDIENTE') statusColor = [234, 179, 8];

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('COMPROBANTE DE PAGO', M + 6, carteY + 10);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Factura No.', M + 6, carteY + 18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(receiptNo, M + 6, carteY + 23.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text('Código: ' + verif, M + 6, carteY + 28);

  // Bloque derecho: emisión y estado
  doc.text('Emitida: ' + paidDateStr, W - M - 6, carteY + 10, { align: 'right' });
  doc.text('Período: ' + periodLabel, W - M - 6, carteY + 15, { align: 'right' });
  doc.setFillColor(statusColor[0], statusColor[1], statusColor[2]);
  const stW = 38;
  doc.roundedRect(W - M - 6 - stW, carteY + 17.5, stW, 9, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(statusLabel, W - M - 6 - stW / 2, carteY + 23.5, { align: 'center' });

  y = carteY + cardH + 10;

  // ── 3) ESTUDIANTE / PADRE separados ─────────────────────────
  const boxH = 30;
  const gw = 4;
  const colW = (CW - gw) / 2;

  // ESTUDIANTE
  doc.setFillColor(244, 246, 250);
  doc.roundedRect(M, y, colW, boxH, 3, 3, 'F');
  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('ESTUDIANTE', M + 5, y + 7);
  const sRows = [
    ['Nombre', [st.name, st.last_name].filter(Boolean).join(' ') || 'Estudiante'],
    ['Matrícula', st.matricula || '—'],
    ['Aula', st.classrooms?.name || 'Sin aula']
  ];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  let sy = y + 11.5;
  for (const [lbl, val] of sRows) {
    doc.setTextColor(100, 116, 139); doc.text(lbl, M + 5, sy);
    doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold');
    doc.text(String(val).slice(0, 40), M + colW / 2 + 2, sy, { maxWidth: colW / 2 - 6 });
    doc.setFont('helvetica', 'normal');
    sy += 4.2;
  }

  // PADRE / TUTOR
  const padX = M + colW + gw;
  doc.setFillColor(244, 246, 250);
  doc.roundedRect(padX, y, colW, boxH, 3, 3, 'F');
  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('PADRE / TUTOR', padX + 5, y + 7);
  const pName = parent?.name || st.p1_name || st.p2_name || '—';
  const pPhone = parent?.phone || st.p1_phone || st.p2_phone || '—';
  const pEmail = st.p1_email || st.p2_email || '—';
  const pRows = [
    ['Nombre', pName],
    ['Teléfono', pPhone],
    ['Correo', pEmail]
  ];
  doc.setFont('helvetica', 'normal');
  let py = y + 12;
  for (const [lbl, val] of pRows) {
    doc.setTextColor(100, 116, 139); doc.text(lbl, padX + 5, py);
    doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold');
    doc.text(String(val).slice(0, 40), padX + colW / 2 + 2, py, { maxWidth: colW / 2 - 6 });
    doc.setFont('helvetica', 'normal');
    py += 6;
  }

  y += boxH + 8;

  // ── 4) Detalle de pago (tabla tipo factura) ──────────────────
  const tH = 30;
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(M, y, CW, tH, 3, 3, 'S');
  // cabecera tabla
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, y, CW, 9, 3, 3, 'F');
  doc.rect(M, y + 4, CW, 5, 'F');
  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  const colHdrs = ['Concepto', 'Período', 'Vencimiento', 'Importe'];
  const colPos = [
    M + 5,                      // Concepto
    M + 5 + CW * 0.30,          // Período
    M + 5 + CW * 0.60,          // Vencimiento
    W - M - 5                   // Importe (derecha)
  ];
  doc.text(colHdrs[0], colPos[0], y + 6.5);
  doc.text(colHdrs[1], colPos[1], y + 6.5);
  doc.text(colHdrs[2], colPos[2], y + 6.5);
  doc.text(colHdrs[3], colPos[3], y + 6.5, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text(concept, colPos[0], y + 18);
  doc.text(month, colPos[1], y + 18);
  doc.text(dueDate || '—', colPos[2], y + 18);
  doc.setFont('helvetica', 'bold');
  doc.text(fmtRD(amount), colPos[3], y + 18, { align: 'right' });
  doc.setFont('helvetica', 'normal');

  y += tH + 6;

  // Totales (subtotal, descuento, recargo, total)
  const totalsX = W - M - 62;
  const tRows = [
    ['Subtotal', subtotal],
    ['Descuento', -descuento],
    ['Recargo', recargo],
    ['Total', total]
  ];
  doc.setFontSize(8.5);
  for (let i = 0; i < tRows.length; i++) {
    const [lbl, val] = tRows[i];
    const isTotal = i === 3;
    doc.setTextColor(100, 116, 139); doc.setFont('helvetica', 'normal');
    if (isTotal) {
      doc.setFillColor(236, 253, 245);
      doc.roundedRect(totalsX - 6, y - 4, W - M - totalsX + 6, 8, 2, 2, 'F');
      doc.setTextColor(22, 163, 74); doc.setFont('helvetica', 'bold');
      doc.text('TOTAL', totalsX, y + 1);
      doc.text(fmtRD(val), W - M, y + 1, { align: 'right' });
      y += 9;
    } else {
      doc.text(lbl, totalsX, y + 1);
      doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold');
      const sign = val < 0 ? '− ' : '';
      doc.text(sign + fmtRD(Math.abs(val)), W - M, y + 1, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      y += 5.5;
    }
  }
  y += 2;

  // ── 5) Información del pago ──────────────────────────────────
  const infoW = CW;
  const infoH = 20;
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(M, y, infoW, infoH, 3, 3, 'S');
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, y, infoW, 8, 3, 3, 'F');
  doc.rect(M, y + 4, infoW, 4, 'F');
  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('INFORMACIÓN DEL PAGO', M + 5, y + 5.5);

  const iCols = [
    ['Método', method.charAt(0).toUpperCase() + method.slice(1)],
    ['Recibido', fmtRD(tendered)],
    ['Cambio', fmtRD(change)],
    ['Total pagado', fmtRD(total)]
  ];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const iStep = infoW / 4;
  for (let i = 0; i < iCols.length; i++) {
    const cx = M + iStep * i + iStep / 2;
    doc.setTextColor(100, 116, 139); doc.text(iCols[i][0], cx, y + 13, { align: 'center' });
    doc.setTextColor(i === 3 ? 22 : 30, i === 3 ? 163 : 41, i === 3 ? 74 : 59);
    doc.setFont('helvetica', 'bold');
    doc.text(iCols[i][1], cx, y + 18, { align: 'center' });
    doc.setFont('helvetica', 'normal');
  }
  y += infoH + 8;

  // ── 8) Firma / recibido + 6 QR ───────────────────────────────
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'bold');
  doc.text('Emitido por:', M, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  doc.text(approvedBy, M + 25, y);
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  const firX = M + 25;
  const firY = y + 4;
  doc.line(firX, firY, firX + 45, firY);
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(6.5);
  doc.text('Firma y Sello', firX + 22.5, firY + 3.5, { align: 'center' });

  // QR a la derecha
  const qrSize = 24;
  const qrX = W - M - qrSize;
  const qrY = y - 2;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(qrX - 3, qrY - 3, qrSize + 6, qrSize + 6, 2, 2, 'FD');
  doc.setFillColor(255, 255, 255);
  const qr = await generateQR(data.verifyUrl);
  if (qr) {
    try { doc.addImage(qr, 'PNG', qrX, qrY, qrSize, qrSize); } catch (_) {}
  }
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.text('Escanear para verificar', qrX - 3 + (qrSize + 6) / 2, qrY + qrSize + 6, { align: 'center' });

  y += 22;

  // ── 7) Código de verificación ────────────────────────────────
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, y, CW, 10, 2, 2, 'F');
  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('Código de verificación:', M + 5, y + 6.5);
  doc.setFont('courier', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(verif, M + 5 + 40, y + 6.5);

  y += 14;

  // ── 9) Pie de página profesional ─────────────────────────────
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(M, y, W - M, y);
  y += 6;
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Gracias por confiar en ' + CENTRO.nombre + '.', W / 2, y, { align: 'center' });
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text('Este documento constituye un comprobante digital de pago generado por nuestro sistema administrativo.', W / 2, y, { align: 'center' });
  y += 4.5;
  doc.text('Para verificar la autenticidad de este comprobante, escanee el código QR.', W / 2, y, { align: 'center' });
  y += 5;
  doc.setFont('courier', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text(receiptNo + ' · ' + verif + ' · ' + paidDateStr, W / 2, y, { align: 'center' });

  const pdfBase64 = doc.output('datauristring').split(',')[1];
  const blob = doc.output('blob');
  return { doc, data, pdfBase64, blob };
}

/** Genera la factura y guarda el PDF (para botón 'Descargar'). */
export async function downloadFactura(p, opts = {}) {
  const { doc, data } = await buildFactura(p, opts);
  doc.save('Factura-' + data.receiptNo + '.pdf');
  return data;
}

/** Genera la factura y abre el diálogo de impresión. */
export async function printFactura(p, opts = {}) {
  const { doc, data } = await buildFactura(p, opts || {});
  doc.autoPrint();
  const url = doc.output('bloburl');
  window.open(url, '_blank');
  return data;
}
