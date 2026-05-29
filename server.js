const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxFileSize: 10 * 1024 * 1024
});

const accounts = new Map();
const onlineUsers = new Map();
const pending2FA = new Map();

const clientDir = path.join(__dirname, 'client');
const uploadsDir = path.join(clientDir, 'uploads');
const manifestsDir = path.join(clientDir, 'manifests');

[clientDir, uploadsDir, manifestsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(clientDir));
app.use('/uploads', express.static(uploadsDir));

// Email transporter (настрой под свой SMTP)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'your-email@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-app-password'
    }
});

// Генерация манифеста для PWA
app.get('/manifest.json', (req, res) => {
    res.json({
        name: "SecureChat",
        short_name: "SChat",
        start_url: "/",
        display: "standalone",
        background_color: "#667eea",
        theme_color: "#667eea",
        icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
        ]
    });
});

app.get('/sw.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.send(`
        self.addEventListener('install', e => self.skipWaiting());
        self.addEventListener('activate', e => clients.claim());
        self.addEventListener('fetch', e => e.respondWith(fetch(e.request)));
    `);
});

app.post('/upload-avatar', (req, res) => {
    const { userId, image } = req.body;
    if (!image || !userId) return res.status(400).send('No data');
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const filename = `avatar_${userId}_${Date.now()}.png`;
    fs.writeFileSync(path.join(uploadsDir, filename), base64Data, 'base64');
    const account = getAccountByUserId(userId);
    if (account) account.avatar = `/uploads/${filename}`;
    res.json({ avatarUrl: `/uploads/${filename}` });
});

app.post('/verify-2fa', (req, res) => {
    const { userId, code } = req.body;
    const pending = pending2FA.get(userId);
    if (pending && pending.code === code && Date.now() < pending.expires) {
        pending2FA.delete(userId);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Неверный код' });
    }
});

const htmlContent = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#667eea">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icon-192.png">
<title>SecureChat</title>
<style>
:root {
    --bg: #ffffff;
    --bg-secondary: #f2f2f7;
    --text: #000000;
    --text-secondary: #8e8e93;
    --bubble-other: #e9e9eb;
    --bubble-own: #007aff;
    --sidebar-bg: #f2f2f7;
    --input-bg: #ffffff;
    --border: #c6c6c8;
    --shadow: rgba(0,0,0,0.1);
    --cell-bg: #ffffff;
}
.dark-theme {
    --bg: #000000;
    --bg-secondary: #1c1c1e;
    --text: #ffffff;
    --text-secondary: #98989d;
    --bubble-other: #2c2c2e;
    --bubble-own: #0a84ff;
    --sidebar-bg: #1c1c1e;
    --input-bg: #2c2c2e;
    --border: #38383a;
    --shadow: rgba(0,0,0,0.5);
    --cell-bg: #1c1c1e;
}
*{margin:0;padding:0;box-sizing:border-box}
body{
    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif;
    background:var(--bg);color:var(--text);height:100vh;
    transition:all 0.2s;-webkit-font-smoothing:antialiased;
    overflow:hidden;position:fixed;width:100%;
}
.auth-screen{
    display:flex;justify-content:center;align-items:center;
    height:100vh;padding:20px;
    background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);
}
.auth-box{
    background:var(--bg);border-radius:20px;padding:30px;
    box-shadow:0 8px 32px var(--shadow);width:100%;
    max-width:400px;text-align:center;max-height:90vh;overflow-y:auto;
}
.auth-box h2{color:#667eea;margin-bottom:15px;font-size:2rem}
.auth-box p{color:var(--text-secondary);margin-bottom:20px}
.auth-input{
    width:100%;padding:14px 16px;margin-bottom:12px;
    border:1px solid var(--border);border-radius:12px;
    font-size:1rem;outline:none;background:var(--input-bg);
    color:var(--text);transition:border-color 0.2s;
}
.auth-input:focus{border-color:#667eea}
.auth-button{
    width:100%;padding:16px;
    background:#007aff;color:white;border:none;
    border-radius:12px;font-size:1.1rem;cursor:pointer;
    margin-bottom:12px;transition:opacity 0.2s;
    font-weight:600;
}
.auth-button:active{opacity:0.8}
.auth-link{color:#007aff;cursor:pointer;font-weight:500}
.error-message{color:#ff3b30;margin:8px 0;font-size:.85rem;display:none}
.app-container{
    width:100%;height:100vh;margin:0;background:var(--bg);
    display:flex;overflow:hidden;position:relative;
}
.sidebar{
    width:100%;max-width:380px;background:var(--sidebar-bg);
    border-right:1px solid var(--border);display:flex;
    flex-direction:column;position:relative;z-index:10;
}
.sidebar-header{
    padding:15px;border-bottom:1px solid var(--border);
    background:var(--sidebar-bg);
}
.user-header{
    display:flex;align-items:center;justify-content:space-between;
    margin-bottom:12px;
}
.user-info{
    display:flex;align-items:center;gap:10px;flex:1;min-width:0;
    cursor:pointer;
}
.avatar{
    width:42px;height:42px;border-radius:50%;
    background:linear-gradient(135deg,#667eea,#764ba2);
    display:flex;align-items:center;justify-content:center;
    color:white;font-weight:bold;overflow:hidden;flex-shrink:0;
    font-size:1.1rem;
}
.avatar img{width:100%;height:100%;object-fit:cover}
.username-text{font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.header-buttons{display:flex;gap:6px}
.icon-btn{
    width:36px;height:36px;border-radius:50%;border:none;
    background:var(--bg-secondary);color:var(--text);
    cursor:pointer;display:flex;align-items:center;
    justify-content:center;font-size:1.1rem;transition:background 0.2s;
}
.icon-btn:hover{background:var(--border)}
.search-container{position:relative}
.search-container input{
    width:100%;padding:8px 12px 8px 32px;border-radius:10px;
    border:1px solid var(--border);background:var(--input-bg);
    color:var(--text);outline:none;font-size:.9rem;
}
.search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-secondary);font-size:.9rem}
.chats-list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;background:var(--cell-bg)}
.chat-item{
    padding:12px 15px;cursor:pointer;display:flex;
    align-items:center;gap:12px;transition:background 0.15s;
    border-bottom:0.5px solid var(--border);position:relative;
}
.chat-item:active{background:var(--bg-secondary)}
.chat-item.active{background:#007aff10;border-left:3px solid #007aff}
.chat-item-avatar{
    width:50px;height:50px;border-radius:50%;
    background:linear-gradient(135deg,#667eea,#764ba2);
    display:flex;align-items:center;justify-content:center;
    color:white;font-weight:bold;overflow:hidden;flex-shrink:0;
}
.chat-item-avatar img{width:100%;height:100%;object-fit:cover}
.chat-item-info{flex:1;min-width:0}
.chat-item-header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px}
.chat-item-name{font-weight:600;color:var(--text);font-size:.95rem}
.chat-item-time{font-size:.7rem;color:var(--text-secondary)}
.chat-item-preview{
    font-size:.85rem;color:var(--text-secondary);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    display:flex;align-items:center;gap:4px;
}
.unread-badge{
    background:#007aff;color:white;border-radius:50%;
    min-width:20px;height:20px;display:flex;align-items:center;
    justify-content:center;font-size:.7rem;font-weight:600;
    position:absolute;right:15px;top:50%;transform:translateY(50%);
}
.chat-area{
    flex:1;display:flex;flex-direction:column;
    background:var(--bg);position:relative;
}
.chat-header{
    padding:12px 15px;background:var(--bg-secondary);
    border-bottom:1px solid var(--border);display:flex;
    align-items:center;gap:10px;min-height:56px;
}
.chat-header .avatar{cursor:pointer}
.chat-header-info{flex:1}
.chat-header-name{font-weight:600;color:var(--text)}
.chat-header-status{font-size:.75rem;color:var(--text-secondary)}
.messages-container{
    flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;
    padding:15px;background:var(--bg);display:flex;
    flex-direction:column;gap:2px;
}
.message-group{display:flex;flex-direction:column;margin-bottom:8px}
.message-row{
    display:flex;align-items:flex-end;gap:6px;
    max-width:85%;margin-bottom:1px;
}
.message-row.own{align-self:flex-end;flex-direction:row-reverse}
.message-row.other{align-self:flex-start}
.message-avatar{
    width:26px;height:26px;border-radius:50%;
    background:linear-gradient(135deg,#667eea,#764ba2);
    display:flex;align-items:center;justify-content:center;
    color:white;font-size:.6rem;font-weight:bold;overflow:hidden;
    flex-shrink:0;opacity:0;transition:opacity 0.2s;
}
.message-row.other.last-in-group .message-avatar{opacity:1}
.message-bubble{
    padding:8px 13px;border-radius:16px;
    word-wrap:break-word;font-size:.95rem;line-height:1.3;
    position:relative;
}
.message-row.other .message-bubble{
    background:var(--bubble-other);color:var(--text);
    border-bottom-left-radius:4px;
}
.message-row.own .message-bubble{
    background:var(--bubble-own);color:white;
    border-bottom-right-radius:4px;
}
.message-image{max-width:220px;border-radius:12px;cursor:pointer}
.message-time{
    font-size:.65rem;margin-top:2px;opacity:0.7;
}
.message.own .message-time{color:rgba(255,255,255,0.7);text-align:right}
.message.other .message-time{color:var(--text-secondary)}
.input-container{
    padding:10px 15px;background:var(--bg-secondary);
    border-top:1px solid var(--border);display:flex;
    gap:8px;align-items:flex-end;
}
.input-container input[type="text"]{
    flex:1;padding:10px 15px;border:1px solid var(--border);
    border-radius:20px;font-size:.95rem;outline:none;
    background:var(--input-bg);color:var(--text);
    max-height:100px;
}
.send-btn{
    width:38px;height:38px;border-radius:50%;
    background:#007aff;color:white;border:none;
    cursor:pointer;font-size:1.2rem;display:flex;
    align-items:center;justify-content:center;
    transition:transform 0.1s;flex-shrink:0;
}
.send-btn:active{transform:scale(0.9)}
.no-chat{
    flex:1;display:flex;align-items:center;justify-content:center;
    color:var(--text-secondary);flex-direction:column;gap:15px;
    font-size:1.1rem;padding:40px;text-align:center;
}
.no-chat-icon{font-size:4rem;opacity:0.3}
.settings-overlay{
    position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.4);z-index:1000;
    display:none;justify-content:center;align-items:center;
}
.settings-panel{
    background:var(--bg);border-radius:20px;padding:25px;
    width:90%;max-width:420px;max-height:80vh;overflow-y:auto;
    box-shadow:0 20px 60px rgba(0,0,0,0.3);
}
.settings-title{font-size:1.5rem;font-weight:700;margin-bottom:20px;text-align:center}
.settings-section{margin-bottom:25px}
.settings-section h3{margin-bottom:12px;color:var(--text-secondary);font-size:.9rem;text-transform:uppercase;letter-spacing:1px}
.settings-item{
    display:flex;justify-content:space-between;align-items:center;
    padding:12px 0;border-bottom:0.5px solid var(--border);
}
.settings-label{font-weight:500}
.settings-input{
    padding:8px 12px;border:1px solid var(--border);
    border-radius:8px;background:var(--input-bg);color:var(--text);
    width:200px;
}
.settings-button{
    padding:8px 16px;background:#007aff;color:white;
    border:none;border-radius:8px;cursor:pointer;font-size:.9rem;
}
.toggle-switch{
    width:50px;height:30px;background:var(--border);border-radius:15px;
    position:relative;cursor:pointer;transition:background 0.2s;
}
.toggle-switch.active{background:#34c759}
.toggle-switch::after{
    content:'';position:absolute;top:2px;left:2px;
    width:26px;height:26px;background:white;border-radius:50%;
    transition:transform 0.2s;box-shadow:0 2px 4px rgba(0,0,0,0.2);
}
.toggle-switch.active::after{transform:translateX(20px)}
.modal{
    display:none;position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.9);z-index:2000;justify-content:center;align-items:center;
}
.modal img{max-width:90%;max-height:90%}
.modal-close{position:absolute;top:20px;right:20px;color:white;font-size:2rem;cursor:pointer}
.notification{
    position:fixed;top:20px;right:20px;background:#007aff;color:white;
    padding:12px 20px;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.3);
    z-index:3000;transform:translateX(120%);transition:transform 0.3s;
    font-weight:500;max-width:300px;
}
.notification.show{transform:translateX(0)}
@media(max-width:768px){
    .sidebar{position:absolute;left:0;top:0;height:100vh;z-index:100;transform:translateX(-100%);transition:transform 0.3s;width:100%}
    .sidebar.open{transform:translateX(0)}
    .chat-area{width:100%}
}
</style>
</head>
<body>
<div id="loginScreen" class="auth-screen">
<div class="auth-box">
<h2>SecureChat</h2>
<p>Безопасный мессенджер</p>
<input type="text" id="loginUsername" class="auth-input" placeholder="Логин или Email" maxlength="50">
<input type="password" id="loginPassword" class="auth-input" placeholder="Пароль">
<div class="error-message" id="loginError"></div>
<button class="auth-button" onclick="login()">Войти</button>
<p>Нет аккаунта? <span class="auth-link" onclick="showRegister()">Создать</span></p>
</div>
</div>

<div id="registerScreen" class="auth-screen" style="display:none">
<div class="auth-box">
<h2>Регистрация</h2>
<div style="position:relative;display:inline-block;margin-bottom:15px">
<div id="regAvatar" class="avatar" style="width:80px;height:80px;font-size:2rem;cursor:pointer" onclick="document.getElementById('avatarInput').click()">📷</div>
<input type="file" id="avatarInput" accept="image/*" style="display:none" onchange="previewAvatar(this)">
</div>
<input type="text" id="regUsername" class="auth-input" placeholder="Логин" maxlength="20">
<input type="email" id="regEmail" class="auth-input" placeholder="Email">
<input type="password" id="regPassword" class="auth-input" placeholder="Пароль">
<input type="password" id="regPasswordConfirm" class="auth-input" placeholder="Подтвердите пароль">
<div class="error-message" id="regError"></div>
<button class="auth-button" onclick="register()">Создать аккаунт</button>
<p>Есть аккаунт? <span class="auth-link" onclick="showLogin()">Войти</span></p>
</div>
</div>

<div id="twoFAScreen" class="auth-screen" style="display:none">
<div class="auth-box">
<h2>Двухфакторная аутентификация</h2>
<p id="twoFAEmail"></p>
<input type="text" id="twoFACode" class="auth-input" placeholder="Код из письма" maxlength="6">
<div class="error-message" id="twoFAError"></div>
<button class="auth-button" onclick="verify2FA()">Подтвердить</button>
</div>
</div>

<div id="chatScreen" style="display:none" class="app-container">
<div class="sidebar" id="sidebar">
<div class="sidebar-header">
<div class="user-header">
<div class="user-info" onclick="openSettings()">
<div id="myAvatar" class="avatar">👤</div>
<div class="username-text" id="myUsername"></div>
</div>
<div class="header-buttons">
<button class="icon-btn" onclick="openSettings()">⚙️</button>
<button class="icon-btn" onclick="toggleTheme()">🌓</button>
</div>
</div>
<div class="search-container">
<span class="search-icon">🔍</span>
<input type="text" id="searchUser" placeholder="Поиск..." oninput="searchUsers()">
</div>
</div>
<div class="chats-list" id="chatsList"></div>
<div id="searchResults" style="display:none;border-top:1px solid var(--border);padding:10px;background:var(--cell-bg)"></div>
</div>

<div class="chat-area">
<div class="chat-header" id="chatHeader" style="display:none" onclick="toggleSidebar()">
<div id="chatAvatar" class="avatar">👤</div>
<div class="chat-header-info">
<div class="chat-header-name" id="chatTitle">Сообщения</div>
<div class="chat-header-status" id="chatStatus"></div>
</div>
<button class="icon-btn" onclick="toggleSidebar()">☰</button>
</div>
<div class="messages-container" id="messagesContainer">
<div class="no-chat">
<div class="no-chat-icon">💬</div>
<div>Выберите чат<br>или начните новый</div>
</div>
</div>
<div class="input-container" id="inputContainer" style="display:none">
<button class="icon-btn" onclick="document.getElementById('imageInput').click()">📷</button>
<input type="file" id="imageInput" accept="image/*" multiple style="display:none" onchange="sendImage(this)">
<input type="text" id="messageInput" placeholder="Сообщение..." onkeydown="if(event.key==='Enter'){event.preventDefault();sendMessage()}">
<button class="send-btn" onclick="sendMessage()">↑</button>
</div>
</div>
</div>

<div id="settingsOverlay" class="settings-overlay" onclick="if(event.target===this)closeSettings()">
<div class="settings-panel">
<div class="settings-title">Настройки</div>
<div class="settings-section">
<h3>Профиль</h3>
<div class="settings-item">
<span class="settings-label">Аватар</span>
<div class="avatar" style="width:40px;height:40px;cursor:pointer" onclick="document.getElementById('avatarChangeInput').click()" id="settingsAvatar"></div>
</div>
<div class="settings-item">
<span class="settings-label">Email</span>
<input type="email" class="settings-input" id="settingsEmail">
</div>
<button class="settings-button" onclick="updateEmail()" style="width:100%;margin-top:10px">Обновить Email</button>
</div>
<div class="settings-section">
<h3>Оформление</h3>
<div class="settings-item">
<span class="settings-label">Тёмная тема</span>
<div class="toggle-switch" id="themeToggle" onclick="toggleTheme()"></div>
</div>
<div class="settings-item">
<span class="settings-label">Уведомления</span>
<div class="toggle-switch active" id="notifToggle" onclick="toggleNotifications()"></div>
</div>
</div>
<div class="settings-section">
<h3>Безопасность</h3>
<button class="settings-button" onclick="enable2FA()" style="width:100%">Включить 2FA</button>
<p style="font-size:.8rem;color:var(--text-secondary);margin-top:8px">Двухфакторная аутентификация через email</p>
</div>
<div class="settings-section">
<h3>Приложение</h3>
<button class="settings-button" onclick="installPWA()" style="width:100%;margin-bottom:8px" id="installBtn" style="display:none">Установить приложение</button>
<button class="settings-button" onclick="logout()" style="width:100%;background:#ff3b30">Выйти</button>
</div>
<button class="settings-button" onclick="closeSettings()" style="width:100%;margin-top:10px;background:var(--bg-secondary);color:var(--text)">Закрыть</button>
</div>
</div>

<div class="modal" id="imageModal" onclick="this.style.display='none'">
<span class="modal-close">✕</span>
<img id="modalImage">
</div>
<div class="notification" id="notification"></div>
<input type="file" id="avatarChangeInput" accept="image/*" style="display:none" onchange="uploadAvatar(this)">

<script src="/socket.io/socket.io.js"></script>
<script>
var socket, currentUser=null, currentChat=null, allChats=[], allUsers=[], regAvatarData=null, pending2FAUser=null;
var notificationsEnabled=true, theme='light';

function showRegister(){document.getElementById('loginScreen').style.display='none';document.getElementById('registerScreen').style.display='flex'}
function showLogin(){document.getElementById('registerScreen').style.display='none';document.getElementById('loginScreen').style.display='flex';document.getElementById('twoFAScreen').style.display='none'}
function toggleTheme(){
    document.body.classList.toggle('dark-theme');
    theme=document.body.classList.contains('dark-theme')?'dark':'light';
    localStorage.setItem('theme',theme);
    document.getElementById('themeToggle')?.classList.toggle('active',theme==='dark');
}
function toggleNotifications(){
    notificationsEnabled=!notificationsEnabled;
    document.getElementById('notifToggle')?.classList.toggle('active',notificationsEnabled);
    localStorage.setItem('notifications',notificationsEnabled);
    if(notificationsEnabled&&Notification.permission!=='granted')Notification.requestPermission();
}
function showNotification(text){
    if(!notificationsEnabled)return;
    var n=document.getElementById('notification');
    n.textContent=text;n.classList.add('show');
    setTimeout(function(){n.classList.remove('show')},3000);
    if(Notification.permission==='granted')new Notification('SecureChat',{body:text,icon:'/icon-192.png'});
}
function openSettings(){
    document.getElementById('settingsOverlay').style.display='flex';
    document.getElementById('settingsAvatar').innerHTML=currentUser?.avatar?'<img src="'+currentUser.avatar+'">':currentUser?.username?.charAt(0)||'👤';
    document.getElementById('themeToggle').classList.toggle('active',theme==='dark');
    document.getElementById('notifToggle').classList.toggle('active',notificationsEnabled);
}
function closeSettings(){document.getElementById('settingsOverlay').style.display='none'}
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open')}

function previewAvatar(input){
    if(input.files&&input.files[0]){
        var reader=new FileReader();
        reader.onload=function(e){
            regAvatarData=e.target.result;
            document.getElementById('regAvatar').innerHTML='<img src="'+e.target.result+'" style="width:100%;height:100%;object-fit:cover">';
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function login(){
    var u=document.getElementById('loginUsername').value.trim();
    var p=document.getElementById('loginPassword').value;
    if(!u||!p){showError('loginError','Заполните все поля');return}
    socket.emit('login',{username:u,password:p});
}

function register(){
    var u=document.getElementById('regUsername').value.trim();
    var e=document.getElementById('regEmail').value.trim();
    var p=document.getElementById('regPassword').value;
    var pc=document.getElementById('regPasswordConfirm').value;
    if(!u||!e||!p){showError('regError','Заполните все поля');return}
    if(u.length<3){showError('regError','Логин от 3 символов');return}
    if(!e.includes('@')){showError('regError','Введите корректный email');return}
    if(p.length<6){showError('regError','Пароль от 6 символов');return}
    if(p!==pc){showError('regError','Пароли не совпадают');return}
    socket.emit('register',{username:u,email:e,password:p,avatar:regAvatarData});
}

function verify2FA(){
    var code=document.getElementById('twoFACode').value.trim();
    if(!code)return;
    socket.emit('verify2FA',{userId:pending2FAUser,code:code});
}

function showError(id,msg){
    var el=document.getElementById(id);
    el.textContent=msg;el.style.display='block';
    setTimeout(function(){el.style.display='none'},3000);
}

function logout(){
    socket.emit('logout');
    currentUser=null;currentChat=null;allChats=[];
    document.getElementById('chatScreen').style.display='none';
    document.getElementById('loginScreen').style.display='flex';
    document.getElementById('sidebar').classList.remove('open');
    closeSettings();
}

function connectSocket(){
    socket=io({maxHttpBufferSize:1e7});
    
    socket.on('authSuccess',function(d){
        currentUser=d;
        document.getElementById('myUsername').textContent=d.username;
        document.getElementById('myAvatar').innerHTML=d.avatar?'<img src="'+d.avatar+'">':d.username.charAt(0).toUpperCase();
        document.getElementById('loginScreen').style.display='none';
        document.getElementById('registerScreen').style.display='none';
        document.getElementById('chatScreen').style.display='flex';
        allChats=d.chats||[];
        updateChatsList();
        theme=localStorage.getItem('theme')||'light';
        if(theme==='dark')document.body.classList.add('dark-theme');
        notificationsEnabled=localStorage.getItem('notifications')!=='false';
        if(notificationsEnabled&&Notification.permission!=='granted')Notification.requestPermission();
    });
    
    socket.on('authError',function(d){showError('loginError',d.message)});
    socket.on('regSuccess',function(){showLogin();showNotification('Аккаунт создан!')});
    socket.on('regError',function(d){showError('regError',d.message)});
    socket.on('require2FA',function(d){pending2FAUser=d.userId;document.getElementById('twoFAEmail').textContent='Код отправлен на '+d.email;document.getElementById('loginScreen').style.display='none';document.getElementById('twoFAScreen').style.display='flex'});
    socket.on('2FAError',function(d){showError('twoFAError',d.message)});
    
    socket.on('searchResults',function(u){
        allUsers=u.filter(function(x){return x.userId!==currentUser.userId});
        displaySearchResults(allUsers);
    });
    
    socket.on('chatMessages',function(d){
        if(currentChat===d.chatId)displayMessages(d.messages);
    });
    
    socket.on('newMessage',function(d){
        if(currentChat===d.chatId)appendMessage(d.message);
        updateChatPreview(d,true);
        if(document.hidden&&notificationsEnabled)showNotification('Новое сообщение от '+d.message.fromName);
    });
    
    socket.on('avatarUpdated',function(d){
        if(d.userId===currentUser.userId){
            currentUser.avatar=d.avatar;
            document.getElementById('myAvatar').innerHTML=d.avatar?'<img src="'+d.avatar+'">':currentUser.username.charAt(0).toUpperCase();
        }
        updateAllAvatars();
    });
    
    socket.on('emailUpdated',function(d){showNotification('Email обновлён')});
    socket.on('2FAEnabled',function(d){showNotification('2FA включена!')});
}

function searchUsers(){
    var query=document.getElementById('searchUser').value.trim();
    var resultsDiv=document.getElementById('searchResults');
    if(query.length>=2){
        socket.emit('searchUsers',{query:query});
    }else{
        resultsDiv.style.display='none';
    }
}

function displaySearchResults(users){
    var resultsDiv=document.getElementById('searchResults');
    if(!users.length){resultsDiv.style.display='none';return}
    var html='';
    users.forEach(function(u){
        html+='<div style="padding:12px;cursor:pointer;display:flex;align-items:center;gap:10px;border-radius:10px" onclick="startChat(\\''+u.userId+'\\',\\''+u.username.replace(/'/g,"\\\\'")+'\\',\\''+(u.avatar||'')+'\\')" onmouseover="this.style.background=\\'var(--bg-secondary)\\''" onmouseout="this.style.background=\\'none\\''">';
        html+='<div class="avatar" style="width:35px;height:35px;font-size:.8rem">'+(u.avatar?'<img src="'+u.avatar+'">':u.username.charAt(0).toUpperCase())+'</div>';
        html+='<span style="font-weight:500">'+u.username.replace(/</g,'&lt;')+'</span>';
        if(u.online)html+='<span style="width:8px;height:8px;background:#34c759;border-radius:50%;margin-left:auto"></span>';
        html+='</div>';
    });
    resultsDiv.innerHTML=html;
    resultsDiv.style.display='block';
}

function startChat(peerId,peerName,peerAvatar){
    currentChat=peerId;
    document.getElementById('chatHeader').style.display='flex';
    document.getElementById('chatTitle').textContent=peerName;
    document.getElementById('chatStatus').textContent='';
    document.getElementById('chatAvatar').innerHTML=peerAvatar?'<img src="'+peerAvatar+'">':peerName.charAt(0).toUpperCase();
    document.getElementById('inputContainer').style.display='flex';
    document.getElementById('messagesContainer').innerHTML='';
    socket.emit('getChat',{peerId:peerId});
    updateChatsList();
    document.getElementById('searchResults').style.display='none';
    document.getElementById('searchUser').value='';
    if(window.innerWidth<768)document.getElementById('sidebar').classList.remove('open');
}

function switchChat(chatId,peerName,peerAvatar){
    currentChat=chatId;
    document.getElementById('chatHeader').style.display='flex';
    document.getElementById('chatTitle').textContent=peerName;
    document.getElementById('chatAvatar
