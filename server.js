const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Хранилища
const users = new Map(); // email -> {password, code2FA, token, avatar, theme}
const messages = []; // [{id, from, to, text, time, type}]
const sessions = new Map(); // token -> email
const online = new Map(); // email -> socket.id

// Отправка email через консоль (для теста)
function sendEmail(to, subject, text) {
    console.log(`\n=== EMAIL to ${to} ===`);
    console.log(`${subject}: ${text}`);
    console.log(`========================\n`);
}

// Регистрация
app.post('/register', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.json({ error: 'Email и пароль обязательны' });
    if (users.has(email)) return res.json({ error: 'Пользователь существует' });
    
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    users.set(email, {
        password: crypto.createHash('sha256').update(password).digest('hex'),
        code2FA: code,
        verified: false,
        token: null,
        avatar: null,
        theme: 'dark'
    });
    
    sendEmail(email, 'Код подтверждения', `Ваш код: ${code}`);
    console.log(`Зареган: ${email}, код: ${code}`);
    res.json({ success: true, message: 'Код отправлен в консоль Render' });
});

// Подтверждение email
app.post('/verify', (req, res) => {
    const { email, code } = req.body;
    const user = users.get(email);
    if (!user) return res.json({ error: 'Пользователь не найден' });
    if (user.code2FA !== code) return res.json({ error: 'Неверный код' });
    
    user.verified = true;
    user.code2FA = null;
    const token = crypto.randomBytes(32).toString('hex');
    user.token = token;
    sessions.set(token, email);
    
    res.json({ success: true, token, email });
});

// Вход через 2FA
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const user = users.get(email);
    if (!user) return res.json({ error: 'Неверный email или пароль' });
    
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    if (user.password !== hash) return res.json({ error: 'Неверный email или пароль' });
    
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    user.code2FA = code;
    sendEmail(email, 'Код 2FA', `Ваш код: ${code}`);
    console.log(`2FA для ${email}: ${code}`);
    res.json({ need2FA: true, email });
});

// Проверка 2FA
app.post('/verify-2fa', (req, res) => {
    const { email, code } = req.body;
    const user = users.get(email);
    if (!user || user.code2FA !== code) return res.json({ error: 'Неверный код' });
    
    user.code2FA = null;
    const token = crypto.randomBytes(32).toString('hex');
    user.token = token;
    sessions.set(token, email);
    
    res.json({ success: true, token, email, avatar: user.avatar, theme: user.theme });
});

// Загрузка аватарки (base64)
app.post('/avatar', (req, res) => {
    const { token, avatar } = req.body;
    const email = sessions.get(token);
    if (!email) return res.json({ error: 'Не авторизован' });
    
    const user = users.get(email);
    user.avatar = avatar;
    res.json({ success: true, avatar });
});

// Смена темы
app.post('/theme', (req, res) => {
    const { token, theme } = req.body;
    const email = sessions.get(token);
    if (!email) return res.json({ error: 'Не авторизован' });
    
    const user = users.get(email);
    user.theme = theme;
    res.json({ success: true, theme });
});

// Получить список пользователей
app.get('/users', (req, res) => {
    const token = req.query.token;
    const email = sessions.get(token);
    if (!email) return res.json({ error: 'Не авторизован' });
    
    const list = [];
    for (const [e, u] of users) {
        if (e !== email) {
            list.push({
                email: e,
                avatar: u.avatar,
                online: online.has(e)
            });
        }
    }
    res.json({ users: list, avatar: users.get(email).avatar, theme: users.get(email).theme });
});

