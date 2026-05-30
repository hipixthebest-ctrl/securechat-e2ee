const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.static('public'));
app.use(express.json());

// ========== HTML ==========
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SecureChat E2EE</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <div id="login-screen" class="screen active">
        <h1>SecureChat</h1>
        <input type="text" id="username" placeholder="Имя пользователя">
        <button onclick="login()">Войти</button>
    </div>

    <div id="chats-screen" class="screen">
        <h1>Чаты</h1>
        <div id="contacts"></div>
        <button onclick="showScreen('settings')">Настройки</button>
    </div>

    <div id="chat-screen" class="screen">
        <button onclick="goBack()">← Назад</button>
        <div id="messages"></div>
        <input type="text" id="message-input" placeholder="Сообщение...">
        <button onclick="sendMessage()">Отправить</button>
    </div>

    <div id="settings-screen" class="screen">
        <h1>Настройки</h1>
        <button onclick="goBack()">← Назад</button>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let currentUser = null;
        let currentChat = null;

        function login() {
            const username = document.getElementById('username').value;
            if (username) {
                currentUser = username;
                socket.emit('login', { username });
                showScreen('chats');
            }
        }

        function showScreen(screen) {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            const screenMap = { 
                'login': 'login-screen', 
                '2fa': '2fa-screen', 
                'chats': 'chats-screen', 
                'chat': 'chat-screen', 
                'settings': 'settings-screen' 
            };
            const screenId = screenMap[screen] || screen;
            const element = document.getElementById(screenId);
            if (element) {
                element.classList.add('active');
            }
        }

        function goBack() {
            document.getElementById('chat-screen').classList.remove('active');
            document.getElementById('chats-screen').classList.add('active');
            loadContacts();
        }

        function loadContacts() {
            socket.emit('get_contacts');
        }

        function sendMessage() {
            const input = document.getElementById('message-input');
            const message = input.value;
            if (message && currentChat) {
                socket.emit('send_message', { 
                    to: currentChat, 
                    message: message 
                });
                input.value = '';
            }
        }

        socket.on('contacts', (contacts) => {
            const contactsDiv = document.getElementById('contacts');
            contactsDiv.innerHTML = contacts.map(c => 
                \`<div onclick="openChat('\${c}')">\${c}</div>\`
            ).join('');
        });

        socket.on('message', (data) => {
            const messagesDiv = document.getElementById('messages');
            messagesDiv.innerHTML += \`<div><strong>\${data.from}:</strong> \${data.message}</div>\`;
        });

        window.openChat = function(user) {
            currentChat = user;
            showScreen('chat');
        };

        loadContacts();
    </script>
</body>
</html>`);
});

// Socket.io events
const users = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('login', (data) => {
        users.set(socket.id, { username: data.username, socketId: socket.id });
        io.emit('user_online', { username: data.username });
    });

    socket.on('get_contacts', () => {
        const contacts = Array.from(users.values())
            .map(u => u.username)
            .filter(u => u !== users.get(socket.id)?.username);
        socket.emit('contacts', contacts);
    });

    socket.on('send_message', (data) => {
        const recipientUser = Array.from(users.entries())
            .find(([_, user]) => user.username === data.to);
        
        if (recipientUser) {
            io.to(recipientUser[0]).emit('message', {
                from: users.get(socket.id)?.username,
                message: data.message
            });
        }
    });

    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            users.delete(socket.id);
            io.emit('user_offline', { username: user.username });
        }
        console.log('User disconnected:', socket.id);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
