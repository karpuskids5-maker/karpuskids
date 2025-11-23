// Sistema de asistencia para el panel de maestra
document.addEventListener('DOMContentLoaded', function() {
  // Datos de ejemplo para estudiantes
  const estudiantes = [
    { id: 1, nombre: 'Ana García', estado: 'Ausente', hora: '', notificado: false, padre: 'Juan García', telefono: '555-1234' },
    { id: 2, nombre: 'Carlos Pérez', estado: 'Ausente', hora: '', notificado: false, padre: 'María Pérez', telefono: '555-5678' },
    { id: 3, nombre: 'Sofía Rodríguez', estado: 'Ausente', hora: '', notificado: false, padre: 'Roberto Rodríguez', telefono: '555-9012' },
    { id: 4, nombre: 'Diego Martínez', estado: 'Ausente', hora: '', notificado: false, padre: 'Laura Martínez', telefono: '555-3456' },
    { id: 5, nombre: 'Valentina López', estado: 'Ausente', hora: '', notificado: false, padre: 'Pedro López', telefono: '555-7890' },
    { id: 6, nombre: 'Mateo Sánchez', estado: 'Ausente', hora: '', notificado: false, padre: 'Ana Sánchez', telefono: '555-2345' },
    { id: 7, nombre: 'Isabella Gómez', estado: 'Ausente', hora: '', notificado: false, padre: 'Carlos Gómez', telefono: '555-6789' },
    { id: 8, nombre: 'Santiago Torres', estado: 'Ausente', hora: '', notificado: false, padre: 'Elena Torres', telefono: '555-0123' }
  ];
  
  // Inicializar sistema de asistencia
  function inicializarAsistencia() {
    // Verificar si existe la sección de asistencia
    const seccionAsistencia = document.getElementById('asistencia');
    if (!seccionAsistencia) return;
    
    // Elementos DOM
    const listaAsistencia = document.getElementById('listaAsistencia');
    const fechaAsistencia = document.getElementById('fechaAsistencia');
    const contPresentes = document.getElementById('contPresentes');
    const contAusentes = document.getElementById('contAusentes');
    const contRetardos = document.getElementById('contRetardos');
    const buscarEstudiante = document.getElementById('buscarEstudiante');
    const exportarAsistencia = document.getElementById('exportarAsistencia');
    const notificarTodos = document.getElementById('notificarTodos');
    const modalAsistenciaDetalles = document.getElementById('modalAsistenciaDetalles');
    const detallesAsistenciaContent = document.getElementById('detallesAsistenciaContent');
    const cerrarDetallesAsistencia = document.getElementById('cerrarDetallesAsistencia');
    const modalNotificarPadre = document.getElementById('modalNotificarPadre');
    const nombreEstudianteNotificacion = document.getElementById('nombreEstudianteNotificacion');
    const estadoEstudianteNotificacion = document.getElementById('estadoEstudianteNotificacion');
    const mensajeAdicional = document.getElementById('mensajeAdicional');
    const cerrarNotificarPadre = document.getElementById('cerrarNotificarPadre');
    const enviarNotificacion = document.getElementById('enviarNotificacion');
    
    // Mostrar fecha actual
    const hoy = new Date();
    fechaAsistencia.textContent = hoy.toLocaleDateString('es-ES', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    
    // Función para actualizar contadores
    function actualizarContadores() {
      const presentes = estudiantes.filter(e => e.estado === 'Presente').length;
      const ausentes = estudiantes.filter(e => e.estado === 'Ausente').length;
      const retardos = estudiantes.filter(e => e.estado === 'Retardo').length;
      
      contPresentes.textContent = presentes;
      contAusentes.textContent = ausentes;
      contRetardos.textContent = retardos;
    }
    
    // Función para renderizar la lista de asistencia
    function renderizarAsistencia(filtro = '') {
      listaAsistencia.innerHTML = '';
      
      const estudiantesFiltrados = estudiantes.filter(e => 
        e.nombre.toLowerCase().includes(filtro.toLowerCase())
      );
      
      estudiantesFiltrados.forEach(estudiante => {
        const fila = document.createElement('tr');
        fila.className = 'border-b hover:bg-slate-50';
        
        // Clase para el estado
        let estadoClase = '';
        let estadoIcono = '';
        
        switch(estudiante.estado) {
          case 'Presente':
            estadoClase = 'bg-green-100 text-green-800';
            estadoIcono = 'check';
            break;
          case 'Ausente':
            estadoClase = 'bg-red-100 text-red-800';
            estadoIcono = 'x';
            break;
          case 'Retardo':
            estadoClase = 'bg-yellow-100 text-yellow-800';
            estadoIcono = 'clock';
            break;
        }
        
        fila.innerHTML = `
          <td class="py-2 px-3">${estudiante.nombre}</td>
          <td class="py-2 px-3 text-center">
            <span class="inline-flex items-center gap-1 px-2 py-1 rounded-xl ${estadoClase}">
              <i data-lucide="${estadoIcono}" class="w-3 h-3"></i> ${estudiante.estado}
            </span>
          </td>
          <td class="py-2 px-3 text-center">${estudiante.hora || '-'}</td>
          <td class="py-2 px-3 text-center">
            ${estudiante.notificado 
              ? '<span class="text-green-600"><i data-lucide="check" class="w-4 h-4"></i></span>' 
              : '<span class="text-slate-400">No</span>'}
          </td>
          <td class="py-2 px-3 text-right">
            <div class="flex justify-end gap-1">
              <button class="btn-presente p-1 rounded-full hover:bg-green-100" title="Marcar presente" data-id="${estudiante.id}">
                <i data-lucide="check" class="w-4 h-4 text-green-600"></i>
              </button>
              <button class="btn-ausente p-1 rounded-full hover:bg-red-100" title="Marcar ausente" data-id="${estudiante.id}">
                <i data-lucide="x" class="w-4 h-4 text-red-600"></i>
              </button>
              <button class="btn-retardo p-1 rounded-full hover:bg-yellow-100" title="Marcar retardo" data-id="${estudiante.id}">
                <i data-lucide="clock" class="w-4 h-4 text-yellow-600"></i>
              </button>
              <button class="btn-notificar p-1 rounded-full hover:bg-blue-100" title="Notificar a padre/madre" data-id="${estudiante.id}">
                <i data-lucide="bell" class="w-4 h-4 text-blue-600"></i>
              </button>
              <button class="btn-detalles p-1 rounded-full hover:bg-slate-100" title="Ver detalles" data-id="${estudiante.id}">
                <i data-lucide="info" class="w-4 h-4 text-slate-600"></i>
              </button>
            </div>
          </td>
        `;
        
        listaAsistencia.appendChild(fila);
      });
      
      // Recrear íconos
      lucide.createIcons();
      
      // Añadir event listeners a los botones
      document.querySelectorAll('.btn-presente').forEach(btn => {
        btn.addEventListener('click', function() {
          const id = parseInt(this.getAttribute('data-id'));
          marcarAsistencia(id, 'Presente');
        });
      });
      
      document.querySelectorAll('.btn-ausente').forEach(btn => {
        btn.addEventListener('click', function() {
          const id = parseInt(this.getAttribute('data-id'));
          marcarAsistencia(id, 'Ausente');
        });
      });
      
      document.querySelectorAll('.btn-retardo').forEach(btn => {
        btn.addEventListener('click', function() {
          const id = parseInt(this.getAttribute('data-id'));
          marcarAsistencia(id, 'Retardo');
        });
      });
      
      document.querySelectorAll('.btn-notificar').forEach(btn => {
        btn.addEventListener('click', function() {
          const id = parseInt(this.getAttribute('data-id'));
          abrirModalNotificar(id);
        });
      });
      
      document.querySelectorAll('.btn-detalles').forEach(btn => {
        btn.addEventListener('click', function() {
          const id = parseInt(this.getAttribute('data-id'));
          mostrarDetallesAsistencia(id);
        });
      });
    }
    
    // Función para marcar asistencia
    function marcarAsistencia(id, estado) {
      const estudiante = estudiantes.find(e => e.id === id);
      if (estudiante) {
        const horaActual = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        estudiante.estado = estado;
        estudiante.hora = horaActual;
        
        // Si el estado es "Presente", notificar automáticamente
        if (estado === 'Presente') {
          notificarPadre(id, `Su hijo/a ${estudiante.nombre} ha llegado a la escuela y está presente en el aula.`);
          // Mostrar confirmación visual
          mostrarMensaje(`Asistencia de ${estudiante.nombre} marcada como ${estado}`);
        } else if (estado === 'Ausente') {
          mostrarMensaje(`${estudiante.nombre} marcado como AUSENTE`);
        } else if (estado === 'Retardo') {
          mostrarMensaje(`${estudiante.nombre} marcado con RETARDO a las ${horaActual}`);
        }
        
        renderizarAsistencia(buscarEstudiante.value);
        actualizarContadores();
      }
    }
    
    // Función para mostrar mensajes de confirmación
    function mostrarMensaje(mensaje) {
      const mensajeDiv = document.createElement('div');
      mensajeDiv.className = 'fixed bottom-4 right-4 bg-karpus-blue text-white px-4 py-2 rounded-lg shadow-lg z-50';
      mensajeDiv.textContent = mensaje;
      document.body.appendChild(mensajeDiv);
      
      setTimeout(() => {
        mensajeDiv.classList.add('opacity-0', 'transition-opacity', 'duration-500');
        setTimeout(() => mensajeDiv.remove(), 500);
      }, 3000);
    }
    
    // Función para mostrar detalles de asistencia
    function mostrarDetallesAsistencia(id) {
      const estudiante = estudiantes.find(e => e.id === id);
      if (estudiante) {
        detallesAsistenciaContent.innerHTML = `
          <div class="p-3 bg-slate-50 rounded-xl">
            <h4 class="font-medium">${estudiante.nombre}</h4>
            <div class="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div>
                <p class="text-slate-500">Estado:</p>
                <p class="font-medium">${estudiante.estado}</p>
              </div>
              <div>
                <p class="text-slate-500">Hora:</p>
                <p class="font-medium">${estudiante.hora || 'No registrada'}</p>
              </div>
              <div>
                <p class="text-slate-500">Padre/Madre:</p>
                <p class="font-medium">${estudiante.padre}</p>
              </div>
              <div>
                <p class="text-slate-500">Teléfono:</p>
                <p class="font-medium">${estudiante.telefono}</p>
              </div>
              <div class="col-span-2">
                <p class="text-slate-500">Notificación:</p>
                <p class="font-medium">${estudiante.notificado ? 'Enviada' : 'No enviada'}</p>
              </div>
            </div>
          </div>
        `;
        
        modalAsistenciaDetalles.classList.remove('hidden');
      }
    }
    
    // Función para abrir modal de notificación
    function abrirModalNotificar(id) {
      const estudiante = estudiantes.find(e => e.id === id);
      if (estudiante) {
        nombreEstudianteNotificacion.textContent = estudiante.nombre;
        estadoEstudianteNotificacion.textContent = estudiante.estado;
        mensajeAdicional.value = '';
        
        // Guardar ID del estudiante en el botón de enviar
        enviarNotificacion.setAttribute('data-id', id);
        
        modalNotificarPadre.classList.remove('hidden');
      }
    }
    
    // Función para notificar a padre/madre
    function notificarPadre(id, mensaje = '') {
      const estudiante = estudiantes.find(e => e.id === id);
      if (estudiante) {
        estudiante.notificado = true;
        
        // Aquí iría la lógica para enviar la notificación real
        console.log(`Notificación enviada a ${estudiante.padre} (${estudiante.telefono}): ${mensaje}`);
        
        // Actualizar la interfaz
        renderizarAsistencia(buscarEstudiante.value);
      }
    }
    
    // Función para exportar asistencia
    function exportarReporteAsistencia() {
      const fecha = new Date().toLocaleDateString('es-ES');
      let csv = `Reporte de Asistencia - ${fecha}\n\n`;
      csv += 'Nombre,Estado,Hora,Notificado\n';
      
      estudiantes.forEach(e => {
        csv += `${e.nombre},${e.estado},${e.hora || '-'},${e.notificado ? 'Sí' : 'No'}\n`;
      });
      
      // Crear blob y descargar
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      
      link.setAttribute('href', url);
      link.setAttribute('download', `asistencia_${fecha.replace(/\//g, '-')}.csv`);
      link.style.visibility = 'hidden';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    
    // Función para notificar a todos los padres
  function notificarTodosLosPadres() {
      const presentes = estudiantes.filter(e => e.estado === 'Presente' && !e.notificado);
      
      presentes.forEach(estudiante => {
        notificarPadre(estudiante.id, `Su hijo/a ${estudiante.nombre} está presente en el aula.`);
      });
      
      // Mostrar notificación estilo Teams
      const notificacion = document.createElement('div');
      notificacion.className = 'notification-toast notification-toast-success slide-in';
      notificacion.innerHTML = `
        <i data-lucide="bell-ring" class="text-karpus-green"></i>
        <div>
          <div class="font-semibold">Notificaciones enviadas</div>
          <div>Se han enviado mensajes a los padres de ${presentes.length} alumnos presentes.</div>
        </div>
      `;
      
      document.body.appendChild(notificacion);
      
      // Eliminar después de 3 segundos
      setTimeout(() => {
        notificacion.remove();
      }, 3000);
      
      // Inicializar iconos
      if (window.lucide) {
        lucide.createIcons();
      }
      
      mostrarMensaje(`Se han enviado ${presentes.length} notificaciones a padres de alumnos presentes.`);
    }
    
    // Event Listeners
    buscarEstudiante.addEventListener('input', function() {
      renderizarAsistencia(this.value);
    });
    
    exportarAsistencia.addEventListener('click', exportarReporteAsistencia);
    
    notificarTodos.addEventListener('click', notificarTodosLosPadres);
    
    cerrarDetallesAsistencia.addEventListener('click', function() {
      modalAsistenciaDetalles.classList.add('hidden');
    });
    
    cerrarNotificarPadre.addEventListener('click', function() {
      modalNotificarPadre.classList.add('hidden');
    });
    
    enviarNotificacion.addEventListener('click', function() {
      const id = parseInt(this.getAttribute('data-id'));
      const mensaje = mensajeAdicional.value.trim();
      const estudiante = estudiantes.find(e => e.id === id);
      
      if (estudiante) {
        let mensajeCompleto = `Su hijo/a ${estudiante.nombre} está ${estudiante.estado.toLowerCase()} en el aula.`;
        
        if (mensaje) {
          mensajeCompleto += ` Mensaje adicional: ${mensaje}`;
        }
        
        notificarPadre(id, mensajeCompleto);
        modalNotificarPadre.classList.add('hidden');
      }
    });
    
    // Inicializar
    renderizarAsistencia();
    actualizarContadores();
  }
  
  // Agregar enlace de navegación para asistencia
  function agregarEnlaceAsistencia() {
    const nav = document.querySelector('aside#sidebar nav a[href="#asistencia"]');
    if (!nav) return;
    
    // Verificar si ya existe el enlace
    /* if (document.querySelector('a[href="#asistencia"]')) return;
    
    const enlaceAsistencia = document.createElement('a');
    enlaceAsistencia.setAttribute('href', '#asistencia');
    enlaceAsistencia.innerHTML = `
      <div class="flex items-center gap-2 py-2 px-3 rounded-xl hover:bg-white hover:bg-opacity-60">
        <i data-lucide="check-square" class="w-5 h-5"></i>
        <span class="label">Asistencia</span>
      </div>
    `;
    
    nav.appendChild(enlaceAsistencia);
    lucide.createIcons(); */
  }
  
  // Agregar sección de asistencia al contenido principal
  function agregarSeccionAsistencia() {
    const main = document.querySelector('main');
    if (!main) return;
    
    // Verificar si ya existe la sección
    if (document.getElementById('asistencia')) return;
    
    const seccionAsistencia = document.createElement('div');
    seccionAsistencia.id = 'asistencia';
    seccionAsistencia.className = 'space-y-6 hidden';
    seccionAsistencia.innerHTML = `
      <div class="flex justify-between items-center">
        <h2 class="text-xl font-semibold">Asistencia del Aula</h2>
        <div class="flex gap-2">
          <span id="fechaAsistencia" class="text-sm bg-white px-3 py-1 rounded-xl shadow-sm"></span>
          <button id="exportarAsistencia" class="text-sm bg-karpus-green text-white px-3 py-1 rounded-xl shadow-sm flex items-center gap-1">
            <i data-lucide="download" class="w-4 h-4"></i> Exportar
          </button>
          <button id="notificarTodos" class="text-sm bg-karpus-blue text-white px-3 py-1 rounded-xl shadow-sm flex items-center gap-1">
            <i data-lucide="bell" class="w-4 h-4"></i> Notificar a todos
          </button>
        </div>
      </div>
      
      <div class="bg-white p-4 rounded-3xl shadow-soft">
        <div class="flex justify-between items-center mb-4">
          <div class="flex gap-3">
            <div class="text-sm px-3 py-1 bg-green-100 text-green-800 rounded-xl flex items-center gap-1">
              <i data-lucide="check" class="w-4 h-4"></i>
              <span id="contPresentes">0</span> Presentes
            </div>
            <div class="text-sm px-3 py-1 bg-red-100 text-red-800 rounded-xl flex items-center gap-1">
              <i data-lucide="x" class="w-4 h-4"></i>
              <span id="contAusentes">0</span> Ausentes
            </div>
            <div class="text-sm px-3 py-1 bg-yellow-100 text-yellow-800 rounded-xl flex items-center gap-1">
              <i data-lucide="clock" class="w-4 h-4"></i>
              <span id="contRetardos">0</span> Retardos
            </div>
          </div>
          <div class="relative">
            <input type="text" id="buscarEstudiante" placeholder="Buscar estudiante..." class="text-sm px-3 py-1 border rounded-xl pr-8">
            <i data-lucide="search" class="w-4 h-4 absolute right-2 top-1/2 transform -translate-y-1/2 text-slate-400"></i>
          </div>
        </div>
        
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b">
                <th class="text-left py-2 px-3 font-medium">Estudiante</th>
                <th class="text-center py-2 px-3 font-medium">Estado</th>
                <th class="text-center py-2 px-3 font-medium">Hora</th>
                <th class="text-center py-2 px-3 font-medium">Notificado</th>
                <th class="text-right py-2 px-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody id="listaAsistencia">
              <!-- Contenido dinámico de la lista de asistencia -->
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    main.appendChild(seccionAsistencia);
    lucide.createIcons();
  }
  
  // Agregar modales necesarios
  function agregarModales() {
    const body = document.body;
    
    // Verificar si ya existen los modales
    if (document.getElementById('modalAsistenciaDetalles')) return;
    
    // Modal para detalles de asistencia
    const modalDetalles = document.createElement('div');
    modalDetalles.id = 'modalAsistenciaDetalles';
    modalDetalles.className = 'hidden fixed inset-0 bg-black/40 flex items-center justify-center z-50';
    modalDetalles.innerHTML = `
      <div class="bg-white rounded-3xl p-4 w-96 max-w-full">
        <h3 class="text-sm font-semibold mb-2">Detalles de Asistencia</h3>
        <div id="detallesAsistenciaContent" class="space-y-2 max-h-80 overflow-auto">
          <!-- Contenido dinámico -->
        </div>
        <div class="flex justify-end gap-2 mt-3">
          <button id="cerrarDetallesAsistencia" class="text-sm px-3 py-2 rounded-xl bg-slate-100">Cerrar</button>
        </div>
      </div>
    `;
    
    // Modal para notificar a padres
    const modalNotificar = document.createElement('div');
    modalNotificar.id = 'modalNotificarPadre';
    modalNotificar.className = 'hidden fixed inset-0 bg-black/40 flex items-center justify-center z-50';
    modalNotificar.innerHTML = `
      <div class="bg-white rounded-3xl p-4 w-96 max-w-full">
        <h3 class="text-sm font-semibold mb-2">Notificar a Padre/Madre</h3>
        <div class="mb-3">
          <p class="text-sm mb-2">Enviando notificación a padre/madre de: <span id="nombreEstudianteNotificacion" class="font-medium"></span></p>
          <p class="text-sm mb-2">Estado: <span id="estadoEstudianteNotificacion" class="font-medium"></span></p>
        </div>
        <div class="mb-3">
          <label class="block text-xs text-slate-600 mb-1">Mensaje adicional (opcional)</label>
          <textarea id="mensajeAdicional" class="w-full border rounded-xl p-2 text-sm" rows="3" placeholder="Escriba un mensaje adicional..."></textarea>
        </div>
        <div class="flex justify-end gap-2 mt-3">
          <button id="cerrarNotificarPadre" class="text-sm px-3 py-2 rounded-xl bg-slate-100">Cancelar</button>
          <button id="enviarNotificacion" class="text-sm px-3 py-2 rounded-xl bg-karpus-blue text-white">Enviar Notificación</button>
        </div>
      </div>
    `;
    
    body.appendChild(modalDetalles);
    body.appendChild(modalNotificar);
  }
  
  // Configurar navegación entre secciones
  function configurarNavegacion() {
    document.querySelectorAll('aside#sidebar nav a, aside#sidebar nav button').forEach(link => {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        const targetId = this.getAttribute('href')?.substring(1) || this.dataset.section;
        if (!targetId) return;
        // Ocultar todas las secciones
        document.querySelectorAll('main > div').forEach(section => {
          section.classList.add('hidden');
        });
        
        // Mostrar la sección seleccionada
        const targetSection = document.getElementById(targetId);
        if (targetSection) {
          targetSection.classList.remove('hidden');
        }
        
        // Actualizar clase activa en la navegación
        document.querySelectorAll('aside#sidebar nav a, aside#sidebar nav button').forEach(navLink => {
          navLink.classList.remove('bg-white', 'bg-opacity-60');
          navLink.classList.add('hover:bg-white', 'hover:bg-opacity-60');
        });
        
        this.classList.add('bg-white', 'bg-opacity-60');
        this.classList.remove('hover:bg-white', 'hover:bg-opacity-60');
      });
    });
  }
  
  // Verificar funcionamiento de botones
  function verificarBotones() {
    console.log("Verificando funcionamiento de botones...");
    
    // Asegurar que los botones de asistencia funcionen correctamente
    document.querySelectorAll('.btn-presente, .btn-ausente, .btn-retardo, .btn-notificar, .btn-detalles').forEach(btn => {
      btn.addEventListener('click', function(e) {
        // Prevenir múltiples event listeners
        e.stopPropagation();
      });
    });
    
    // Verificar botones de navegación
    document.querySelectorAll('nav a, nav button').forEach(btn => {
      btn.addEventListener('click', function(e) {
        console.log("Navegación activada: ", this.getAttribute('href') || this.getAttribute('data-section'));
      });
    });
    
    console.log("Verificación de botones completada");
  }
  
  // Inicializar todo el sistema de asistencia
  agregarEnlaceAsistencia();
  agregarSeccionAsistencia();
  agregarModales();
  inicializarAsistencia();
  configurarNavegacion();
  verificarBotones();
});