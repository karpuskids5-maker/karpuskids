/**
 * Karpus Kids - PWA Install Detection & Prompt System
 * Proporciona una interfaz profesional para invitar a los usuarios a instalar la app
 * según su dispositivo (Android/iOS) y detecta si ya está instalada.
 */

(function() {
    // 1. Detectar si la app ya está instalada (Standalone Mode)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                        window.navigator.standalone || 
                        document.referrer.includes('android-app://') ||
                        localStorage.getItem('pwa_installed') === 'true';

    if (isStandalone) {
        console.log('Karpus Kids: App ya instalada o en modo standalone.');
        return;
    }

    // 2. Variables de control
    let deferredPrompt;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isAndroid = /Android/.test(navigator.userAgent);
    
    // Si no es móvil, no mostramos el prompt (opcional, pero profesional para este caso)
    if (!isIOS && !isAndroid) return;

    // 3. Crear Estilos Dinámicos para la Animación
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideUp {
            from { transform: translateY(100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        @keyframes bounceIn {
            0% { transform: scale(0.9); opacity: 0; }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); opacity: 1; }
        }
        .pwa-prompt-container {
            position: fixed;
            bottom: 20px;
            left: 20px;
            right: 20px;
            z-index: 9999;
            background: white;
            border-radius: 24px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.2);
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            animation: slideUp 0.6s cubic-bezier(0.23, 1, 0.32, 1) forwards;
            border: 1px solid rgba(14, 165, 233, 0.1);
            max-width: 500px;
            margin: 0 auto;
        }
        .pwa-header {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .pwa-icon {
            width: 56px;
            height: 56px;
            border-radius: 14px;
            background: #0EA5E9;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            box-shadow: 0 8px 16px rgba(14, 165, 233, 0.2);
            flex-shrink: 0;
            overflow: hidden;
        }
        .pwa-icon img {
            width: 100%;
            height: 100%;
            object-cover: cover;
        }
        .pwa-text h3 {
            margin: 0;
            font-size: 18px;
            font-weight: 800;
            color: #1E293B;
            letter-spacing: -0.02em;
        }
        .pwa-text p {
            margin: 4px 0 0;
            font-size: 13px;
            color: #64748B;
            line-height: 1.4;
            font-weight: 500;
        }
        .pwa-actions {
            display: flex;
            gap: 12px;
        }
        .pwa-btn {
            flex: 1;
            padding: 12px;
            border-radius: 14px;
            font-weight: 700;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
            text-align: center;
            border: none;
        }
        .pwa-btn-install {
            background: #0EA5E9;
            color: white;
            box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);
        }
        .pwa-btn-install:active { transform: scale(0.96); }
        .pwa-btn-later {
            background: #F1F5F9;
            color: #64748B;
        }
        .pwa-ios-instructions {
            background: #F8FAFC;
            border-radius: 16px;
            padding: 12px;
            font-size: 13px;
            color: #334155;
            display: flex;
            align-items: center;
            gap: 10px;
            border: 1px dashed #CBD5E1;
        }
        .pwa-close {
            position: absolute;
            top: 12px;
            right: 12px;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: #F1F5F9;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #94A3B8;
            cursor: pointer;
            font-size: 16px;
        }
    `;
    document.head.appendChild(style);

    // 4. Función para crear el Banner
    const createBanner = (type) => {
        // No mostrar si ya se cerró en esta sesión
        if (sessionStorage.getItem('pwa_prompt_dismissed')) return;

        const container = document.createElement('div');
        container.className = 'pwa-prompt-container';
        container.id = 'pwa-install-prompt';

        const content = `
            <div class="pwa-close" id="pwa-close-btn">×</div>
            <div class="pwa-header">
                <div class="pwa-icon">
                    <img src="logo/android-chrome-192x192.png" alt="Karpus Logo" onerror="this.src='img/mundo.jpg'">
                </div>
                <div class="pwa-text">
                    <h3>Instalar Karpus Kids</h3>
                    <p>Accede más rápido, recibe notificaciones y usa la app a pantalla completa.</p>
                </div>
            </div>
            ${type === 'ios' ? `
                <div class="pwa-ios-instructions">
                    <span style="font-size: 20px;">⎋</span>
                    <span>Toca el botón de <strong>Compartir</strong> y luego selecciona <strong>"Añadir a la pantalla de inicio"</strong>.</span>
                </div>
                <button class="pwa-btn pwa-btn-later" id="pwa-later-btn">Entendido</button>
            ` : `
                <div class="pwa-actions">
                    <button class="pwa-btn pwa-btn-later" id="pwa-later-btn">Ahora no</button>
                    <button class="pwa-btn pwa-btn-install" id="pwa-install-btn">Instalar App</button>
                </div>
            `}
        `;

        container.innerHTML = content;
        document.body.appendChild(container);

        // Eventos
        document.getElementById('pwa-close-btn').onclick = () => dismissPrompt();
        document.getElementById('pwa-later-btn').onclick = () => dismissPrompt();

        if (type === 'android' && deferredPrompt) {
            document.getElementById('pwa-install-btn').onclick = async () => {
                container.style.opacity = '0.5';
                container.style.pointerEvents = 'none';
                
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                console.log(`Karpus Kids Install: ${outcome}`);
                
                deferredPrompt = null;
                container.remove();
            };
        }
    };

    const dismissPrompt = () => {
        const banner = document.getElementById('pwa-install-prompt');
        if (banner) {
            banner.style.transform = 'translateY(100%)';
            banner.style.opacity = '0';
            setTimeout(() => banner.remove(), 600);
        }
        sessionStorage.setItem('pwa_prompt_dismissed', 'true');
    };

    // 5. Manejar el evento de instalación (Chrome/Android)
    window.addEventListener('beforeinstallprompt', (e) => {
        // Evitar que el navegador muestre su propio prompt
        e.preventDefault();
        // Guardar el evento para dispararlo luego
        deferredPrompt = e;
        
        // Mostrar nuestro banner profesional
        if (isAndroid) {
            createBanner('android');
        }
    });

    // 6. Manejar el caso de iOS (Safari no dispara beforeinstallprompt)
    if (isIOS) {
        // Solo mostrar si es Safari (otros navegadores en iOS no soportan PWA bien)
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isSafari) {
            // Esperar un poco para no ser intrusivo al cargar
            setTimeout(() => createBanner('ios'), 3000);
        }
    }

    // 7. Detectar cuando la instalación fue exitosa
    window.addEventListener('appinstalled', () => {
        console.log('Karpus Kids: Instalada exitosamente.');
        localStorage.setItem('pwa_installed', 'true');
        deferredPrompt = null;
        const banner = document.getElementById('pwa-install-prompt');
        if (banner) banner.remove();
    });
})();
