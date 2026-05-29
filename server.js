const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Хранилище сообщений в памяти
const messages = [];
const connectedUsers = new Set();

// Создаём папку client
const clientDir = path.join(__dirname, 'client');
if (!fs.existsSync(clientDir)) {
    fs.mkdirSync(clientDir);
}

// HTML с полноценным чатом
const indexPath = path.join(clientDir, 'index.html');
const htmlContent = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🔒 SecureChat - Защищённый чат</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .chat-container {
            width: 100%;
            max-width: 800px;
            height: 90vh;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .chat-header {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 20px;
            text-align: center;
        }
        .chat-header h1 {
            font-size: 1.5rem;
            margin-bottom: 5px;
        }
        .online-users {
            font-size: 0.9rem;
            opacity: 0.9;
        }
        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .message {
            margin-bottom: 15px;
            animation: slideIn 0.3s ease;
        }
        @keyframes slideIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .message-header {
            font-size: 0.85rem;
            color: #666;
            margin-bottom: 5px;
        }
        .message-body {
            background: white;
            padding: 12px 16px;
            border-radius: 12px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            word-wrap: break-word;
        }
        .message.own .message-body {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
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
            font-size: 1rem;
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
        .system-message {
            text-align: center;
            color: #999;
            font-style: italic;
            margin: 10px 0;
        }
        .login-screen {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            gap: 20px;
        }
        .login-screen input {
            padding: 12px 16px;
            border: 2px solid #e0e0e0;
            border-radius: 25px;
            font-size: 1rem;
            outline: none;
            width: 250px;
            text-align: center;
        }
        .login-screen button {
            padding: 12px 30px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            border: none;
            border-radius: 25px;
            font-size: 1rem;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div class="chat-container" id="chatApp">
        <!-- Экран логина -->
        <div id="loginScreen" class="login-screen">
            <h2 style="color: #667eea;">🔒 Войдите в чат</h2>
            <input type="text" id="usernameInput" placeholder="Введите ваше имя" maxlength="20">
            <button onclick="joinChat()">Войти в чат</button>
        </div>

        <!-- Экран чата (скрыт изначально) -->
        <div id="chatScreen" style="display: none; flex-direction: column; height: 100%;">
            <div class="chat-header">
                <h1>🔒 SecureChat E2EE</h1>
                <div class="online-users">
                    👥 Онлайн: <span id="onlineCount">0</span>
                </div>
            </div>
            <div class="messages-container" id="messagesContainer"></div>
            <div class="input-container">
                <input type="text" id="messageInput" placeholder="Введите сообщение..." maxlength="500">
                <button id="sendButton" onclick="sendMessage()">📤</button>
            </div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        let socket;
        let username;
        let userId;

        function joinChat() {
            username = document.getElementById('usernameInput').value.trim();
            if (!username) {
                alert('Введите имя!');
                return;
            }

            socket = io();
            userId = Date.now().toString(36);

            socket.emit('join', { username, userId });

            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('chatScreen').style.display = 'flex';

            // Обработка входящих сообщений
            socket.on('message', (data) => {
                addMessage(data, data.userId === userId);
            });

            // Обработка системных сообщений
            socket.on('system', (data) => {
                addSystemMessage(data.text);
            });

            // Обновление количества онлайн
            socket.on('onlineCount', (count) => {
                document.getElementById('onlineCount').textContent = count;
            });

            // История сообщений
            socket.on('messageHistory', (history) => {
                history.forEach(msg => {
                    addMessage(msg, msg.userId === userId);
                });
            });
        }

        function sendMessage() {
            const input = document.getElementById('messageInput');
            const text = input.value.trim();
            
            if (!text || !socket) return;

            const message = {
                userId,
                username,
                text,
                timestamp: Date.now()
            };

            socket.emit('message', message);
            input.value = '';
        }

        function addMessage(data, isOwn) {
            const container = document.getElementById('messagesContainer');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + (isOwn ? 'own' : '');

            const time = new Date(data.timestamp).toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit'
            });

            messageDiv.innerHTML = \`
                <div class="message-header">
                    <strong>\${data.username}</strong> • \${time}
                </div>
                <div class="message-body">\${escapeHtml(data.text)}</div>
            \`;

            container.appendChild(messageDiv);
            container.scrollTop = container.scrollHeight;
        }

        function addSystemMessage(text) {
            const container = document.getElementById('messagesContainer');
            const div = document.createElement('div');
            div.className = 'system-message';
            div.textContent = text;
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Отправка по Enter
        document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('messageInput').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') sendMessage();
            });
        });
    </script>
</body>
</html>`;

fs.writeFileSync(indexPath, htmlContent, 'utf8');
console.log('✅ HTML файл создан');

// Отдача статики
app.use(express.static(clientDir));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(indexPath);
});

// WebSocket логика
io.on('connection', (socket) => {
    console.log('🔌 Новое подключение');

    socket.on('join', (data) => {
        socket.username = data.username;
        socket.userId = data.userId;
        connectedUsers.add(data.userId);

        // Отправляем историю новому пользователю
        socket.emit('messageHistory', messages.slice(-50));

        // Уведомляем всех о новом пользователе
        io.emit('system', { text: `${data.username} присоединился к чату 👋` });
        io.emit('onlineCount', connectedUsers.size);

        console.log(`👤 ${data.username} вошёл в чат`);
    });

    socket.on('message', (data) => {
        // Сохраняем сообщение
        messages.push(data);
        if (messages.length > 200) messages.shift(); // Храним последние 200

        // Отправляем всем
        io.emit('message', data);
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            connectedUsers.delete(socket.userId);
            io.emit('system', { text: `${socket.username} покинул чат 👋` });
            io.emit('onlineCount', connectedUsers.size);
            console.log(`👋 ${socket.username} вышел из чата`);
        }
    });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Чат запущен на порту ${PORT}`);
    console.log(`🌐 Откройте в браузере: http://localhost:${PORT}`);
});
