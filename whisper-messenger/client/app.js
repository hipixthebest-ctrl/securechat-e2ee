// Whisper Messenger - Main Application
class WhisperApp {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.currentChat = null;
        this.chats = [];
        this.messages = [];
        this.call = null;
        this.replyTo = null;
        this.isLoggedIn = false;
        
        this.init();
    }

    async init() {
        await crypto.initialize();
        this.setupEventListeners();
        this.checkAuth();
    }

    checkAuth() {
        const accessToken = localStorage.getItem('accessToken');
        const refreshToken = localStorage.getItem('refreshToken');
        const user = JSON.parse(localStorage.getItem('user') || 'null');
        
        if (accessToken && user) {
            this.currentUser = user;
            this.connectSocket(accessToken);
            this.showApp();
        } else if (refreshToken) {
            this.refreshAuth();
        } else {
            this.showAuth();
        }
    }

    async refreshAuth() {
        const refreshToken = localStorage.getItem('refreshToken');
        try {
            const response = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });
            
            if (response.ok) {
                const tokens = await response.json();
                localStorage.setItem('accessToken', tokens.accessToken);
                localStorage.setItem('refreshToken', tokens.refreshToken);
                this.checkAuth();
            } else {
                this.logout();
            }
        } catch (error) {
            this.logout();
        }
    }

    setupEventListeners() {
        // Auth forms
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });
        
        document.getElementById('register-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleRegister();
        });

        // Auth switch
        document.getElementById('show-register').addEventListener('click', () => {
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('register-form').classList.remove('hidden');
        });
        
        document.getElementById('show-login').addEventListener('click', () => {
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('login-form').classList.remove('hidden');
        });

        // Message input
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        document.getElementById('send-btn').addEventListener('click', () => {
            this.sendMessage();
        });

        // Typing indicator
        let typingTimer;
        document.getElementById('message-input').addEventListener('input', () => {
            clearTimeout(typingTimer);
            
            if (this.currentChat) {
                this.socket.emit('chat:typing', {
                    chatId: this.currentChat,
                    isTyping: true
                });
                
                typingTimer = setTimeout(() => {
                    this.socket.emit('chat:typing', {
                        chatId: this.currentChat,
                        isTyping: false
                    });
                }, 1000);
            }
        });

        // Search
        document.getElementById('user-search').addEventListener('input', (e) => {
            this.searchUsers(e.target.value);
        });

        // Emoji button
        document.getElementById('emoji-btn').addEventListener('click', () => {
            this.toggleEmojiPicker();
        });

        // Call button
        document.getElementById('call-btn').addEventListener('click', () => {
            this.startCall();
        });

        // Settings
        document.getElementById('settings-btn').addEventListener('click', () => {
            this.toggleSettings();
        });

        // Logout
        document.getElementById('logout-btn').addEventListener('click', () => {
            this.logout();
        });

        // Theme toggle
        document.getElementById('theme-toggle').addEventListener('change', (e) => {
            this.toggleTheme(e.target.checked);
        });

        // Back button (mobile)
        document.getElementById('back-btn').addEventListener('click', () => {
            this.showSidebar();
        });

        // Close settings
        document.getElementById('close-settings').addEventListener('click', () => {
            this.toggleSettings();
        });
    }

    async handleRegister() {
        const username = document.getElementById('reg-username').value;
        const password = document.getElementById('reg-password').value;
        const displayName = document.getElementById('reg-displayname').value;

        document.getElementById('reg-error').textContent = '';
        document.getElementById('reg-error').classList.add('hidden');

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, displayName })
            });

            const data = await response.json();

            if (response.ok) {
                this.saveAuth(data);
                this.currentUser = data.user;
                this.connectSocket(data.accessToken);
                this.showApp();
            } else {
                document.getElementById('reg-error').textContent = data.error;
                document.getElementById('reg-error').classList.remove('hidden');
            }
        } catch (error) {
            document.getElementById('reg-error').textContent = 'Connection failed';
            document.getElementById('reg-error').classList.remove('hidden');
        }
    }

    async handleLogin() {
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;

        document.getElementById('login-error').textContent = '';
        document.getElementById('login-error').classList.add('hidden');

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                this.saveAuth(data);
                this.currentUser = data.user;
                this.connectSocket(data.accessToken);
                this.showApp();
            } else {
                document.getElementById('login-error').textContent = data.error;
                document.getElementById('login-error').classList.remove('hidden');
            }
        } catch (error) {
            document.getElementById('login-error').textContent = 'Connection failed';
            document.getElementById('login-error').classList.remove('hidden');
        }
    }

    saveAuth(data) {
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        localStorage.setItem('user', JSON.stringify(data.user));
    }

    connectSocket(token) {
        if (this.socket) {
            this.socket.disconnect();
        }

        this.socket = io({
            auth: { token },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000
        });

        this.setupSocketListeners();
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.loadChats();
        });

        this.socket.on('message:new', (message) => {
            this.addMessage(message);
            this.updateChatList(message);
        });

        this.socket.on('message:updated', (data) => {
            const msg = this.messages.find(m => m.id === data.messageId);
            if (msg) {
                msg.content = data.content;
                msg.edited = data.edited;
                this.renderMessages();
            }
        });

        this.socket.on('message:deleted', (data) => {
            const msg = this.messages.find(m => m.id === data.messageId);
            if (msg) {
                msg.deleted = true;
                msg.content = 'This message was deleted';
                this.renderMessages();
            }
        });

        this.socket.on('message:reaction', (data) => {
            const msg = this.messages.find(m => m.id === data.messageId);
            if (msg) {
                if (!msg.reactions) msg.reactions = [];
                msg.reactions.push(data.reaction);
                this.renderMessages();
            }
        });

        this.socket.on('message:reaction-removed', (data) => {
            const msg = this.messages.find(m => m.id === data.messageId);
            if (msg && msg.reactions) {
                msg.reactions = msg.reactions.filter(r => 
                    !(r.userId === data.userId && r.emoji === data.emoji)
                );
                this.renderMessages();
            }
        });

        this.socket.on('message:read', () => {
            // Update read receipts
        });

        this.socket.on('chat:typing', (data) => {
            if (this.currentChat === data.chatId) {
                this.showTypingIndicator(data);
            }
        });

        this.socket.on('user:status', (data) => {
            this.updateUserStatus(data);
        });

        // WebRTC signaling
        this.socket.on('
