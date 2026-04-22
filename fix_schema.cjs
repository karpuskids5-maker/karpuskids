const fs = require('fs');
let c = fs.readFileSync('js/asistente/modules/students.js', 'utf8');

// Find the closing div of the payment section and add QR section after it
const paymentEnd = '          </div>\n        </div>\n      </div>\n\n      <div class="bg-white p-4 rounded-b-3xl';

const qrSection = `          </div>
        </div>

        <!-- QR DE ASISTENCIA -->
        <div class="bg-gradient-to-br from-teal-50 to-emerald-50 rounded-2xl border border-teal-100 p-3 space-y-3">
          <p class="text-[10px] font-black text-teal-700 uppercase tracking-widest flex items-center gap-1.5">\\ud83d\\udcf1 C\\u00f3digo QR de Asistencia</p>
          <p class="text-[9px] text-teal-600 font-medium">El QR se genera con la matr\\u00edcula para registrar entrada/salida.</p>
          <div class="flex flex-col items-center gap-3 bg-white p-3 rounded-xl border border-teal-100">
            <div id="asis-qr-container" class="bg-white p-2 rounded-xl border border-slate-100 min-h-[130px] flex items-center justify-center">
              <p class="text-[9px] text-slate-400 font-bold text-center">Genera una matr\\u00edcula<br>para ver el QR</p>
            </div>
            <p id="asis-qr-label" class="text-sm font-black text-slate-700">--</p>
            <div class="flex gap-2 w-full">
              <button type="button" onclick="window._renderStudentQR(document.getElementById('stMatricula')?.value?.trim())"
                class="flex-1 py-2 bg-teal-500 text-white rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-teal-600 transition-all active:scale-95">
                Generar QR
              </button>
              <button type="button" onclick="window._printStudentQRAsistente()"
                class="flex-1 py-2 bg-slate-800 text-white rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-slate-900 transition-all active:scale-95">
                Imprimir
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-white p-4 rounded-b-3xl`;

if (c.includes(paymentEnd)) {
  c = c.replace(paymentEnd, qrSection);
  fs.writeFileSync('js/asistente/modules/students.js', c, 'utf8');
  console.log('Added QR section to asistente students modal');
} else {
  // Try to find the closing pattern
  const idx = c.indexOf('rounded-b-3xl');
  console.log('Pattern not found. rounded-b-3xl at:', idx);
  if (idx > -1) console.log('Context:', JSON.stringify(c.substring(idx - 100, idx + 50)));
}
