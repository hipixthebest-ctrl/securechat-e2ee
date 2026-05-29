const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ============ БАЗА ДАННЫХ В ПАМЯТИ ============
const accounts = new Map(); // username -> { password, userId, chats: Map(chatId -> [messages]) }
const sessions = new Map(); // sessionToken -> { username, userId }
const onlineUsers = new Map(); // userId -> { username, socketId }

// Создаём папку client
const clientDir = path.join(__dirname, 'client');
if (!fs.existsSync(clientDir)) {
    fs.mkdirSync(clientDir);
}

// ============ HTML ФАЙЛ ============
const indexPath = path.join(clientDir, 'index.html');
const htmlContent = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🔒 SecureChat - Аккаунты и ЛС</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            height: 100vh;
        }

        /* ===== ЭКРАНЫ АВТОРИЗАЦИИ ===== */
        .auth-screen {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            padding: 20px;
        }
        .auth-box {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            width: 100%;
            max-width: 400px;
            text-align: center;
        }
        .auth-box h2 {
            color: #667eea;
            margin-bottom: 10px;
            font-size: 2rem;
        }
        .auth-box p {
            color: #666;
            margin-bottom: 25px;
        }
        .auth-input {
            width: 100%;
            padding: 12px 16px;
            margin-bottom: 15px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            font-size: 1rem;
            outline: none;
            transition: border-color 0.3s;
        }
        .auth-input:focus {
            border-color: #667eea;
        }
        .auth-button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 1.1rem;
            cursor: pointer;
            margin-bottom: 15px;
            font-weight: 500;
            transition: transform 0.2s;
        }
        .auth-button:hover {
            transform: scale(1.02);
        }
        .auth-button:active {
            transform: scale(0.98);
        }
        .auth-link {
            color: #667eea;
            cursor: pointer;
            text-decoration: underline;
        }
        .auth-link:hover {
            color: #764ba2;
        }
        .error-message {
            color: #f44336;
            margin: 10px 0;
            font-size: 0.9rem;
        }

        /* ===== ИНТЕРФЕЙС ЧАТА ===== */
        .app-container {
            max-width: 1200px;
            height: 90vh;
            margin: 5vh auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            display: flex;
            overflow: hidden;
        }
        .sidebar {
            width: 300px;
            background: #f8f9fa;
            border-right: 1px solid #e0e0e0;
            display: flex;
            flex-direction: column;
        }
        .sidebar-header {
            padding: 20px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
        }
        .sidebar-header .user-info {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .sidebar-header h2 {
            font-size: 1.2rem;
        }
        .logout-btn {
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            padding: 5px 12px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 0.8rem;
        }
        .logout-btn:hover {
            background: rgba(255,255,255,0.3);
        }
        #searchUser {
            width: 100%;
            padding: 8px 12px;
            border: none;
            border-radius: 20px;
            font-size: 0.9rem;
            outline: none;
        }
        .chats-list {
            flex: 1;
            overflow-y: auto;
        }
        .chat-item {
            padding: 15px 20px;
            cursor: pointer;
            border-bottom: 1px solid #eee;
            transition: background 0.2s;
        }
        .chat-item:hover {
            background: #e3f2fd;
        }
        .chat-item.active {
            background: #bbdefb;
            border-left: 3px solid #667eea;
        }
        .chat-item-name {
            font-weight: 500;
            color: #333;
        }
        .chat-item-last {
            font-size: 0.8rem;
            color: #999;
            margin-top: 3px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .chat-item-time {
            font-size: 0.7rem;
            color: #bbb;
            float: right;
        }
        .users-section {
            border-top: 2px solid #e0e0e0;
            padding: 10px;
            background: white;
        }
        .users-section-title {
            font-size: 0.8rem;
            color: #999;
            text-transform: uppercase;
            padding: 5px 12px;
            letter-spacing: 1px;
        }
        .online-user {
            padding: 8px 12px;
            margin: 3px 0;
            cursor: pointer;
            border-radius: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: background 0.2s;
        }
        .online-user:hover {
            background: #e3f2fd;
        }
        .online-dot {
            width: 8px;
            height: 8px;
            background: #4caf50;
            border-radius: 50%;
        }
        .chat-area {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        .chat-header {
            padding: 20px;
            background: white;
            border-bottom: 1px solid #e0e0e0;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .chat-header h3 {
            color: #333;
            flex: 1;
        }
        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            background: #f5f5f5;
            display: flex;
            flex-direction: column;
        }
        .message {
            margin-bottom: 15px;
            display: flex;
            flex-direction: column;
            animation: slideIn 0.3s ease;
        }
        .message.own {
            align-items: flex-end;
        }
        @keyframes slideIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .message-info {
            font-size: 0.7rem;
            color: #999;
            margin-bottom: 2px;
        }
        .message-bubble {
            padding: 10px 16px;
            border-radius: 18px;
            max-width: 70%;
            word-wrap: break-word;
            font-size: 0.95rem;
        }
        .message.other .message-bubble {
            background: white;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            border-bottom-left-radius: 5px;
        }
        .message.own .message-bubble {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            border-bottom-right-radius: 5px;
        }
        .input-container {
            padding: 20px;
            background: white;
            display: flex;
            gap: 10px;
            border-top: 1px solid #eee;
        }
        #messageInput {
            flex: 1;
            padding: 12px 16px;
            border: 2px solid #e0e0e0;
            border-radius: 25px;
            font-size: 0.95rem;
            outline: none;
            transition: border-color 0.3s;
        }
        #messageInput:focus {
            border-color: #667eea;
        }
        #sendButton {
            padding: 12px 25px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            border: none;
            border-radius: 25px;
            font-size: 1rem;
            cursor: pointer;
            transition: transform 0.2s;
        }
        #sendButton:hover {
            transform: scale(1.05);
        }
        #sendButton:active {
            transform: scale(0.95);
        }
        .no-chat {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #999;
            font-size: 1.1rem;
        }
    </style>
