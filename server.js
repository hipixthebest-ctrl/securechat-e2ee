const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Хранилища
const users = new Map();
const messages = [];
const sessions = new Map();
const online = new Map();

function sendEmail(to, subject, text) {
    console.log(`\n=== EMAIL to ${to} ===`);
    console.log(`${subject}: ${text}`);
    console.log(`========================\n`);
}

// ========== API ==========
app.post('/register', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.json({ error: 'Email и пароль обязательны' });
    if (users.has(email)) return res.json({ error: 'Пользователь уже существует' });
    
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    users.set(email, {
        password: crypto.createHash('sha256').update(password).digest('hex'),
        code2FA: code, verified: false, token: null,
        avatar: null, theme: 'dark', nickname: email.split('@')[0],
        status: 'Привет! Я в Messages ✌️', fontSize: 'medium',
        sound: true, notifications: true, wallpaper: 'gradient1'
    });
    
    sendEmail(email, 'Код подтверждения', `Ваш код: ${code}`);
    console.log(`📧 Зареган: ${email}, код: ${code}`);
    res.json({ success: true, message: 'Код отправлен в консоль Render (смотри логи)' });
});

app.post('/verify', (req, res) => {
    const { email, code } = req.body;
    const user = users.get(email);
    if (!user || user.code2FA !== code) return res.json({ error: 'Неверный код' });
    
    user.verified = true; user.code2FA = null;
    const token = crypto.randomBytes(32).toString('hex');
    user.token = token; sessions.set(token, email);
    
    res.json({ success: true, token, email, user: getUserData(email) });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const user = users.get(email);
    if (!user || user.password !== crypto.createHash('sha256').update(password).digest('hex')) 
        return res.json({ error: 'Неверный email или пароль' });
    
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    user.code2FA = code;
    sendEmail(email, 'Код 2FA', `Ваш код: ${code}`);
    console.log(`🔐 2FA для ${email}: ${code}`);
    res.json({ need2FA: true, email });
});

app.post('/verify-2fa', (req, res) => {
    const { email, code } = req.body;
    const user = users.get(email);
    if (!user || user.code2FA !== code) return res.json({ error: 'Неверный код' });
    
    user.code2FA = null;
    const token = crypto.randomBytes(32).toString('hex');
    user.token = token; sessions.set(token, email);
    
    res.json({ success: true, token, email, user: getUserData(email) });
});

app.post('/update-profile', (req, res) => {
    const { token, nickname, status, avatar, theme, fontSize, sound, notifications, wallpaper } = req.body;
    const email = sessions.get(token);
    if (!email) return res.json({ error: 'Не авторизован' });
    
    const user = users.get(email);
    if (nickname !== undefined) user.nickname = nickname;
    if (status !== undefined) user.status = status;
    if (avatar !== undefined) user.avatar = avatar;
    if (theme !== undefined) user.theme = theme;
    if (fontSize !== undefined) user.fontSize = fontSize;
    if (sound !== undefined) user.sound = sound;
    if (notifications !== undefined) user.notifications = notifications;
    if (wallpaper !== undefined) user.wallpaper = wallpaper;
    
    res.json({ success: true, user: getUserData(email) });
});

app.get('/find-user', (req, res) => {
    const { token, email: searchEmail } = req.query;
    const myEmail = sessions.get(token);
    if (!myEmail) return res.json({ error: 'Не авторизован' });
    if (searchEmail === myEmail) return res.json({ error: 'Это вы' });
    
    const user = users.get(searchEmail);
    if (!user || !user.verified) return res.json({ error: 'Пользователь не найден' });
    
    res.json({ found: true, email: searchEmail, nickname: user.nickname, avatar: user.avatar, status: user.status, online: online.has(searchEmail) });
});

app.get('/contacts', (req, res) => {
    const token = req.query.token;
    const email = sessions.get(token);
    if (!email) return res.json({ error: 'Не авторизован' });
    
    const contactsWithMessages = new Set();
    messages.forEach(m => {
        if (m.from === email) contactsWithMessages.add(m.to);
        if (m.to === email) contactsWithMessages.add(m.from);
    });
    
    const list = [];
    for (const [e, u] of users) {
        if (e !== email && u.verified && contactsWithMessages.has(e)) {
            list.push({
                email: e, nickname: u.nickname, avatar: u.avatar,
                status: u.status, online: online.has(e)
            });
        }
    }
    
    res.json({ contacts: list, myProfile: getUserData(email) });
});

app.get('/messages', (req, res) => {
    const { token, with: withUser } = req.query;
    const email = sessions.get(token);
    if (!email) return res.json({ error: 'Не авторизован' });
    
    const msgs = messages.filter(m =>
        (m.from === email && m.to === withUser) || (m.from === withUser && m.to === email)
    );
    const withUserData = users.get(withUser);
    res.json({ 
        messages: msgs, 
        chatUser: withUserData ? {
            email: withUser, nickname: withUserData.nickname,
            avatar: withUserData.avatar, status: withUserData.status,
            online: online.has(withUser)
        } : null
    });
});

function getUserData(email) {
    const u = users.get(email);
    if (!u) return null;
    return {
        email, avatar: u.avatar, theme: u.theme, nickname: u.nickname,
        status: u.status, fontSize: u.fontSize, sound: u.sound,
        notifications: u.notifications, wallpaper: u.wallpaper
    };
}

// ========== SOCKET ==========
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    let currentUser = null;
    
    socket.on('join', (email) => {
        currentUser = email;
        online.set(email, socket.id);
        io.emit('userStatus', { email, online: true });
        console.log(`🟢 ${email} онлайн`);
    });
    
    socket.on('message', (data) => {
        const { to, text, time, type } = data;
        const msg = {
            id: crypto.randomBytes(8).toString('hex'),
            from: currentUser, to, text,
            time: time || Date.now(), type: type || 'text'
        };
        messages.push(msg);
        
        if (online.has(to)) io.to(online.get(to)).emit('message', msg);
        socket.emit('message', msg);
    });
    
    socket.on('typing', (to) => {
        if (online.has(to)) {
            io.to(online.get(to)).emit('typing', {
                user: currentUser,
                nickname: users.get(currentUser)?.nickname || currentUser
            });
        }
    });
    
    socket.on('disconnect', () => {
        if (currentUser) {
            online.delete(currentUser);
            io.emit('userStatus', { email: currentUser, online: false });
            console.log(`🔴 ${currentUser} офлайн`);
        }
    });
});