// Получить сообщения с пользователем
app.get('/messages', (req, res) => {
    const { token, with: withUser } = req.query;
    const email = sessions.get(token);
    if (!email) return res.json({ error: 'Не авторизован' });
    
    const msgs = messages.filter(m =>
        (m.from === email && m.to === withUser) ||
        (m.from === withUser && m.to === email)
    );
    res.json({ messages: msgs });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    let currentUser = null;
    
    socket.on('join', (email) => {
        currentUser = email;
        online.set(email, socket.id);
        io.emit('userStatus', { email, online: true });
        console.log(`${email} онлайн`);
    });
    
    socket.on('message', (data) => {
        const { to, text, time } = data;
        const msg = {
            id: Date.now().toString(),
            from: currentUser,
            to,
            text,
            time,
            type: 'text'
        };
        messages.push(msg);
        
        // Отправить получателю
        if (online.has(to)) {
            io.to(online.get(to)).emit('message', msg);
        }
        // Отправить обратно отправителю для подтверждения
        socket.emit('message', msg);
    });
    
    socket.on('typing', (to) => {
        if (online.has(to)) {
            io.to(online.get(to)).emit('typing', currentUser);
        }
    });
    
    socket.on('disconnect', () => {
        if (currentUser) {
            online.delete(currentUser);
            io.emit('userStatus', { email: currentUser, online: false });
            console.log(`${currentUser} офлайн`);
        }
    });
});

