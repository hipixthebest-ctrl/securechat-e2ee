const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

// Создаём папки
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Инициализация базы
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({users:{},chats:[]}));
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

const server = http.createServer(app);
const io = socketIO(server, {
    maxHttpBufferSize: 10 * 1024 * 1024
});

// Загрузить данные
function loadData() {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

// Сохранить данные
function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

io.on('connection', (socket) => {
    console.log('✅ User connected:', socket.id);
    let userId = null;

    // РЕГИСТРАЦИЯ
    socket.on('register', (data) => {
        const db = loadData();
        const { username, email, password } = data;
        
        // Проверка
        if (Object.values(db.users).find(u => u.username === username)) {
            return socket.emit('regError', 'Username already taken');
        }
        if (Object.values(db.users).find(u => u.email === email)) {
            return socket.emit('regError', 'Email already used');
        }
        
        // Создаём пользователя
        const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        db.users[id] = {
            userId: id,
            username: username,
            email: email,
            password: password,
            avatar: null,
            createdAt: Date.now()
        };
        
        saveData(db);
        console.log('📝 Registered:', username);
        socket.emit('regSuccess', 'Registration successful! Please login.');
    });

    // ЛОГИН
    socket.on('login', (data) => {
        const db = loadData();
        const { username, password } = data;
        
        const user = Object.values(db.users).find(u => 
            u.username === username && u.password === password
        );
        
        if (!user) {
            return socket.emit('authError', 'Invalid username or password');
        }
        
        userId = user.userId;
        socket.userId = userId;
        
        // Получаем чаты пользователя
        const chats = db.chats
            .filter(c => c.participants.includes(userId))
            .map(c => {
                const otherId = c.participants.find(p => p !== userId);
                const otherUser = db.users[otherId] || {};
                const lastMsg = c.messages[c.messages.length - 1];
                
                return {
                    id: c.id,
                    with: otherUser.username || 'Unknown',
                    withId: otherId,
                    avatar: otherUser.avatar,
                    lastMessage: lastMsg ? (lastMsg.text || '📷 Photo') : '',
                    lastTime: c.lastTime || Date.now(),
                    unread: 0
                };
            })
            .sort((a, b) => b.lastTime - a.lastTime);
        
        socket.emit('authSuccess', {
            userId: user.userId,
            username: user.username,
            email: user.email,
            avatar: user.avatar,
            chats: chats
        });
        
        console.log('🔑 Logged in:', username);
    });

    // ПОИСК ПОЛЬЗОВАТЕЛЕЙ
    socket.on('searchUsers', (query) => {
        if (!userId) return;
        const db = loadData();
        const q = query.toLowerCase();
        
        const results = Object.values(db.users)
            .filter(u => u.userId !== userId && u.username.toLowerCase().includes(q))
            .slice(0, 10)
            .map(u => ({
                userId: u.userId,
                username: u.username,
                email: u.email,
                avatar: u.avatar
            }));
        
        socket.emit('searchResults', results);
    });

    // СОЗДАТЬ/ОТКРЫТЬ ЧАТ
    socket.on('startChat', (data) => {
        if (!userId) return;
        const db = loadData();
        const chatId = [userId, data.userId].sort().join('_');
        
        let chat = db.chats.find(c => c.id === chatId);
        if (!chat) {
            chat = {
                id: chatId,
                participants: [userId, data.userId],
                messages: [],
                createdAt: Date.now(),
                lastTime: Date.now()
            };
            db.chats.push(chat);
            saveData(db);
        }
        
        const otherUser = db.users[data.userId];
        socket.emit('chatCreated', {
            id: chatId,
            with: data.username,
            withId: data.userId,
            avatar: data.avatar,
            lastMessage: '',
            lastTime: Date.now(),
            unread: 0
        });
        
        socket.emit('chatMessages', {
            chatId: chatId,
            messages: chat.messages,
            participants: chat.participants
        });
    });

    // ЗАГРУЗИТЬ ИСТОРИЮ ЧАТА
    socket.on('getChatHistory', (chatId) => {
        if (!userId) return;
        const db = loadData();
        const chat = db.chats.find(c => c.id === chatId);
        if (chat && chat.participants.includes(userId)) {
            socket.emit('chatMessages', {
                chatId: chatId,
                messages: chat.messages,
                participants: chat.participants
            });
        }
    });

    // ОТПРАВИТЬ СООБЩЕНИЕ
    socket.on('sendMessage', (data) => {
        if (!userId) return;
        const db = loadData();
        const chat = db.chats.find(c => c.id === data.chatId);
        
        if (!chat || !chat.participants.includes(userId)) return;
        
        const message = {
            id: Date.now().toString(36),
            from: userId,
            fromName: db.users[userId]?.username || 'Unknown',
            text: data.text,
            time: Date.now()
        };
        
        chat.messages.push(message);
        chat.lastTime = message.time;
        saveData(db);
        
        // Отправляем обоим участникам
        chat.participants.forEach(participantId => {
            io.sockets.sockets.forEach(s => {
                if (s.userId === participantId) {
                    s.emit('newMessage', {
                        chatId: data.chatId,
                        message: message
                    });
                }
            });
        });
    });

    // ОТПРАВИТЬ ИЗОБРАЖЕНИЕ
    socket.on('sendImage', (data) => {
        if (!userId) return;
        const db = loadData();
        const chat = db.chats.find(c => c.id === data.chatId);
        
        if (!chat || !chat.participants.includes(userId)) return;
        
        // Сохраняем изображение
        const base64Data = data.image.replace(/^data:image\/\w+;base64,/, '');
        const filename = Date.now() + '.jpg';
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), base64Data, 'base64');
        
        const message = {
            id: Date.now().toString(36),
            from: userId,
            fromName: db.users[userId]?.username || 'Unknown',
            image: '/uploads/' + filename,
            text: '📷 Photo',
            time: Date.now()
        };
        
        chat.messages.push(message);
        chat.lastTime = message.time;
        saveData(db);
        
        chat.participants.forEach(participantId => {
            io.sockets.sockets.forEach(s => {
                if (s.userId === participantId) {
                    s.emit('newMessage', {
                        chatId: data.chatId,
                        message: message
                    });
                }
            });
        });
    });

    // ВЫХОД
    socket.on('logout', () => {
        userId = null;
        socket.userId = null;
        console.log('🚪 User logged out:', socket.id);
    });

    // ОТКЛЮЧЕНИЕ
    socket.on('disconnect', () => {
        console.log('❌ User disconnected:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log('🚀 Chat server running on port', PORT);
});
