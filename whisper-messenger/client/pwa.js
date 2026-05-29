// PWA Installation and Service Worker Registration
class PWAManager {
    constructor() {
        this.deferredPrompt = null;
        this.init();
    }

    init() {
        // Register service worker
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js')
                    .then(registration => {
                        console.log('SW registered:', registration.scope);
                        
                        // Handle updates
                        registration.addEventListener('updatefound', () => {
                            const newWorker = registration.installing;
                            newWorker.addEventListener('statechange', () => {
                                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    // New content available
                                    this.showUpdateNotification();
                                }
                            });
                        });
                    })
                    .catch(error => {
                        console.error('SW registration failed:', error);
                    });
            });

            // Handle service worker updates
            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!refreshing) {
                    refreshing = true;
                    window.location.reload();
                }
            });
        }

        // Handle install prompt
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            
            // Show install button
            const installBtn = document.getElementById('install-btn');
            if (installBtn) {
                installBtn.classList.remove('hidden');
                installBtn.addEventListener('click', () => this.installApp());
            }
        });

        // Handle successful install
        window.addEventListener('appinstalled', () => {
            console.log('App installed successfully');
            this.deferredPrompt = null;
        });

        // Handle network status
        this.handleNetworkStatus();

        // Handle visibility change (background/foreground)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                // App came to foreground
                this.onAppResume();
            } else {
                // App went to background
                this.onAppPause();
            }
        });
    }

    async installApp() {
        if (!this.deferredPrompt) return;
        
        this.deferredPrompt.prompt();
        const result = await this.deferredPrompt.userChoice;
        
        if (result.outcome === 'accepted') {
            console.log('User accepted the install');
        }
        
        this.deferredPrompt = null;
    }

    showUpdateNotification() {
        const updateBanner = document.createElement('div');
        updateBanner.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--accent);
            color: white;
            padding: 12px 24px;
            border-radius: 25px;
            box-shadow: var(--shadow);
            cursor: pointer;
            z-index: 1001;
            animation: slideUp 0.3s ease;
        `;
        updateBanner.textContent = 'New version available! Tap to update';
        updateBanner.onclick = () => {
            updateBanner.remove();
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ action: 'skipWaiting' });
            }
        };
        
        document.body.appendChild(updateBanner);
        
        setTimeout(() => {
            if (updateBanner.parentNode) {
                updateBanner.remove();
            }
        }, 10000);
    }

    handleNetworkStatus() {
        const updateOnlineStatus = () => {
            const isOnline = navigator.onLine;
            document.body.classList.toggle('offline', !isOnline);
            
            // Dispatch custom event
            window.dispatchEvent(new CustomEvent('connectionChange', {
                detail: { online: isOnline }
            }));
        };

        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);
        updateOnlineStatus();
    }

    onAppResume() {
        // Refresh data when app comes to foreground
        window.dispatchEvent(new CustomEvent('appResume'));
    }

    onAppPause() {
        // Save state when app goes to background
        window.dispatchEvent(new CustomEvent('appPause'));
    }

    // Push notification permission
    async requestNotificationPermission() {
        if (!('Notification' in window)) {
            return 'denied';
        }

        const permission = await Notification.requestPermission();
        return permission;
    }
}

const pwaManager = new PWAManager();