</head>
<body>
    <!-- ЭКРАН ВХОДА -->
    <div id="loginScreen" class="auth-screen">
        <div class="auth-box">
            <h2>🔒 SecureChat</h2>
            <p>Войдите в аккаунт</p>
            <input type="text" id="loginUsername" class="auth-input" placeholder="Имя пользователя" maxlength="20">
            <input type="password" id="loginPassword" class="auth-input" placeholder="Пароль">
            <div class="error-message" id="loginError" style="display: none;"></div>
            <button class="auth-button" onclick="login()">Войти</button>
            <p>Нет аккаунта? <span class="auth-link" onclick="showRegister()">Создать</span></p>
        </div>
    </div>

    <!-- ЭКРАН РЕГИСТРАЦИИ -->
    <div id="registerScreen" class="auth-screen" style="display: none;">
        <div class="auth-box">
            <h2>📝 Регистрация</h2>
            <p>Создайте новый аккаунт</p>
            <input type="text" id="regUsername" class="auth-input" placeholder="Имя пользователя" maxlength="20">
            <input type="password" id="regPassword" class="auth-input" placeholder="Пароль">
            <input type="password" id="regPasswordConfirm" class="auth-input" placeholder="Подтвердите пароль">
            <div class="error-message" id="regError" style="display: none;"></div>
            <button class="auth-button" onclick="register()">Создать аккаунт</button>
            <p>Уже есть аккаунт? <span class="auth-link" onclick="showLogin()">Войти</span></p>
        </div>
    </div>

    <!-- ИНТЕРФЕЙС ЧАТА -->
    <div id="chatScreen" style="display: none;" class="app-container">
        <div class="sidebar">
            <div class="sidebar-header">
                <div class="user-info">
                    <h2>💬 Чаты</h2>
                    <button class="logout-btn" onclick="logout()">Выйти</button>
                </div>
                <div id="currentUsername" style="font-size: 0.9rem; opacity: 0.9;"></div>
                <input type="text" id="searchUser" placeholder="🔍 Поиск пользователя..." onkeyup="filterUsers()" style="margin-top: 10px;">
            </div>
            <div class="chats-list" id="chatsList"></div>
            <div class="users-section">
                <div class="users-section-title">Онлайн пользователи</div>
                <div id="usersList"></div>
            </div>
        </div>

        <div class="chat-area">
            <div class="chat-header">
                <h3 id="chatTitle">Выберите чат</h3>
            </div>
            <div class="messages-container" id="messagesContainer">
                <div class="no-chat">👈 Выберите пользователя для начала переписки</div>
            </div>
            <div class="input-container" id="inputContainer" style="display: none;">
                <input type="text" id="messageInput" placeholder="Введите сообщение..." maxlength="500">
                <button id="sendButton" onclick="sendMessage()">📤</button>
            </div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        let socket;
        let currentUser = null;
        let currentChat = null;
        let allChats = [];
        let onlineUsersList = [];

        // ===== АВТОРИЗАЦИЯ =====
        function showRegister() {
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('registerScreen').style.display = 'flex';
        }

        function showLogin() {
            document.getElementById('registerScreen').style.display = 'none';
            document.getElementById('loginScreen').style.display = 'flex';
        }

        function login() {
            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value;

            if (!username || !password) {
                showError('loginError', 'Заполните все поля');
                return;
            }

            socket.emit('login', { username, password });
        }

        function register() {
            const username = document.getElementById('regUsername').value.trim();
            const password = document.getElementById('regPassword').value;
            const passwordConfirm = document.getElementById('regPasswordConfirm').value;

            document.getElementById('regError').style.display = 'none';

            if (!username || !password) {
                showError('regError', 'Заполните все поля');
                return;
            }
            if (username.length < 3) {
                showError('regError', 'Имя должно быть от 3 символов');
                return;
            }
            if (password.length < 4) {
                showError('regError', 'Пароль должен быть от 4 символов');
                return;
            }
            if (password !== passwordConfirm) {
                showError('regError', 'Пароли не совпадают');
                return;
            }

            socket.emit('register', { username, password });
        }

        function showError(elementId, message) {
            const el = document.getElementById(elementId);
            el.textContent = message;
            el.style.display = 'block';
            setTimeout(() => { el.style.display = 'none'; }, 3000);
        }

        function logout() {
            socket.emit('logout');
            socket.disconnect();
            currentUser = null;
            currentChat = null;
            allChats = [];
            document.getElementById('chatScreen').style.display = 'none';
            document.getElementById('loginScreen').style.display = 'flex';
            document.getElementById('loginUsername').value = '';
            document.getElementById('loginPassword').value = '';
        }

        // ===== ПОДКЛЮЧЕНИЕ =====
        function connectSocket() {
            socket = io();

            socket.on('authSuccess', (data) => {
                currentUser = data;
                document.getElementById('currentUsername').textContent = '👤 ' + data.username;
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('registerScreen').style.display = 'none';
                document.getElementById('chatScreen').style.display = 'flex';

                // Загружаем чаты
                allChats = data.chats || [];
                updateChatsList();
            });

            socket.on('authError', (data) => {
                showError('loginError', data.message);
            });

            socket.on('regSuccess', () => {
                showLogin();
                document.getElementById('loginUsername').value = document.getElementById('regUsername').value;
                alert('✅ Аккаунт создан! Теперь войдите.');
            });

            socket.on('regError', (data) => {
                showError('regError', data.message);
            });

            socket.on('onlineUsers', (users) => {
                onlineUsersList = users.filter(u => u.username !== currentUser?.username);
                filterUsers();
            });

            socket.on('chatMessages', (data) => {
                if (currentChat === data.chatId) {
                    displayMessages(data.messages);
                }
            });

            socket.on('newMessage', (data) => {
                if (currentChat === data.chatId) {
                    appendMessage(data.message);
                }
                updateChatPreview(data);
            });
        }

        // ===== ЧАТЫ =====
        function filterUsers() {
            const searchTerm = document.getElementById('searchUser')?.value?.toLowerCase() || '';
            const usersList = document.getElementById('usersList');
            
            let html = '';
            onlineUsersList
                .filter(u => u.username.toLowerCase().includes(searchTerm))
                .forEach(user => {
                    html += \`
                        <div class="online-user" onclick="startChat('\${user.userId}', '\${user.username}')">
                            <span class="online-dot"></span>
                            <span>\${escapeHtml(user.username)}</span>
                        </div>
                    \`;
                });
            usersList.innerHTML = html || '<div style="padding: 10px; color: #999; font-size: 0.9rem;">Нет пользователей</div>';
        }

        function startChat(peerId, peerName) {
            currentChat = peerId;
            document.getElementById('chatTitle').textContent = '💬 ' + peerName;
            document.getElementById('inputContainer').style.display = 'flex';
            document.getElementById('messagesContainer').innerHTML = '';
            
            socket.emit('getChat', { peerId });
            updateChatsList();
        }

        function switchChat(chatId, peerName) {
            currentChat = chatId;
            document.getElementById('chatTitle').textContent = '💬 ' + peerName;
            document.getElementById('inputContainer').style.display = 'flex';
            document.getElementById('messagesContainer').innerHTML = '';
            
            socket.emit('getChat', { chatId });
            updateChatsList();
        }

        function sendMessage() {
            const input = document.getElementById('messageInput');
            const text = input.value.trim();
            
            if (!text || !currentChat) return;

            socket.emit('sendMessage', { to: currentChat, text });
            input.value = '';
        }

        function displayMessages(messages) {
            const container = document.getElementById('messagesContainer');
            container.innerHTML = '';
            if (messages && messages.length > 0) {
                messages.forEach(msg => appendMessage(msg));
            }
            container.scrollTop = container.scrollHeight;
        }

        function appendMessage(msg) {
            const container = document.getElementById('messagesContainer');
            const div = document.createElement('div');
            const isOwn = msg.from === currentUser.userId;
            
            div.className = 'message ' + (isOwn ? 'own' : 'other');

            const time = new Date(msg.timestamp).toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit'
            });

            div.innerHTML = \`
                <div class="message-info">\${time}</div>
                <div class="message-bubble">\${escapeHtml(msg.text)}</div>
            \`;

            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        }

        function updateChatPreview(data) {
            let chat = allChats.find(c => c.id === data.chatId);
            if (!chat) {
                const peerName = data.message.fromName || 'Пользователь';
                chat = { id: data.chatId, with: peerName, messages: [] };
                allChats.push(chat);
            }
            chat.lastMessage = data.message.text;
            chat.lastTime = data.message.timestamp;
            updateChatsList();
        }

        function updateChatsList() {
            const chatsList = document.getElementById('chatsList');
            let html = '';
            
            allChats.forEach(chat => {
                const timeStr = chat.lastTime ? new Date(chat.lastTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
                html += \`
                    <div class="chat-item \${currentChat === chat.id ? 'active' : ''}" onclick="switchChat('\${chat.id}', '\${chat.with}')">
                        <div class="chat-item-name">\${escapeHtml(chat.with)}</div>
                        <div class="chat-item-last">\${escapeHtml(chat.lastMessage || 'Нет сообщений')}</div>
                        <div class="chat-item-time">\${timeStr}</div>
                    </div>
                \`;
            });
            
            chatsList.innerHTML = html || '<div style="padding: 20px; text-align: center; color: #999;">У вас пока нет чатов</div>';
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        }

        // ===== ИНИЦИАЛИЗАЦИЯ =====
        connectSocket();

        document.addEventListener('DOMContentLoaded', () => {
            document.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    if (document.getElementById('loginScreen').style.display !== 'none' && document.getElementById('loginScreen').style.display !== 'none') {
                        login();
                    } else if (document.getElementById('registerScreen').style.display === 'flex') {
                        register();
                    } else if (document.getElementById('chatScreen').style.display === 'flex') {
                        sendMessage();
                    }
                }
            });
        });
    </script>
</body>
</html>`;

fs.writeFileSync(indexPath, htmlContent, 'utf8');
console.log('✅ HTML создан с системой аккаунтов');

app.use(express.static(clientDir));
app.get('/', (req, res) => {
    res.sendFile(indexPath);
});

// ============ СОКЕТ ЛОГИКА ============
io.on('connection', (socket) => {
    console.log('🔌 Новое подключение');

    // === РЕГИСТРАЦИЯ ===
    socket.on('register', (data) => {
        const { username, password } = data;
        const userKey = username.toLowerCase();

        if (accounts.has(userKey)) {
            socket.emit('regError', { message: 'Пользователь уже существует' });
            return;
        }

        const userId = 'usr_' + crypto.randomBytes(8).toString('hex');
        const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

        accounts.set(userKey, {
            password: hashedPassword,
            userId,
            username,
            chats: new Map()
        });

        console.log(\`✅ Зарегистрирован: \${username}\`);
        socket.emit('regSuccess');
    });

    // === ВХОД ===
    socket.on('login', (data) => {
        const { username, password } = data;
        const userKey = username.toLowerCase();
        
        const account = accounts.get(userKey);

        if (!account) {
            socket.emit('authError', { message: 'Аккаунт не найден' });
            return;
        }

        const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

        if (account.password !== hashedPassword) {
            socket.emit('authError', { message: 'Неверный пароль' });
            return;
        }

        // Создаём сессию
        const sessionToken = crypto.randomBytes(16).toString('hex');
        sessions.set(sessionToken, { username: account.username, userId: account.userId });

        // Сохраняем в онлайне
        onlineUsers.set(account.userId, {
            username: account.username,
            socketId: socket.id
        });

        socket.userId = account.userId;
        socket.username = account.username;

        // Формируем список чатов
        const userChats = [];
        account.chats.forEach((messages, chatId) => {
            const parts = chatId.split('_');
            const peerId = parts.find(p => p !== account.userId);
            const peerAccount = Array.from(accounts.values()).find(a => a.userId === peerId);
            const lastMsg = messages[messages.length - 1];
            
            userChats.push({
                id: chatId,
                with: peerAccount ? peerAccount.username : 'Неизвестный',
                lastMessage: lastMsg?.text || '',
                lastTime: lastMsg?.timestamp || 0
            });
        });

        socket.emit('authSuccess', {
            userId: account.userId,
            username: account.username,
            chats: userChats.sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0))
        });

        // Уведомляем всех о новом онлайне
        broadcastOnlineUsers();
        console.log(\`👤 \${username} вошёл в систему\`);
    });

    // === ПОЛУЧИТЬ ЧАТ ===
    socket.on('getChat', (data) => {
        if (!socket.userId) return;

        const peerId = data.peerId || data.chatId;
        const chatId = [socket.userId, peerId].sort().join('_');
        
        const account = getAccountByUserId(socket.userId);
        if (!account) return;

        const messages = account.chats.get(chatId) || [];
        
        socket.emit('chatMessages', {
            chatId,
            messages
        });
    });

    // === ОТПРАВИТЬ СООБЩЕНИЕ ===
    socket.on('sendMessage', (data) => {
        if (!socket.userId) return;

        const chatId = [socket.userId, data.to].sort().join('_');
        const message = {
            from: socket.userId,
            fromName: socket.username,
            to: data.to,
            text: data.text,
            timestamp: Date.now()
        };

        // Сохраняем у отправителя
        const senderAccount = getAccountByUserId(socket.userId);
        if (senderAccount) {
            if (!senderAccount.chats.has(chatId)) {
                senderAccount.chats.set(chatId, []);
            }
            senderAccount.chats.get(chatId).push(message);
        }

        // Сохраняем у получателя
        const receiverAccount = getAccountByUserId(data.to);
        if (receiverAccount) {
            if (!receiverAccount.chats.has(chatId)) {
                receiverAccount.chats.set(chatId, []);
            }
            receiverAccount.chats.get(chatId).push(message);
        }

        // Отправляем получателю если онлайн
        const receiver = onlineUsers.get(data.to);
        if (receiver) {
            io.to(receiver.socketId).emit('newMessage', {
                chatId,
                message
            });
        }

        // Отправляем отправителю
        socket.emit('newMessage', {
            chatId,
            message
        });
    });

    // === ВЫХОД ===
    socket.on('logout', () => {
        if (socket.userId) {
            onlineUsers.delete(socket.userId);
            broadcastOnlineUsers();
            console.log(\`👋 \${socket.username} вышел\`);
        }
    });

    // === ОТКЛЮЧЕНИЕ ===
    socket.on('disconnect', () => {
        if (socket.userId) {
            onlineUsers.delete(socket.userId);
            broadcastOnlineUsers();
        }
    });
});

function getAccountByUserId(userId) {
    for (const [key, account] of accounts) {
        if (account.userId === userId) return account;
    }
    return null;
}

function broadcastOnlineUsers() {
    const users = Array.from(onlineUsers.values()).map(u => ({
        userId: Array.from(onlineUsers.entries()).find(([id]) => onlineUsers.get(id) === u)[0],
        username: u.username
    }));
    io.emit('onlineUsers', users);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(\`✅ Сервер с аккаунтами запущен на порту \${PORT}\`);
    console.log('🔐 Функции: Регистрация, Вход, История чатов, Личные сообщения');
});