// Отдача index.html
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Messages</title>
    <style>
        :root {
            --bg: #000;
            --surface: #1c1c1e;
            --text: #fff;
            --text-secondary: #98989d;
            --bubble-sent: #0a84ff;
            --bubble-received: #262628;
            --bubble-text: #fff;
            --input-bg: #1c1c1e;
            --border: #38383a;
            --nav-bg: #000;
            --status-bar: #000;
        }
        
        .light {
            --bg: #f2f2f7;
            --surface: #fff;
            --text: #000;
            --text-secondary: #8e8e93;
            --bubble-sent: #007aff;
            --bubble-received: #e9e9eb;
            --bubble-text-sent: #fff;
            --bubble-text-received: #000;
            --input-bg: #fff;
            --border: #c6c6c8;
            --nav-bg: #f9f9f9;
            --status-bar: #f9f9f9;
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg);
            color: var(--text);
            height: 100vh;
            overflow: hidden;
            -webkit-tap-highlight-color: transparent;
            -webkit-user-select: none;
            user-select: none;
        }
        
        .screen { display: none; height: 100vh; flex-direction: column; }
        .screen.active { display: flex; }
        
        .nav {
            background: var(--nav-bg);
            padding: 12px 16px;
            text-align: center;
            font-size: 17px;
            font-weight: 600;
            border-bottom: 1px solid var(--border);
            position: relative;
            letter-spacing: -0.2px;
        }
        
        .nav-back {
            position: absolute;
            left: 8px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: #0a84ff;
            font-size: 17px;
            cursor: pointer;
            padding: 8px;
        }
        
        .container { flex: 1; overflow-y: auto; padding: 16px; }
        
        /* Login Screen */
        #login-screen { background: var(--bg); }
        #login-screen .container {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            padding: 32px;
        }
        
        .logo {
            font-size: 44px;
            margin-bottom: 8px;
        }
        
        .title {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 4px;
            letter-spacing: -0.5px;
        }
        
        .subtitle {
            color: var(--text-secondary);
            margin-bottom: 32px;
            font-size: 15px;
        }
        
        .input-group {
            width: 100%;
            max-width: 320px;
            margin-bottom: 16px;
        }
        
        .input-group input {
            width: 100%;
            padding: 14px 16px;
            border-radius: 14px;
            border: 1px solid var(--border);
            background: var(--surface);
            color: var(--text);
            font-size: 16px;
            outline: none;
            transition: border 0.2s;
        }
        
        .input-group input:focus {
            border-color: #0a84ff;
        }
        
        .btn {
            width: 100%;
            max-width: 320px;
            padding: 14px;
            border-radius: 14px;
            border: none;
            font-size: 17px;
            font-weight: 600;
            cursor: pointer;
            margin-bottom: 8px;
            transition: opacity 0.2s;
            letter-spacing: -0.2px;
        }
        
        .btn:active { opacity: 0.7; }
        .btn-primary { background: #0a84ff; color: #fff; }
        .btn-secondary { background: var(--surface); color: #0a84ff; border: 1px solid #0a84ff; }
        
        .error { color: #ff453a; font-size: 14px; margin-top: 8px; text-align: center; }
        .success { color: #30d158; font-size: 14px; margin-top: 8px; text-align: center; }
        
        /* Chat List */
        .chat-item {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            cursor: pointer;
            border-radius: 12px;
            transition: background 0.15s;
        }
        
        .chat-item:active { background: var(--surface); }
        
        .avatar {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: #0a84ff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            color: #fff;
            margin-right: 12px;
            flex-shrink: 0;
            overflow: hidden;
        }
        
        .avatar img { width: 100%; height: 100%; object-fit: cover; }
        
        .chat-info { flex: 1; }
        .chat-name { font-weight: 600; font-size: 16px; }
        .chat-last { color: var(--text-secondary); font-size: 14px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        
        .online-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #34c759;
            flex-shrink: 0;
            margin-left: 8px;
        }
        
        /* Chat Screen */
        #chat-screen { background: var(--bg); }
        
        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
        }
        
        .message-row {
            display: flex;
            margin-bottom: 4px;
            max-width: 80%;
        }
        
        .message-row.sent {
            align-self: flex-end;
        }
        
        .message-row.received {
            align-self: flex-start;
        }
        
        .message-bubble {
            padding: 10px 14px;
            border-radius: 18px;
            font-size: 16px;
            line-height: 1.3;
            word-wrap: break-word;
            overflow-wrap: break-word;
            letter-spacing: -0.2px;
        }
        
        .sent .message-bubble {
            background: #0a84ff;
            color: #fff;
            border-bottom-right-radius: 4px;
        }
        
        .received .message-bubble {
            background: var(--bubble-received);
            color: var(--text);
            border-bottom-left-radius: 4px;
        }
        
        .message-time {
            font-size: 11px;
            color: var(--text-secondary);
            margin-top: 2px;
            padding: 0 4px;
        }
        
        .sent .message-time { text-align: right; }
        
        .typing-indicator {
            font-size: 14px;
            color: var(--text-secondary);
            padding: 8px 16px;
            font-style: italic;
        }
        
        .input-bar {
            display: flex;
            padding: 8px 12px;
            background: var(--surface);
            border-top: 1px solid var(--border);
        }
        
        .input-bar input {
            flex: 1;
            padding: 12px 16px;
            border-radius: 22px;
            border: 1px solid var(--border);
            background: var(--input-bg);
            color: var(--text);
            font-size: 16px;
            outline: none;
            margin-right: 8px;
        }
        
        .input-bar button {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: none;
            background: #0a84ff;
            color: #fff;
            font-size: 20px;
            cursor: pointer;
            flex-shrink: 0;
        }
        
        /* Settings */
        #settings-screen { background: var(--bg); }
        
        .settings-section {
            background: var(--surface);
            border-radius: 12px;
            margin-bottom: 24px;
            overflow: hidden;
        }
        
        .settings-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px;
            border-bottom: 1px solid var(--border);
            cursor: pointer;
        }
        
        .settings-item:last-child { border-bottom: none; }
        .settings-item:active { opacity: 0.7; }
        
        .settings-label { font-size: 16px; }
        
        .settings-arrow {
            color: var(--text-secondary);
            font-size: 18px;
        }
        
        .profile-avatar {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: #0a84ff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 36px;
            color: #fff;
            margin: 0 auto 16px;
            overflow: hidden;
        }
        
        .profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
        
        .modal {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 100;
            align-items: center;
            justify-content: center;
        }
        
        .modal.active { display: flex; }
        
        .modal-content {
            background: var(--surface);
            border-radius: 14px;
            padding: 24px;
            width: 90%;
            max-width: 340px;
        }
        
        .modal-title {
            font-size: 17px;
            font-weight: 600;
            text-align: center;
            margin-bottom: 16px;
        }
        
        .theme-option {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 0;
            cursor: pointer;
        }
        
        .theme-circle {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border: 2px solid var(--border);
        }
        
        .theme-circle.dark { background: #1c1c1e; }
        .theme-circle.light { background: #f2f2f7; }
        
        .theme-option input[type="radio"] { display: none; }
        .theme-option input:checked + .theme-circle {
            border-color: #0a84ff;
            box-shadow: 0 0 0 2px #0a84ff40;
        }
    </style>
</head>
<body class="dark">

    <!-- Login Screen -->
    <div id="login-screen" class="screen active">
        <div class="container">
            <div class="logo">💬</div>
            <div class="title">Messages</div>
            <div class="subtitle">Защищённый мессенджер</div>
            <div class="input-group"><input type="email" id="login-email" placeholder="Email"></div>
            <div class="input-group"><input type="password" id="login-password" placeholder="Пароль"></div>
            <button class="btn btn-primary" onclick="login()">Войти</button>
            <button class="btn btn-secondary" onclick="showRegister()">Создать аккаунт</button>
            <div class="error" id="login-error"></div>
            <div class="success" id="login-success"></div>
            
            <!-- 2FA -->
            <div id="2fa-section" style="display:none; width:100%; max-width:320px;">
                <div class="input-group"><input type="text" id="2fa-code" placeholder="Код из email" maxlength="6"></div>
                <button class="btn btn-primary" onclick="verify2FA()">Подтвердить</button>
            </div>
        </div>
    </div>
    
    <!-- Register Screen -->
    <div id="register-screen" class="screen">
        <div class="nav">
            <button class="nav-back" onclick="showLogin()">←</button>
            Регистрация
        </div>
        <div class="container" style="justify-content:center;align-items:center;">
            <div class="input-group"><input type="email" id="reg-email" placeholder="Email"></div>
            <div class="input-group"><input type="password" id="reg-password" placeholder="Пароль"></div>
            <button class="btn btn-primary" onclick="register()">Зарегистрироваться</button>
            <div class="error" id="reg-error"></div>
            <div class="success" id="reg-success"></div>
            
            <div id="verify-section" style="display:none; width:100%; max-width:320px;">
                <div class="input-group"><input type="text" id="verify-code" placeholder="Код подтверждения" maxlength="6"></div>
                <button class="btn btn-primary" onclick="verifyEmail()">Подтвердить email</button>
            </div>
        </div>
    </div>
    
    <!-- Chat List Screen -->
    <div id="chats-screen" class="screen">
        <div class="nav" style="display:flex;justify-content:space-between;align-items:center;">
            <span>Сообщения</span>
            <span style="cursor:pointer;font-size:22px;" onclick="showSettings()">⚙️</span>
        </div>
        <div class="container" id="chats-container"></div>
    </div>
    
    <!-- Chat Screen -->
    <div id="chat-screen" class="screen">
        <div id="chat-nav" class="nav">
            <button class="nav-back" onclick="goBack()">←</button>
            <span id="chat-user-name"></span>
        </div>
        <div class="messages" id="chat-messages"></div>
        <div class="typing-indicator" id="typing-indicator" style="display:none;"></div>
        <div class="input-bar">
            <input type="text" id="message-input" placeholder="Сообщение" onkeypress="onKeyPress(event)">
            <button onclick="sendMessage()">↑</button>
        </div>
    </div>
    
    <!-- Settings Screen -->
    <div id="settings-screen" class="screen">
        <div class="nav">
            <button class="nav-back" onclick="goToChats()">←</button>
            Настройки
        </div>
        <div class="container">
            <div class="profile-avatar" id="settings-avatar" onclick="document.getElementById('avatar-input').click()">👤</div>
            <input type="file" id="avatar-input" accept="image/*" style="display:none;" onchange="changeAvatar(event)">
            <p style="text-align:center;margin-bottom:24px;color:var(--text-secondary);">Нажми на аватар чтобы изменить</p>
            
            <div class="settings-section">
                <div style="padding:14px 16px;border-bottom:1px solid var(--border);">
                    <span style="color:var(--text-secondary);font-size:14px;">Мой email</span>
                    <p id="settings-email" style="font-size:16px;"></p>
                </div>
                <div class="settings-item" onclick="showThemeModal()">
                    <span class="settings-label">Тема</span>
                    <span class="settings-arrow">›</span>
                </div>
                <div class="settings-item" onclick="logout()">
                    <span class="settings-label" style="color:#ff453a;">Выйти</span>
                </div>
            </div>
        </div>
    </div>
    
    <!-- Theme Modal -->
    <div class="modal" id="theme-modal">
        <div class="modal-content">
            <div class="modal-title">Выберите тему</div>
            <label class="theme-option" onclick="setTheme('dark')">
                <span>Тёмная</span>
                <input type="radio" name="theme" value="dark" checked>
                <div class="theme-circle dark"></div>
            </label>
            <label class="theme-option" onclick="setTheme('light')">
                <span>Светлая</span>
                <input type="radio" name="theme" value="light">
                <div class="theme-circle light"></div>
            </label>
            <button class="btn btn-primary" style="margin-top:16px;" onclick="closeThemeModal()">Готово</button>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        // === GLOBALS ===
        const API = '';
        let token = localStorage.getItem('token') || '';
        let currentChat = null;
        let myEmail = localStorage.getItem('email') || '';
        let socket = null;
        let myAvatar = null;
        let myTheme = localStorage.getItem('theme') || 'dark';
        
        document.body.className = myTheme;
        document.querySelector('meta[name=theme-color]')?.setAttribute('content', myTheme === 'dark' ? '#000' : '#f2f2f7');
        
        if (token && myEmail) {
            connectSocket();
            showChats();
        }
        
        // === SOCKET ===
        function connectSocket() {
            socket = io();
            socket.on('connect', () => {
                socket.emit('join', myEmail);
            });
            socket.on('message', (msg) => {
                if (currentChat === msg.from || currentChat === msg.to) {
                    addMessage(msg);
                }
                loadChats();
            });
            socket.on('typing', (user) => {
                if (currentChat === user) {
                    document.getElementById('typing-indicator').style.display = 'block';
                    document.getElementById('typing-indicator').textContent = user + ' печатает...';
                    clearTimeout(window._typingTimeout);
                    window._typingTimeout = setTimeout(() => {
                        document.getElementById('typing-indicator').style.display = 'none';
                    }, 2000);
                }
            });
            socket.on('userStatus', (data) => {
                loadChats();
            });
        }
        
        // === SCREENS ===
        function showScreen(id) {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            document.getElementById(id + '-screen').classList.add('active');
        }
        
        function showLogin() { showScreen('login'); }
        function showRegister() { showScreen('register'); }
        function showChats() { showScreen('chats'); loadChats(); }
        function showSettings() { showScreen('settings'); loadSettings(); }
        function goToChats() { showScreen('chats'); loadChats(); }
        function goBack() { currentChat = null; showChats(); }
        
        // === AUTH ===
        async function register() {
            const email = document.getElementById('reg-email').value.trim();
            const password = document.getElementById('reg-password').value;
            document.getElementById('reg-error').textContent = '';
            document.getElementById('reg-success').textContent = '';
            
            if (!email || !password) {
                document.getElementById('reg-error').textContent = 'Заполни все поля';
                return;
            }
            
            const res = await fetch(API + '/register', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({email, password})
            });
            const data = await res.json();
            
            if (data.error) {
                document.getElementById('reg-error').textContent = data.error;
            } else {
                document.getElementById('reg-success').textContent = data.message;
                document.getElementById('verify-section').style.display = 'block';
            }
        }
        
        async function verifyEmail() {
            const email = document.getElementById('reg-email').value.trim();
            const code = document.getElementById('verify-code').value.trim();
            
            const res = await fetch(API + '/verify', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({email, code})
            });
            const data = await res.json();
            
            if (data.error) {
                document.getElementById('reg-error').textContent = data.error;
            } else {
                token = data.token;
                myEmail = data.email;
                localStorage.setItem('token', token);
                localStorage.setItem('email', myEmail);
                connectSocket();
                showChats();
            }
        }
        
        async function login() {
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;
            document.getElementById('login-error').textContent = '';
            
            if (!email || !password) {
                document.getElementById('login-error').textContent = 'Заполни все поля';
                return;
            }
            
            const res = await fetch(API + '/login', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({email, password})
            });
            const data = await res.json();
            
            if (data.error) {
                document.getElementById('login-error').textContent = data.error;
            } else if (data.need2FA) {
                document.getElementById('2fa-section').style.display = 'block';
                document.getElementById('login-success').textContent = 'Код отправлен в консоль Render';
            }
        }
        
        async function verify2FA() {
            const email = document.getElementById('login-email').value.trim();
            const code = document.getElementById('2fa-code').value.trim();
            
            const res = await fetch(API + '/verify-2fa', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({email, code})
            });
            const data = await res.json();
            
            if (data.error) {
                document.getElementById('login-error').textContent = data.error;
            } else {
                token = data.token;
                myEmail = data.email;
                myAvatar = data.avatar;
                myTheme = data.theme || 'dark';
                document.body.className = myTheme;
                localStorage.setItem('token', token);
                localStorage.setItem('email', myEmail);
                localStorage.setItem('theme', myTheme);
                connectSocket();
                showChats();
            }
        }
        
        function logout() {
            localStorage.clear();
            token = '';
            myEmail = '';
            myAvatar = null;
            if (socket) socket.disconnect();
            socket = null;
            showLogin();
        }
        
        // === CHATS ===
        async function loadChats() {
            if (!token) return;
            const res = await fetch(API + '/users?token=' + token);
            const data = await res.json();
            if (data.error) return;
            
            myAvatar = data.avatar;
            myTheme = data.theme || 'dark';
            document.body.className = myTheme;
            
            const container = document.getElementById('chats-container');
            container.innerHTML = '';
            
            data.users.forEach(user => {
                const div = document.createElement('div');
                div.className = 'chat-item';
                div.onclick = () => openChat(user.email);
                div.innerHTML = \`
                    <div class="avatar">\${user.avatar ? '<img src="'+user.avatar+'">' : '👤'}</div>
                    <div class="chat-info">
                        <div class="chat-name">\${user.email}</div>
                        <div class="chat-last">Нажми чтобы начать чат</div>
                    </div>
                    \${user.online ? '<div class="online-dot"></div>' : ''}
                \`;
                container.appendChild(div);
            });
        }
        
        async function openChat(userEmail) {
            currentChat = userEmail;
            document.getElementById('chat-user-name').textContent = userEmail;
            showScreen('chat');
            
            const res = await fetch(API + '/messages?token=' + token + '&with=' + userEmail);
            const data = await res.json();
            
            const container = document.getElementById('chat-messages');
            container.innerHTML = '';
            data.messages.forEach(addMessage);
            container.scrollTop = container.scrollHeight;
        }
        
        function addMessage(msg) {
            const container = document.getElementById('chat-messages');
            const row = document.createElement('div');
            row.className = 'message-row ' + (msg.from === myEmail ? 'sent' : 'received');
            
            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            bubble.textContent = msg.text;
            
            const time = document.createElement('div');
            time.className = 'message-time';
            time.textContent = new Date(msg.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
            
            row.appendChild(bubble);
            row.appendChild(time);
            container.appendChild(row);
            container.scrollTop = container.scrollHeight;
        }
        
        function sendMessage() {
            const input = document.getElementById('message-input');
            const text = input.value.trim();
            if (!text || !currentChat) return;
            
            const time = Date.now();
            socket.emit('message', { to: currentChat, text, time });
            
            addMessage({ from: myEmail, to: currentChat, text, time });
            input.value = '';
        }
        
        function onKeyPress(e) {
            if (e.key === 'Enter') sendMessage();
        }
        
        // === SETTINGS ===
        function loadSettings() {
            document.getElementById('settings-email').textContent = myEmail;
            if (myAvatar) {
                document.getElementById('settings-avatar').innerHTML = '<img src="'+myAvatar+'">';
            }
        }
        
        function changeAvatar(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (e) => {
                const avatar = e.target.result;
                const res = await fetch(API + '/avatar', {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({token, avatar})
                });
                const data = await res.json();
                if (data.success) {
                    myAvatar = avatar;
                    document.getElementById('settings-avatar').innerHTML = '<img src="'+avatar+'">';
                }
            };
            reader.readAsDataURL(file);
        }
        
        function showThemeModal() {
            document.getElementById('theme-modal').classList.add('active');
            const radios = document.querySelectorAll('input[name=theme]');
            radios.forEach(r => r.checked = (r.value === myTheme));
        }
        
        function closeThemeModal() {
            document.getElementById('theme-modal').classList.remove('active');
        }
        
        async function setTheme(theme) {
            myTheme = theme;
            document.body.className = theme;
            localStorage.setItem('theme', theme);
            
            await fetch(API + '/theme', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({token, theme})
            });
        }
    </script>
</body>
</html>
    `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('✅ Сервер запущен на порту', PORT);
});