// ========== HTML ==========
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta name="theme-color" content="#000000">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black">
    <title>Messages</title>
    <style>
        :root{--bg:#000;--surface:#1c1c1e;--surface2:#2c2c2e;--text:#fff;--text-secondary:#98989d;--bubble-sent:#0a84ff;--bubble-received:#1c1c1e;--input-bg:#1c1c1e;--border:#38383a;--nav-bg:rgba(0,0,0,0.8);--success:#30d158;--danger:#ff453a;--wallpaper:linear-gradient(135deg,#1a1a2e,#16213e);--fs:1;}
        .light{--bg:#f2f2f7;--surface:#fff;--surface2:#e8e8ed;--text:#000;--text-secondary:#8e8e93;--bubble-sent:#007aff;--bubble-received:#e9e9eb;--input-bg:#fff;--border:#c6c6c8;--nav-bg:rgba(249,249,249,0.9);}
        .wallpaper-gradient1{--wallpaper:linear-gradient(135deg,#1a1a2e,#16213e)}
        .wallpaper-gradient2{--wallpaper:linear-gradient(135deg,#0f2027,#2c5364)}
        .wallpaper-space{--wallpaper:linear-gradient(135deg,#0c0c1d,#1a1a3e)}
        .wallpaper-sunset{--wallpaper:linear-gradient(135deg,#ff512f,#dd2476)}
        .wallpaper-ocean{--wallpaper:linear-gradient(135deg,#2193b0,#6dd5ed)}
        .light.wallpaper-gradient1{--wallpaper:linear-gradient(135deg,#f5f7fa,#c3cfe2)}
        .light.wallpaper-gradient2{--wallpaper:linear-gradient(135deg,#e0f7fa,#b2ebf2)}
        .light.wallpaper-space{--wallpaper:linear-gradient(135deg,#e8eaf6,#c5cae9)}
        .light.wallpaper-sunset{--wallpaper:linear-gradient(135deg,#ffe0b2,#ffccbc)}
        .light.wallpaper-ocean{--wallpaper:linear-gradient(135deg,#e0f7fa,#b2ebf2)}
        .font-small{--fs:0.9}.font-medium{--fs:1}.font-large{--fs:1.15}.font-xlarge{--fs:1.3}
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro','Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);height:100vh;height:100dvh;overflow:hidden;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;font-size:calc(16px * var(--fs))}
        .screen{display:none;height:100vh;height:100dvh;flex-direction:column;position:absolute;top:0;left:0;right:0;bottom:0;background:var(--bg)}
        .screen.active{display:flex}
        .nav{background:var(--nav-bg);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);padding:12px 16px;text-align:center;font-size:calc(17px * var(--fs));font-weight:600;border-bottom:0.5px solid var(--border);position:relative;z-index:10}
        .nav-back{position:absolute;left:4px;top:50%;transform:translateY(-50%);background:0;border:0;color:#0a84ff;font-size:calc(17px * var(--fs));cursor:pointer;padding:8px 12px}
        .container{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
        /* LOGIN */
        #login-screen{justify-content:center}#login-screen .container{display:flex;flex-direction:column;justify-content:center;align-items:center;padding:32px}
        .logo{font-size:56px;margin-bottom:8px;animation:float 3s ease-in-out infinite}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
        .title{font-size:calc(32px * var(--fs));font-weight:700;margin-bottom:4px;letter-spacing:-0.5px}
        .subtitle{color:var(--text-secondary);margin-bottom:32px;font-size:calc(15px * var(--fs))}
        .input-group{width:100%;max-width:340px;margin-bottom:12px}
        .input-group input{width:100%;padding:14px 16px;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:calc(16px * var(--fs));outline:0;transition:all 0.2s}
        .input-group input:focus{border-color:#0a84ff;box-shadow:0 0 0 3px rgba(10,132,255,0.2)}
        .btn{width:100%;max-width:340px;padding:14px;border-radius:12px;border:0;font-size:calc(17px * var(--fs));font-weight:600;cursor:pointer;margin-bottom:8px;transition:all 0.2s;letter-spacing:-0.2px}
        .btn:active{transform:scale(0.97);opacity:0.8}.btn-primary{background:#0a84ff;color:#fff}.btn-secondary{background:var(--surface);color:#0a84ff;border:1px solid #0a84ff}
        .error{color:var(--danger);font-size:calc(14px * var(--fs));margin-top:8px;text-align:center;min-height:20px}.success{color:var(--success);font-size:calc(14px * var(--fs));margin-top:4px;text-align:center}
        /* CHATS */
        .chat-item{display:flex;align-items:center;padding:10px 16px;cursor:pointer;transition:background 0.1s;position:relative}.chat-item:active{background:var(--surface)}
        .avatar{width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg,#0a84ff,#5e5ce6);display:flex;align-items:center;justify-content:center;font-size:22px;color:#fff;margin-right:12px;flex-shrink:0;overflow:hidden;position:relative}
        .avatar img{width:100%;height:100%;object-fit:cover}.chat-info{flex:1;min-width:0}
        .chat-name{font-weight:600;font-size:calc(16px * var(--fs))}
        .chat-preview{color:var(--text-secondary);font-size:calc(14px * var(--fs));margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .online-dot{width:10px;height:10px;border-radius:50%;background:var(--success);position:absolute;bottom:2px;right:2px;border:2px solid var(--bg)}
        .chat-time{font-size:calc(12px * var(--fs));color:var(--text-secondary);flex-shrink:0;margin-left:8px}
        .fab{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:#0a84ff;color:#fff;border:0;font-size:28px;cursor:pointer;box-shadow:0 4px 12px rgba(10,132,255,0.4);z-index:50;display:flex;align-items:center;justify-content:center;transition:all 0.2s}.fab:active{transform:scale(0.9)}
        .empty-state{text-align:center;padding:60px 32px;color:var(--text-secondary)}
        .empty-state .icon{font-size:48px;margin-bottom:16px}
        .empty-state p{font-size:calc(16px * var(--fs));margin-bottom:8px}
        /* CHAT */
        .messages{flex:1;overflow-y:auto;padding:8px 4px;display:flex;flex-direction:column;gap:2px;-webkit-overflow-scrolling:touch}
        .message-row{display:flex;flex-direction:column;margin:1px 8px;max-width:80%;animation:msgIn 0.3s ease-out}@keyframes msgIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .message-row.sent{align-self:flex-end;align-items:flex-end}.message-row.received{align-self:flex-start;align-items:flex-start}
        .message-bubble{padding:8px 12px;border-radius:18px;font-size:calc(16px * var(--fs));line-height:1.35;word-wrap:break-word;letter-spacing:-0.2px;position:relative}
        .sent .message-bubble{background:var(--bubble-sent);color:#fff;border-bottom-right-radius:4px}.received .message-bubble{background:var(--bubble-received);color:var(--text);border-bottom-left-radius:4px}
        .message-bubble.heart,.message-bubble.like,.message-bubble.fire,.message-bubble.rocket{font-size:44px;padding:2px 8px;background:0!important}
        .message-time{font-size:calc(11px * var(--fs));color:var(--text-secondary);margin-top:1px;padding:0 4px}
        .typing-indicator{font-size:calc(13px * var(--fs));color:var(--text-secondary);padding:6px 16px;display:flex;align-items:center;gap:4px}
        .typing-dots{display:flex;gap:3px}.typing-dots span{width:6px;height:6px;border-radius:50%;background:var(--text-secondary);animation:dotBounce 1.4s infinite}.typing-dots span:nth-child(2){animation-delay:0.2s}.typing-dots span:nth-child(3){animation-delay:0.4s}@keyframes dotBounce{0%,80%,100%{transform:scale(0.8);opacity:0.5}40%{transform:scale(1.2);opacity:1}}
        .input-bar{display:flex;padding:8px 8px calc(8px + env(safe-area-inset-bottom,0px));background:var(--surface);border-top:0.5px solid var(--border);align-items:center;gap:6px}
        .input-bar input{flex:1;padding:10px 16px;border-radius:20px;border:1px solid var(--border);background:var(--input-bg);color:var(--text);font-size:calc(16px * var(--fs));outline:0}.input-bar input:focus{border-color:#0a84ff}
        .icon-btn{width:36px;height:36px;border-radius:50%;border:0;background:0;color:#0a84ff;font-size:20px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all 0.2s}.icon-btn:active{background:var(--surface2);transform:scale(0.9)}.icon-btn.send{background:#0a84ff;color:#fff}
        .effects-bar{display:flex;gap:4px;padding:4px 8px;overflow-x:auto;border-top:0.5px solid var(--border);background:var(--surface)}
        .effect-btn{padding:6px 12px;border-radius:16px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:calc(18px * var(--fs));cursor:pointer;white-space:nowrap;transition:all 0.2s;flex-shrink:0}.effect-btn:active{background:#0a84ff;border-color:#0a84ff;transform:scale(0.95)}
        .header-status{font-size:calc(12px * var(--fs));color:var(--text-secondary);text-align:center;font-weight:400}
        /* SETTINGS */
        .settings-section{background:var(--surface);border-radius:12px;margin:16px;overflow:hidden}
        .settings-section-title{padding:8px 16px 4px;font-size:calc(13px * var(--fs));color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px}
        .settings-item{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:0.5px solid var(--border);cursor:pointer;transition:background 0.1s;gap:12px}.settings-item:last-child{border-bottom:0}.settings-item:active{background:var(--surface2)}
        .settings-label{font-size:calc(16px * var(--fs));flex:1;min-width:0}.settings-value{color:var(--text-secondary);font-size:calc(15px * var(--fs));text-align:right;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.settings-arrow{color:var(--text-secondary);opacity:0.5;flex-shrink:0}
        .toggle{width:51px;height:31px;border-radius:16px;background:#48484a;position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0}.toggle.active{background:var(--success)}
        .toggle::after{content:'';width:27px;height:27px;border-radius:50%;background:#fff;position:absolute;top:2px;left:2px;transition:transform 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3)}.toggle.active::after{transform:translateX(20px)}
        .profile-header{display:flex;flex-direction:column;align-items:center;padding:24px 16px 8px}
        .profile-avatar{width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#0a84ff,#5e5ce6);display:flex;align-items:center;justify-content:center;font-size:36px;color:#fff;margin-bottom:8px;overflow:hidden;cursor:pointer;position:relative}
        .profile-avatar img{width:100%;height:100%;object-fit:cover}
        .profile-avatar-overlay{position:absolute;bottom:-2px;right:-2px;width:28px;height:28px;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid var(--bg)}
        .profile-nickname{font-size:calc(20px * var(--fs));font-weight:600;margin-top:4px}
        .profile-status{color:var(--text-secondary);font-size:calc(14px * var(--fs));margin-top:4px}
        /* MODALS */
        .modal{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:100;align-items:flex-end;justify-content:center}
        .modal.active{display:flex}.modal-content{background:var(--surface);border-radius:14px 14px 0 0;padding:8px 16px 24px;width:100%;max-width:500px;max-height:80vh;overflow-y:auto}
        .modal-handle{width:36px;height:5px;border-radius:3px;background:#48484a;margin:8px auto 16px}
        .modal-title{font-size:calc(17px * var(--fs));font-weight:600;text-align:center;margin-bottom:16px}
        .wallpaper-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
        .wallpaper-option{height:80px;border-radius:12px;cursor:pointer;border:3px solid transparent;transition:all 0.2s;display:flex;align-items:center;justify-content:center;font-size:14px}
        .wallpaper-option.selected{border-color:#0a84ff}.wallpaper-option:active{transform:scale(0.95)}
        .w-gradient1{background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff}.w-gradient2{background:linear-gradient(135deg,#0f2027,#2c5364);color:#fff}.w-space{background:linear-gradient(135deg,#0c0c1d,#1a1a3e);color:#fff}.w-sunset{background:linear-gradient(135deg,#ff512f,#dd2476);color:#fff}.w-ocean{background:linear-gradient(135deg,#2193b0,#6dd5ed);color:#fff}
        .font-size-options{display:flex;justify-content:space-around;padding:16px 0;gap:8px}
        .font-size-btn{padding:10px 16px;border-radius:8px;border:2px solid var(--border);background:0;color:var(--text);cursor:pointer;font-size:calc(14px * var(--fs));transition:all 0.2s;flex:1;text-align:center}
        .font-size-btn.selected{border-color:#0a84ff;color:#0a84ff}
        .close-modal-btn{display:block;width:100%;margin-top:16px;padding:14px;border-radius:12px;background:#0a84ff;color:#fff;border:0;font-size:calc(17px * var(--fs));font-weight:600;cursor:pointer}
        .toast{position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:var(--surface2);color:var(--text);padding:12px 24px;border-radius:24px;font-size:calc(14px * var(--fs));z-index:200;opacity:0;transition:opacity 0.3s;pointer-events:none}.toast.show{opacity:1}
    </style>
</head>
<body class="dark wallpaper-gradient1 font-medium">
    
    <!-- ========== LOGIN SCREEN ========== -->
    <div id="login-screen" class="screen active">
        <div class="container">
            <div class="logo">💬</div>
            <div class="title">Messages</div>
            <div class="subtitle">Защищённый мессенджер</div>
            <div class="input-group"><input type="email" id="login-email" placeholder="Email" autocomplete="email" inputmode="email"></div>
            <div class="input-group"><input type="password" id="login-password" placeholder="Пароль" autocomplete="current-password"></div>
            <button class="btn btn-primary" onclick="login()">Войти</button>
            <button class="btn btn-secondary" onclick="showRegister()">Создать аккаунт</button>
            <div class="error" id="login-error"></div>
            <div class="success" id="login-success"></div>
            <div id="2fa-section" style="display:none;width:100%;max-width:340px;">
                <div class="input-group"><input type="text" id="2fa-code" placeholder="Код из email" maxlength="6" inputmode="numeric" pattern="[0-9]*"></div>
                <button class="btn btn-primary" onclick="verify2FA()">Подтвердить</button>
            </div>
        </div>
    </div>
    
    <!-- ========== REGISTER SCREEN ========== -->
    <div id="register-screen" class="screen">
        <div class="nav"><button class="nav-back" onclick="showLogin()">←</button>Регистрация</div>
        <div class="container" style="display:flex;flex-direction:column;align-items:center;padding:32px;">
            <div class="input-group"><input type="email" id="reg-email" placeholder="Email" inputmode="email"></div>
            <div class="input-group"><input type="password" id="reg-password" placeholder="Пароль"></div>
            <button class="btn btn-primary" onclick="register()">Зарегистрироваться</button>
            <div class="error" id="reg-error"></div>
            <div class="success" id="reg-success"></div>
            <div id="verify-section" style="display:none;width:100%;max-width:340px;">
                <div class="input-group"><input type="text" id="verify-code" placeholder="Код подтверждения" maxlength="6" inputmode="numeric"></div>
                <button class="btn btn-primary" onclick="verifyEmail()">Подтвердить email</button>
            </div>
        </div>
    </div>
    
    <!-- ========== CHATS SCREEN ========== -->
    <div id="chats-screen" class="screen">
        <div class="nav" style="display:flex;justify-content:space-between;align-items:center;">
            <span>Сообщения</span>
            <span style="cursor:pointer;font-size:calc(22px * var(--fs));" onclick="showSettings()">⚙️</span>
        </div>
        <div class="container" id="chats-container">
            <div class="empty-state">
                <div class="icon">💬</div>
                <p>Нет сообщений</p>
                <p style="font-size:calc(14px * var(--fs));">Нажмите + чтобы найти пользователя</p>
            </div>
        </div>
        <button class="fab" onclick="showNewChatModal()">+</button>
    </div>
    
    <!-- ========== CHAT SCREEN ========== -->
    <div id="chat-screen" class="screen">
        <div id="chat-nav" class="nav">
            <button class="nav-back" onclick="goBack()">←</button>
            <div>
                <div id="chat-user-name" style="font-size:calc(17px * var(--fs));"></div>
                <div class="header-status" id="chat-user-status"></div>
            </div>
        </div>
        <div class="messages" id="chat-messages"></div>
        <div class="typing-indicator" id="typing-indicator" style="display:none;">
            <div class="typing-dots"><span></span><span></span><span></span></div>
            <span id="typing-text"></span>
        </div>
        <div class="effects-bar" id="effects-bar" style="display:none;">
            <button class="effect-btn" onclick="sendEffect('❤️','heart')">❤️</button>
            <button class="effect-btn" onclick="sendEffect('👍','like')">👍</button>
            <button class="effect-btn" onclick="sendEffect('🔥','fire')">🔥</button>
            <button class="effect-btn" onclick="sendEffect('🚀','rocket')">🚀</button>
            <button class="effect-btn" onclick="sendEffect('😂','text')">😂</button>
            <button class="effect-btn" onclick="sendEffect('😮','text')">😮</button>
            <button class="effect-btn" onclick="toggleEffects()">✕</button>
        </div>
        <div class="input-bar">
            <button class="icon-btn" onclick="toggleEffects()">😊</button>
            <input type="text" id="message-input" placeholder="Сообщение" onkeypress="onKeyPress(event)" oninput="onTyping()">
            <button class="icon-btn send" onclick="sendMessage()">↑</button>
        </div>
    </div>
    
    <!-- ========== SETTINGS SCREEN ========== -->
    <div id="settings-screen" class="screen">
        <div class="nav"><button class="nav-back" onclick="goToChats()">←</button>Настройки</div>
        <div class="container">
            <div class="profile-header">
                <div class="profile-avatar" id="settings-avatar" onclick="document.getElementById('avatar-input').click()">
                    👤
                    <div class="profile-avatar-overlay">📷</div>
                </div>
                <input type="file" id="avatar-input" accept="image/*" style="display:none" onchange="changeAvatar(event)">
                <div class="profile-nickname" id="settings-nickname"></div>
                <div class="profile-status" id="settings-status"></div>
            </div>
            
            <div class="settings-section">
                <div class="settings-item" onclick="showEditModal('nickname','Никнейм',document.getElementById('settings-nickname').textContent)">
                    <span class="settings-label">Никнейм</span>
                    <span class="settings-value" id="settings-nickname-value"></span>
                    <span class="settings-arrow">›</span>
                </div>
                <div class="settings-item" onclick="showEditModal('status','Статус',document.getElementById('settings-status').textContent)">
                    <span class="settings-label">Статус</span>
                    <span class="settings-value" id="settings-status-value"></span>
                    <span class="settings-arrow">›</span>
                </div>
                <div class="settings-item" onclick="showEditModal('email','Email',myEmail)" style="pointer-events:none;opacity:0.5;">
                    <span class="settings-label">Email</span>
                    <span class="settings-value" id="settings-email-value"></span>
                </div>
            </div>
            
            <div class="settings-section">
                <div class="settings-section-title">ОФОРМЛЕНИЕ</div>
                <div class="settings-item" onclick="showWallpaperModal()">
                    <span class="settings-label">Обои чата</span>
                    <span class="settings-arrow">›
                                    </div>
                <div class="settings-item" onclick="showThemeModal()">
                    <span class="settings-label">Тема</span>
                    <span class="settings-value" id="settings-theme-value">Тёмная</span>
                    <span class="settings-arrow">›</span>
                </div>
                <div class="settings-item" onclick="showFontSizeModal()">
                    <span class="settings-label">Размер шрифта</span>
                    <span class="settings-value" id="settings-font-value">Средний</span>
                    <span class="settings-arrow">›</span>
                </div>
            </div>
            
            <div class="settings-section">
                <div class="settings-section-title">УВЕДОМЛЕНИЯ</div>
                <div class="settings-item" onclick="toggleSetting('sound')">
                    <span class="settings-label">Звуки</span>
                    <div class="toggle" id="toggle-sound"></div>
                </div>
                <div class="settings-item" onclick="toggleSetting('notifications')">
                    <span class="settings-label">Уведомления</span>
                    <div class="toggle" id="toggle-notifications"></div>
                </div>
            </div>
            
            <div class="settings-section">
                <div class="settings-item" onclick="logout()">
                    <span class="settings-label" style="color:var(--danger);">Выйти</span>
                </div>
            </div>
        </div>
    </div>
    
    <!-- ========== MODALS ========== -->
    <div class="modal" id="new-chat-modal">
        <div class="modal-content">
            <div class="modal-handle"></div>
            <div class="modal-title">Новый чат</div>
            <div class="input-group"><input type="email" id="search-email" placeholder="Введите email пользователя" inputmode="email"></div>
            <button class="btn btn-primary" onclick="searchUser()" style="width:100%;max-width:none;">Найти</button>
            <div class="error" id="search-error"></div>
            <div id="search-result" style="margin-top:12px;"></div>
            <button class="close-modal-btn" onclick="closeModal('new-chat-modal')" style="background:var(--surface);color:var(--text);border:1px solid var(--border);">Отмена</button>
        </div>
    </div>
    
    <div class="modal" id="edit-modal">
        <div class="modal-content">
            <div class="modal-handle"></div>
            <div class="modal-title" id="edit-modal-title"></div>
            <div class="input-group"><input type="text" id="edit-input" placeholder=""></div>
            <button class="btn btn-primary" onclick="saveEdit()" style="width:100%;max-width:none;">Сохранить</button>
            <button class="close-modal-btn" onclick="closeModal('edit-modal')" style="background:var(--surface);color:var(--text);border:1px solid var(--border);">Отмена</button>
        </div>
    </div>
    
    <div class="modal" id="theme-modal">
        <div class="modal-content">
            <div class="modal-handle"></div>
            <div class="modal-title">Выберите тему</div>
            <label class="settings-item" onclick="setTheme('dark')">
                <span class="settings-label">🌙 Тёмная</span>
                <input type="radio" name="theme-radio" value="dark" style="display:none;">
                <div id="theme-check-dark" style="color:#0a84ff;display:none;">✓</div>
            </label>
            <label class="settings-item" onclick="setTheme('light')">
                <span class="settings-label">☀️ Светлая</span>
                <input type="radio" name="theme-radio" value="light" style="display:none;">
                <div id="theme-check-light" style="color:#0a84ff;display:none;">✓</div>
            </label>
            <button class="close-modal-btn" onclick="closeModal('theme-modal')">Готово</button>
        </div>
    </div>
    
    <div class="modal" id="wallpaper-modal">
        <div class="modal-content">
            <div class="modal-handle"></div>
            <div class="modal-title">Обои чата</div>
            <div class="wallpaper-grid">
                <div class="wallpaper-option w-gradient1" onclick="setWallpaper('gradient1')" id="wall-gradient1">Фиолет</div>
                <div class="wallpaper-option w-gradient2" onclick="setWallpaper('gradient2')" id="wall-gradient2">Бирюза</div>
                <div class="wallpaper-option w-space" onclick="setWallpaper('space')" id="wall-space">Космос</div>
                <div class="wallpaper-option w-sunset" onclick="setWallpaper('sunset')" id="wall-sunset">Закат</div>
                <div class="wallpaper-option w-ocean" onclick="setWallpaper('ocean')" id="wall-ocean">Океан</div>
            </div>
            <button class="close-modal-btn" onclick="closeModal('wallpaper-modal')">Готово</button>
        </div>
    </div>
    
    <div class="modal" id="font-modal">
        <div class="modal-content">
            <div class="modal-handle"></div>
            <div class="modal-title">Размер шрифта</div>
            <div class="font-size-options">
                <button class="font-size-btn" onclick="setFontSize('small')" id="font-small">А</button>
                <button class="font-size-btn" onclick="setFontSize('medium')" id="font-medium" style="font-size:18px;">А</button>
                <button class="font-size-btn" onclick="setFontSize('large')" id="font-large" style="font-size:22px;">А</button>
                <button class="font-size-btn" onclick="setFontSize('xlarge')" id="font-xlarge" style="font-size:26px;">А</button>
            </div>
            <button class="close-modal-btn" onclick="closeModal('font-modal')">Готово</button>
        </div>
    </div>
    
    <div class="toast" id="toast"></div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        // ========== GLOBALS ==========
        let token = localStorage.getItem('token') || '';
        let myEmail = localStorage.getItem('email') || '';
        let socket = null;
        let currentChat = null;
        let myProfile = null;
        let currentEditField = null;
        
        // ========== INIT ==========
        if (token && myEmail) {
            loadMyProfile().then(() => {
                connectSocket();
                showChats();
            });
        }
        
        function getSavedTheme() {
            return localStorage.getItem('theme') || 'dark';
        }
        
        function getSavedWallpaper() {
            return localStorage.getItem('wallpaper') || 'gradient1';
        }
        
        function getSavedFontSize() {
            return localStorage.getItem('fontSize') || 'medium';
        }
        
        // Apply saved settings
        document.body.className = getSavedTheme() + ' ' + 'wallpaper-' + getSavedWallpaper() + ' ' + 'font-' + getSavedFontSize();
        document.querySelector('meta[name=theme-color]').content = getSavedTheme() === 'dark' ? '#000' : '#f2f2f7';
        
        // ========== SOCKET ==========
        function connectSocket() {
            if (socket) socket.disconnect();
            socket = io();
            socket.on('connect', () => socket.emit('join', myEmail));
            
            socket.on('message', (msg) => {
                if (currentChat === msg.from || currentChat === msg.to) {
                    addMessage(msg);
                    if (myProfile?.sound) playSound(msg.type);
                }
                loadChats();
            });
            
            socket.on('typing', (data) => {
                if (currentChat === data.user) {
                    const ind = document.getElementById('typing-indicator');
                    ind.style.display = 'flex';
                    document.getElementById('typing-text').textContent = (data.nickname || data.user) + ' печатает';
                    clearTimeout(window._typingTimeout);
                    window._typingTimeout = setTimeout(() => ind.style.display = 'none', 2000);
                }
            });
            
            socket.on('userStatus', () => {
                loadChats();
                if (currentChat) updateChatHeader(currentChat);
            });
        }
        
        function playSound(type) {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                
                if (type === 'heart' || type === 'like') {
                    osc.frequency.value = 600;
                    osc.type = 'sine';
                } else if (type === 'rocket') {
                    osc.frequency.value = 300;
                    osc.type = 'sawtooth';
                } else {
                    osc.frequency.value = 400;
                    osc.type = 'sine';
                }
                
                gain.gain.value = 0.1;
                osc.start();
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
                osc.stop(ctx.currentTime + 0.15);
            } catch(e) {}
        }
        
        // ========== SCREENS ==========
        function showScreen(id) {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            document.getElementById(id + '-screen').classList.add('active');
        }
        
        function showLogin() { 
            showScreen('login');
            document.getElementById('login-error').textContent = '';
            document.getElementById('login-success').textContent = '';
            document.getElementById('2fa-section').style.display = 'none';
        }
        
        function showRegister() { 
            showScreen('register');
            document.getElementById('reg-error').textContent = '';
            document.getElementById('reg-success').textContent = '';
            document.getElementById('verify-section').style.display = 'none';
        }
        
        function showChats() { 
            showScreen('chats'); 
            loadChats(); 
        }
        
        function showSettings() { 
            showScreen('settings'); 
            loadSettingsUI(); 
        }
        
        function goToChats() { 
            currentChat = null; 
            showChats(); 
        }
        
        function goBack() { 
            currentChat = null; 
            showChats(); 
        }
        
        // ========== TOAST ==========
        function showToast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 2000);
        }
        
        // ========== MODALS ==========
        function closeModal(id) {
            document.getElementById(id).classList.remove('active');
        }
        
        function showNewChatModal() {
            document.getElementById('new-chat-modal').classList.add('active');
            document.getElementById('search-email').value = '';
            document.getElementById('search-error').textContent = '';
            document.getElementById('search-result').innerHTML = '';
            setTimeout(() => document.getElementById('search-email').focus(), 300);
        }
        
        function showEditModal(field, title, currentValue) {
            currentEditField = field;
            document.getElementById('edit-modal-title').textContent = title;
            document.getElementById('edit-input').value = currentValue || '';
            document.getElementById('edit-modal').classList.add('active');
            setTimeout(() => document.getElementById('edit-input').focus(), 300);
        }
        
        function showThemeModal() {
            document.getElementById('theme-modal').classList.add('active');
            document.getElementById('theme-check-dark').style.display = getSavedTheme() === 'dark' ? 'inline' : 'none';
            document.getElementById('theme-check-light').style.display = getSavedTheme() === 'light' ? 'inline' : 'none';
        }
        
        function showWallpaperModal() {
            document.getElementById('wallpaper-modal').classList.add('active');
            const current = getSavedWallpaper();
            document.querySelectorAll('.wallpaper-option').forEach(el => {
                el.classList.toggle('selected', el.id === 'wall-' + current);
            });
        }
        
        function showFontSizeModal() {
            document.getElementById('font-modal').classList.add('active');
            const current = getSavedFontSize();
            document.querySelectorAll('.font-size-btn').forEach(el => {
                el.classList.toggle('selected', el.id === 'font-' + current);
            });
        }
        
        // ========== API ==========
        async function request(url, options = {}) {
            try {
                const res = await fetch(url, options);
                return await res.json();
            } catch(e) {
                return { error: 'Ошибка соединения' };
            }
        }
        
        async function loadMyProfile() {
            if (!token) return;
            const data = await request('/contacts?token=' + token);
            if (data.myProfile) {
                myProfile = data.myProfile;
                applyAllSettings();
            }
        }
        
        function applyAllSettings() {
            if (!myProfile) return;
            if (myProfile.theme) { localStorage.setItem('theme', myProfile.theme); }
            if (myProfile.wallpaper) { localStorage.setItem('wallpaper', myProfile.wallpaper); }
            if (myProfile.fontSize) { localStorage.setItem('fontSize', myProfile.fontSize); }
            document.body.className = getSavedTheme() + ' ' + 'wallpaper-' + getSavedWallpaper() + ' ' + 'font-' + getSavedFontSize();
            document.querySelector('meta[name=theme-color]').content = getSavedTheme() === 'dark' ? '#000' : '#f2f2f7';
        }
        
        // ========== AUTH ==========
        async function register() {
            const email = document.getElementById('reg-email').value.trim();
            const password = document.getElementById('reg-password').value;
            document.getElementById('reg-error').textContent = '';
            document.getElementById('reg-success').textContent = '';
            
            if (!email || !password) {
                document.getElementById('reg-error').textContent = 'Заполни все поля';
                return;
            }
            
            const data = await request('/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
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
            
            const data = await request('/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code })
            });
            
            if (data.error) {
                document.getElementById('reg-error').textContent = data.error;
            } else {
                token = data.token;
                myEmail = data.email;
                myProfile = data.user;
                localStorage.setItem('token', token);
                localStorage.setItem('email', myEmail);
                applyAllSettings();
                connectSocket();
                showChats();
            }
        }
        
        async function login() {
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;
            document.getElementById('login-error').textContent = '';
            document.getElementById('login-success').textContent = '';
            
            if (!email || !password) {
                document.getElementById('login-error').textContent = 'Заполни все поля';
                return;
            }
            
            const data = await request('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            if (data.error) {
                document.getElementById('login-error').textContent = data.error;
            } else if (data.need2FA) {
                document.getElementById('2fa-section').style.display = 'block';
                document.getElementById('login-success').textContent = 'Код отправлен (смотри консоль Render)';
                setTimeout(() => document.getElementById('2fa-code').focus(), 300);
            }
        }
        
        async function verify2FA() {
            const email = document.getElementById('login-email').value.trim();
            const code = document.getElementById('2fa-code').value.trim();
            
            const data = await request('/verify-2fa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code })
            });
            
            if (data.error) {
                document.getElementById('login-error').textContent = data.error;
            } else {
                token = data.token;
                myEmail = data.email;
                myProfile = data.user;
                localStorage.setItem('token', token);
                localStorage.setItem('email', myEmail);
                applyAllSettings();
                connectSocket();
                showChats();
            }
        }
        
        function logout() {
            localStorage.clear();
            token = '';
            myEmail = '';
            myProfile = null;
            currentChat = null;
            if (socket) socket.disconnect();
            socket = null;
            showLogin();
        }
        
        // ========== CHATS ==========
        async function loadChats() {
            if (!token) return;
            const data = await request('/contacts?token=' + token);
            if (data.error || !data.contacts) return;
            
            if (data.myProfile) {
                myProfile = data.myProfile;
                applyAllSettings();
            }
            
            const container = document.getElementById('chats-container');
            
            if (data.contacts.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="icon">💬</div>
                        <p>Нет сообщений</p>
                        <p style="font-size:calc(14px * var(--fs));">Нажмите + чтобы найти пользователя</p>
                    </div>\`;
                return;
            }
            
            container.innerHTML = '';
            
            data.contacts.forEach(user => {
                const div = document.createElement('div');
                div.className = 'chat-item';
                div.onclick = () => openChat(user.email);
                div.innerHTML = \`
                    <div class="avatar">\${user.avatar ? '<img src="'+user.avatar+'">' : '👤'}</div>
                    <div class="chat-info">
                        <div class="chat-name">\${user.nickname || user.email}</div>
                        <div class="chat-preview">\${user.status || ''}</div>
                    </div>
                    \${user.online ? '<div class="online-dot"></div>' : ''}
                \`;
                container.appendChild(div);
            });
        }
        
        async function searchUser() {
            const email = document.getElementById('search-email').value.trim();
            document.getElementById('search-error').textContent = '';
            document.getElementById('search-result').innerHTML = '';
            
            if (!email) {
                document.getElementById('search-error').textContent = 'Введите email';
                return;
            }
            
            const data = await request('/find-user?token=' + token + '&email=' + encodeURIComponent(email));
            
            if (data.error) {
                document.getElementById('search-error').textContent = data.error;
            } else if (data.found) {
                document.getElementById('search-result').innerHTML = \`
                    <div class="chat-item" onclick="openChatFromSearch('\${data.email}')">
                        <div class="avatar">\${data.avatar ? '<img src="'+data.avatar+'">' : '👤'}</div>
                        <div class="chat-info">
                            <div class="chat-name">\${data.nickname || data.email}</div>
                            <div class="chat-preview">\${data.status || ''}</div>
                        </div>
                        \${data.online ? '<div class="online-dot"></div>' : ''}
                    </div>\`;
            }
        }
        
        function openChatFromSearch(email) {
            closeModal('new-chat-modal');
            openChat(email);
        }
        
        async function openChat(userEmail) {
            currentChat = userEmail;
            document.getElementById('chat-user-name').textContent = userEmail;
            showScreen('chat');
            document.getElementById('message-input').focus();
            document.getElementById('effects-bar').style.display = 'none';
            
            await updateChatHeader(userEmail);
            
            const data = await request('/messages?token=' + token + '&with=' + encodeURIComponent(userEmail));
            
            const containerMessages = document.getElementById('chat-messages');
            containerMessages.innerHTML = '';
            if (data.messages) {
                data.messages.forEach(addMessage);
            }
            containerMessages.scrollTop = containerMessages.scrollHeight;
        }
        
        async function updateChatHeader(userEmail) {
            const data = await request('/messages?token=' + token + '&with=' + encodeURIComponent(userEmail));
            if (data.chatUser) {
                document.getElementById('chat-user-name').textContent = data.chatUser.nickname || data.chatUser.email;
                document.getElementById('chat-user-status').textContent = data.chatUser.online ? 'онлайн' : (data.chatUser.status || '');
            }
        }
        
        function addMessage(msg) {
            const container = document.getElementById('chat-messages');
            const row = document.createElement('div');
            row.className = 'message-row ' + (msg.from === myEmail ? 'sent' : 'received');
            
            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            
            if (msg.type === 'heart') {
                bubble.textContent = '❤️';
                bubble.classList.add('heart');
            } else if (msg.type === 'like') {
                bubble.textContent = '👍';
                bubble.classList.add('like');
            } else if (msg.type === 'fire') {
                bubble.textContent = '🔥';
                bubble.classList.add('fire');
            } else if (msg.type === 'rocket') {
                bubble.textContent = '🚀';
                bubble.classList.add('rocket');
            } else {
                bubble.textContent = msg.text;
            }
            
            const time = document.createElement('div');
            time.className = 'message-time';
            time.textContent = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
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
            socket.emit('message', { to: currentChat, text, time, type: 'text' });
            
            addMessage({ from: myEmail, to: currentChat, text, time, type: 'text' });
            input.value = '';
        }
        
        function sendEffect(emoji, type) {
            if (!currentChat) return;
            const time = Date.now();
            socket.emit('message', { to: currentChat, text: emoji, time, type });
            addMessage({ from: myEmail, to: currentChat, text: emoji, time, type });
        }
        
        function toggleEffects() {
            const bar = document.getElementById('effects-bar');
            bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
        }
        
        function onKeyPress(e) {
            if (e.key === 'Enter') sendMessage();
        }
        
        function onTyping() {
            if (currentChat && socket) {
                socket.emit('typing', currentChat);
            }
        }
        
        // ========== SETTINGS ==========
        function loadSettingsUI() {
            if (!myProfile) {
                document.getElementById('settings-nickname').textContent = myEmail || '';
                document.getElementById('settings-status').textContent = '';
                document.getElementById('settings-nickname-value').textContent = myEmail || '';
                document.getElementById('settings-status-value').textContent = '';
                document.getElementById('settings-email-value').textContent = myEmail || '';
                document.getElementById('settings-theme-value').textContent = getSavedTheme() === 'dark' ? 'Тёмная' : 'Светлая';
                document.getElementById('settings-font-value').textContent = 'Средний';
                document.getElementById('toggle-sound').classList.toggle('active', true);
                document.getElementById('toggle-notifications').classList.toggle('active', true);
                document.getElementById('settings-avatar').innerHTML = '👤' + '<div class="profile-avatar-overlay">📷</div>';
                return;
            }
            
            document.getElementById('settings-nickname').textContent = myProfile.nickname || myEmail;
            document.getElementById('settings-status').textContent = myProfile.status || '';
            document.getElementById('settings-nickname-value').textContent = myProfile.nickname || myEmail;
            document.getElementById('settings-status-value').textContent = myProfile.status || '';
            document.getElementById('settings-email-value').textContent = myEmail;
            document.getElementById('settings-theme-value').textContent = myProfile.theme === 'light' ? 'Светлая' : 'Тёмная';
            
            const fontLabels = { small: 'Маленький', medium: 'Средний', large: 'Большой', xlarge: 'Огромный' };
            document.getElementById('settings-font-value').textContent = fontLabels[myProfile.fontSize] || 'Средний';
            
            document.getElementById('toggle-sound').classList.toggle('active', myProfile.sound !== false);
            document.getElementById('toggle-notifications').classList.toggle('active', myProfile.notifications !== false);
            
            if (myProfile.avatar) {
                document.getElementById('settings-avatar').innerHTML = '<img src="' + myProfile.avatar + '">' + '<div class="profile-avatar-overlay">📷</div>';
            } else {
                document.getElementById('settings-avatar').innerHTML = '👤' + '<div class="profile-avatar-overlay">📷</div>';
            }
        }
        
        async function changeAvatar(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = async (e) => {
                const avatar = e.target.result;
                const data = await request('/update-profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, avatar })
                });
                
                if (data.success && data.user) {
                    myProfile = data.user;
                    localStorage.setItem('avatar', avatar);
                    loadSettingsUI();
                    showToast('Аватар обновлён ✨');
                }
            };
            reader.readAsDataURL(file);
        }
        
        async function saveEdit() {
            const value = document.getElementById('edit-input').value.trim();
            if (!value || !currentEditField) return;
            
            const data = await request('/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, [currentEditField]: value })
            });
            
            if (data.success && data.user) {
                myProfile = data.user;
                closeModal('edit-modal');
                loadSettingsUI();
                showToast(currentEditField === 'nickname' ? 'Никнейм обновлён' : 'Статус обновлён');
            }
        }
        
        async function toggleSetting(setting) {
            if (!myProfile) return;
            const newValue = !myProfile[setting];
            
            const data = await request('/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, [setting]: newValue })
            });
            
            if (data.success && data.user) {
                myProfile = data.user;
                loadSettingsUI();
            }
        }
        
        async function setTheme(theme) {
            const data = await request('/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, theme })
            });
            
            if (data.success && data.user) {
                myProfile = data.user;
                localStorage.setItem('theme', theme);
                document.body.className = theme + ' ' + 'wallpaper-' + getSavedWallpaper() + ' ' + 'font-' + getSavedFontSize();
                document.querySelector('meta[name=theme-color]').content = theme === 'dark' ? '#000' : '#f2f2f7';
                document.getElementById('theme-check-dark').style.display = theme === 'dark' ? 'inline' : 'none';
                document.getElementById('theme-check-light').style.display = theme === 'light' ? 'inline' : 'none';
                loadSettingsUI();
            }
        }
        
        async function setWallpaper(wp) {
            const data = await request('/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, wallpaper: wp })
            });
            
            if (data.success && data.user) {
                myProfile = data.user;
                localStorage.setItem('wallpaper', wp);
                document.body.className = getSavedTheme() + ' ' + 'wallpaper-' + wp + ' ' + 'font-' + getSavedFontSize();
                document.querySelectorAll('.wallpaper-option').forEach(el => {
                    el.classList.toggle('selected', el.id === 'wall-' + wp);
                });
                showToast('Обои изменены 🎨');
            }
        }
        
        async function setFontSize(size) {
            const data = await request('/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, fontSize: size })
            });
            
            if (data.success && data.user) {
                myProfile = data.user;
                localStorage.setItem('fontSize', size);
                document.body.className = getSavedTheme() + ' ' + 'wallpaper-' + getSavedWallpaper() + ' ' + 'font-' + size;
                document.querySelectorAll('.font-size-btn').forEach(el => {
                    el.classList.toggle('selected', el.id === 'font-' + size);
                });
                loadSettingsUI();
            }
        }
    </script>
</body>
</html>`);
});

// ========== START ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('✅ Messages запущен на порту', PORT);
});
                    
                 
