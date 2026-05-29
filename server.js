const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

// Создаём папку для загрузок
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 10 * 1024 * 1024 // 10 MB
});

// ============ РАБОТА С ДАННЫМИ ============
function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        const initial = { users: {}, chats: [] };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getChatId(u1, u2) {
    return [u1, u2].sort().join('_');
}

// ============ СОКЕТЫ ============
io.on('connection', (socket) => {
    console.log('✅ Подключился:', socket.id);
    let userId = null;

    // РЕГИСТРАЦИЯ
    socket.on('register', (data) => {
        const { username, email, password } = data;
        const db = loadData();
        
        if (Object.values(db.users).find(u => u.username === username)) {
            return socket.emit('regError', { message: 'Имя занято' });
        }
        if (Object.values(db.users).find(u => u.email === email)) {
            return socket.emit('regError', { message: 'Email занят' });
        }
        
        const id = crypto.randomBytes(16).toString('hex');
        db.users[id] = { userId: id, username, email, password, avatar: null, twoFA: false };
        saveData(db);
        console.log('📝 Новый:', username);
        socket.emit('regSuccess');
    });

    // ВХОД
    socket.on('login', (data) => {
        const { username, password } = data;
        const db = loadData();
        const user = Object.values(db.users).find(u => u.username === username && u.password === password);
        
        if (!user) {
            return socket.emit('authError', { message: 'Неверный логин или пароль' });
        }
        
        userId = user.userId;
        socket.userId = userId;
        
        // Собираем чаты
        const chats = db.chats
            .filter(c => c.participants.includes(userId))
            .map(c => {
                const otherId = c.participants.find(p => p !== userId);
                const other = db.users[otherId] || {};
                return {
                    id: c.id,
                    with: other.username || '?',
                    withId: otherId,
                    avatar: other.avatar || null,
                    lastMessage: c.lastMessage || '',
                    lastTime: c.lastTime || Date.now(),
                    unread: (c.unread || {})[userId] || 0
                };
            })
            .sort((a, b) => b.lastTime - a.lastTime);
        
        socket.emit('authSuccess', {
            userId: user.userId,
            username: user.username,
            email: user.email,
            avatar: user.avatar,
            chats
        });
        
        io.emit('onlineUsers', getOnline());
    });

    // ПОИСК
    socket.on('searchUsers', (query) => {
        if (!userId) return;
        const db = loadData();
        const q = query.toLowerCase();
        const results = Object.values(db.users)
            .filter(u => u.userId !== userId && u.username.toLowerCase().includes(q))
            .slice(0, 10)
            .map(u => ({ userId: u.userId, username: u.username, email: u.email, avatar: u.avatar }));
        socket.emit('searchResults', results);
    });

    // СОЗДАТЬ ЧАТ
    socket.on('startChat', (data) => {
        if (!userId) return;
        const db = loadData();
        const chatId = getChatId(userId, data.userId);
        let chat = db.chats.find(c => c.id === chatId);
        
        if (!chat) {
            chat = { id: chatId, participants: [userId, data.userId], messages: [], createdAt: Date.now(), lastTime: Date.now(), unread: {} };
            db.chats.push(chat);
            saveData(db);
        }
        
        socket.emit('chatCreated', {
            id: chatId,
            with: data.username,
            withId: data.userId,
            avatar: data.avatar,
            lastMessage: '',
            lastTime: Date.now(),
            unread: 0
        });
        
        socket.emit('chatMessages', { chatId, messages: chat.messages });
    });

    // ОТКРЫТЬ ЧАТ
    socket.on('openChat', (peerId) => {
        if (!userId) return;
        const chatId = getChatId(userId, peerId);
        const db = loadData();
        const chat = db.chats.find(c => c.id === chatId);
        if (chat) {
            if (chat.unread) chat.unread[userId] = 0;
            socket.emit('chatMessages', { chatId, messages: chat.messages });
            saveData(db);
        }
    });

    // ОТПРАВИТЬ СООБЩЕНИЕ
    socket.on('sendMessage', (data) => {
        if (!userId) return;
        const db = loadData();
        const chat = db.chats.find(c => c.id === data.chatId);
        if (!chat) return;
        
        const msg = { from: userId, fromName: db.users[userId]?.username || '?', text: data.text, time: Date.now() };
        chat.messages.push(msg);
        chat.lastMessage = data.text.substring(0, 50);
        chat.lastTime = msg.time;
        
        const other = chat.participants.find(p => p !== userId);
        if (other) {
            chat.unread = chat.unread || {};
            chat.unread[other] = (chat.unread[other] || 0) + 1;
        }
        
        saveData(db);
        io.emit('newMessage', { chatId: data.chatId, message: msg });
    });

    // ОТПРАВИТЬ КАРТИНКУ
    socket.on('sendImage', (data) => {
        if (!userId) return;
        const db = loadData();
        const chat = db.chats.find(c => c.id === data.chatId);
        if (!chat) return;
        
        const base64 = data.image.replace(/^data:image\/\w+;base64,/, '');
        const filename = Date.now() + '.jpg';
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), base64, 'base64');
        
        const msg = { from: userId, fromName: db.users[userId]?.username || '?', image: '/uploads/' + filename, text: '📷', time: Date.now() };
        chat.messages.push(msg);
        chat.lastMessage = '📷 Фото';
        chat.lastTime = msg.time;
        
        const other = chat.participants.find(p => p !== userId);
        if (other) {
            chat.unread = chat.unread || {};
            chat.unread[other] = (chat.unread[other] || 0) + 1;
        }
        
        saveData(db);
        io.emit('newMessage', { chatId: data.chatId, message: msg });
    });

    // АВАТАР
    socket.on('updateAvatar', (data) => {
        if (!userId) return;
        const db = loadData();
        db.users[userId].avatar = data.avatar;
        saveData(db);
        socket.emit('avatarUpdated', { userId, avatar: data.avatar });
    });

    // ВЫХОД
    socket.on('logout', () => {
        userId = null;
        socket.userId = null;
        io.emit('onlineUsers', getOnline());
    });

    socket.on('disconnect', () => {
        console.log('❌ Отключился:', socket.id);
        io.emit('onlineUsers', getOnline());
    });
});

function getOnline() {
    const online = [];
    io.sockets.sockets.forEach(s => { if (s.userId) online.push(s.userId); });
    return online;
}

// 🚀 ЗАПУСК
server.listen(PORT, () => {
    console.log('🚀 Сервер на порту', PORT);
});
