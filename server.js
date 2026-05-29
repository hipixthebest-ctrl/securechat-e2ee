const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const nodemailer = require('nodemailer');

// ==================== КОНФИГ ====================
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const clientDir = path.join(__dirname, 'public');

// ==================== EMAIL (ДЛЯ 2FA) ====================
// ЗАМЕНИ НА СВОИ ДАННЫЕ
const EMAIL_USER = 'твой@gmail.com';
const EMAIL_PASS = 'твой_пароль_приложений';
const EMAIL_FROM = 'SecureChat <твой@gmail.com>';

const transporter = EMAIL_USER.includes('твой') ? null : nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

// ==================== EXPRESS + SOCKET.IO ====================
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(clientDir));

const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 50 * 1024 * 1024
});

// ==================== УТИЛИТЫ ====================
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, JSON.stringify({ users: {}, chats: [] }, null, 2));
            return { users: {}, chats: [] };
        }
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    } catch (e) {
        console.error('Ошибка загрузки данных:', e);
        return { users: {}, chats: [] };
    }
}

function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Ошибка сохранения:', e);
    }
}

// Генерация ID из пары пользователей
function getChatId(user1, user2) {
    return [user1, user2].sort().join('_');
}

// Получить данные пользователя по ID
function getUserById(userId) {
    const data = loadData();
    return data.users[userId] || null;
}

// Получить имя пользователя
function getUserName(userId) {
    const user = getUserById(userId);
    return user ? user.username : 'Неизвестный';
}

// ==================== САМЫЙ ГЛАВНЫЙ ОБРАБОТЧИК ====================
io.on('connection', (socket) => {
    console.log('🔌 Клиент подключился:', socket.id);

    let currentUserId = null;

    // ==================== РЕГИСТРАЦИЯ ====================
    socket.on('register', (req) => {
        const { username, email, password } = req;

        if (!username || !email || !password) {
            return socket.emit('regError', { message: 'Заполните все поля' });
        }

        if (username.length < 3) {
            return socket.emit('regError', { message: 'Имя минимум 3 символа' });
        }

        if (!email.includes('@') || !email.includes('.')) {
            return socket.emit('regError', { message: 'Некорректный email' });
        }

        if (password.length < 6) {
            return socket.emit('regError', { message: 'Пароль минимум 6 символов' });
        }

        const data = loadData();

        // Проверяем занятость имени
        if (Object.values(data.users).some(u => u.username === username)) {
            return socket.emit('regError', { message: 'Имя уже занято' });
        }

        // Проверяем занятость email
        if (Object.values(data.users).some(u => u.email === email)) {
            return socket.emit('regError', { message: 'Email уже используется' });
        }

        const userId = crypto.randomBytes(16).toString('hex');
        const hashedPassword = bcrypt.hashSync(password, 10);

        data.users[userId] = {
            userId,
            username,
            email,
            password: hashedPassword,
            avatar: null,
            twoFactorSecret: null,
            twoFactorEnabled: false,
            createdAt: Date.now()
        };

        saveData(data);
        console.log('✅ Новый пользователь:', username);
        socket.emit('regSuccess');
    });

    // ==================== ВХОД ====================
    socket.on('login', (req) => {
        const { username, password } = req;

        if (!username || !password) {
            return socket.emit('authError', { message: 'Заполните все поля' });
        }

        const data = loadData();
        const user = Object.values(data.users).find(u => u.username === username);

        if (!user) {
            return socket.emit('authError', { message: 'Пользователь не найден' });
        }

        if (!bcrypt.compareSync(password, user.password)) {
            return socket.emit('authError', { message: 'Неверный пароль' });
        }

        // Проверяем 2FA
        if (user.twoFactorEnabled && user.twoFactorSecret) {
            // Если email настроен — отправляем код
            if (transporter) {
                const token = speakeasy.totp({
                    secret: user.twoFactorSecret,
                    encoding: 'base32'
                });

                transporter.sendMail({
                    from: EMAIL_FROM,
                    to: user.email,
                    subject: 'SecureChat — Код 2FA',
                    text: `Твой код подтверждения: ${token}\n\nДействителен 30 секунд.`
                }).catch(err => {
                    console.error('Ошибка отправки email:', err);
                });
            }

            // Показываем модалку 2FA
            socket.emit('require2FA', {
                userId: user.userId,
                email: user.email
            });
            return;
        }

        // Всё ок — авторизуем
        finishLogin(socket, user, data);
    });

    // ==================== ПРОВЕРКА 2FA ====================
    socket.on('verify2FA', (req) => {
        const { userId, code } = req;
        const data = loadData();
        const user = data.users[userId];

        if (!user || !user.twoFactorSecret) {
            return socket.emit('2FAError', { message: 'Ошибка. Войдите заново.' });
        }

        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token: code,
            window: 1 // 30 сек
        });

        if (!verified) {
            return socket.emit('2FAError', { message: 'Неверный код. Попробуй снова.' });
        }

        finishLogin(socket, user, data);
    });

    function finishLogin(socket, user, data) {
        currentUserId = user.userId;
        socket.userId = user.userId;

        // Собираем чаты пользователя
        const userChats = data.chats
            .filter(chat => chat.participants.includes(user.userId))
            .map(chat => {
                const otherUserId = chat.participants.find(id => id !== user.userId);
                const otherUser = data.users[otherUserId] || {};
                return {
                    id: chat.id,
                    with: otherUser.username || 'Неизвестный',
                    withId: otherUserId,
                    avatar: otherUser.avatar || null,
                    lastMessage: chat.lastMessage || 'Нет сообщений',
                    lastTime: chat.lastTime || chat.createdAt,
                    unread: (chat.unreadBy || {})[user.userId] || 0
                };
            })
            .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));

        console.log('✅ Пользователь вошёл:', user.username);

        socket.emit('authSuccess', {
            userId: user.userId,
            username: user.username,
            email: user.email,
            avatar: user.avatar || null,
            chats: userChats
        });

        // Оповещаем всех об онлайне
        io.emit('onlineUsers', getOnlineUsers());
    }

    // ==================== ПОИСК ПОЛЬЗОВАТЕЛЕЙ ====================
    socket.on('searchUsers', (query) => {
        if (!currentUserId) return;

        const data = loadData();
        const q = query.toLowerCase();

        const results = Object.values(data.users)
            .filter(u =>
                u.userId !== currentUserId &&
                (u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
            )
            .map(u => ({
                userId: u.userId,
                username: u.username,
                email: u.email,
                avatar: u.avatar || null
            }))
            .slice(0, 20);

        socket.emit('searchResults', results);
    });

    // ==================== НАЧАТЬ ЧАТ ====================
    socket.on('startChat', (req) => {
        if (!currentUserId) return;

        const { userId, username, avatar } = req;
        const data = loadData();

        if (userId === currentUserId) return;

        const chatId = getChatId(currentUserId, userId);

        // Проверяем, существует ли уже чат
        let chat = data.chats.find(c => c.id === chatId);

        if (!chat) {
            chat = {
                id: chatId,
                participants: [currentUserId, userId],
                messages: [],
                createdAt: Date.now(),
                lastMessage: null,
                lastTime: Date.now(),
                unreadBy: {}
            };
            data.chats.push(chat);
            saveData(data);

            // Отправляем событие второму участнику
            io.to(userId).emit('newChat', {
                id: chatId,
                with: getUserName(currentUserId),
                withId: currentUserId,
                avatar: getUserById(currentUserId)?.avatar || null
            });
        }

        // Отправляем подтверждение инициатору
        socket.emit('chatCreated', {
            id: chatId,
            with: username,
            withId: userId,
            avatar: avatar,
            lastMessage: 'Нет сообщений',
            lastTime: chat.createdAt || Date.now(),
            unread: 0
        });

        // Отправляем сообщения инициатору
        setTimeout(() => {
            socket.emit('chatMessages', {
                chatId: chatId,
                messages: chat.messages.slice(-100)
            });
        }, 100);
    });

    // ==================== ОТКРЫТЬ ЧАТ ====================
    socket.on('openChat', (peerId) => {
        if (!currentUserId || !peerId) return;

        const chatId = getChatId(currentUserId, peerId);
        const data = loadData();
        const chat = data.chats.find(c => c.id === chatId);

        if (!chat) return;

        // Сбрасываем счётчик непрочитанных
        if (chat.unreadBy) {
            chat.unreadBy[currentUserId] = 0;
        }

        socket.emit('chatMessages', {
            chatId: chatId,
            messages: chat.messages.slice(-100)
        });

        saveData(data);
    });

    // ==================== ОТПРАВКА СООБЩЕНИЯ ====================
    socket.on('sendMessage', (req) => {
        if (!currentUserId) return;

        const { chatId, text } = req;
        const data = loadData();
        const chat = data.chats.find(c => c.id === chatId);

        if (!chat) return;

        const message = {
            from: currentUserId,
            fromName: getUserName(currentUserId),
            text: text.substring(0, 2000),
            time: Date.now()
        };

        chat.messages.push(message);
        chat.lastMessage = text.substring(0, 50);
        chat.lastTime = message.time;

        // Обновляем счётчик непрочитанных для второго участника
        const otherUserId = chat.participants.find(id => id !== currentUserId);
        if (otherUserId) {
            chat.unreadBy = chat.unreadBy || {};
            chat.unreadBy[otherUserId] = (chat.unreadBy[otherUserId] || 0) + 1;
        }

        saveData(data);

        // Отправляем сообщение обоим участникам
        io.to(chat.participants).emit('newMessage', {
            chatId: chatId,
            message: message
        });
    });

    // ==================== ОТПРАВКА КАРТИНКИ ====================
    socket.on('sendImage', (req) => {
        if (!currentUserId) return;

        const { chatId, image } = req;
        const data = loadData();
        const chat = data.chats.find(c => c.id === chatId);

        if (!chat) return;

        // Сохраняем картинку на диск
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const fileName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
        const filePath = path.join(UPLOADS_DIR, fileName);

        fs.writeFileSync(filePath, base64Data, 'base64');

        const imageUrl = `/uploads/${fileName}`;

        const message = {
            from: currentUserId,
            fromName: getUserName(currentUserId),
            image: imageUrl,
            text: '📷 Фото',
            time: Date.now()
        };

        chat.messages.push(message);
        chat.lastMessage = '📷 Фото';
        chat.lastTime = message.time;

        const otherUserId = chat.participants.find(id => id !== currentUserId);
        if (otherUserId) {
            chat.unreadBy = chat.unreadBy || {};
            chat.unreadBy[otherUserId] = (chat.unreadBy[otherUserId] || 0) + 1;
        }

        saveData(data);

        io.to(chat.participants).emit('newMessage', {
            chatId: chatId,
            message: message
        });
    });

    // ==================== ОБНОВЛЕНИЕ АВАТАРА ====================
    socket.on('updateAvatar', (req) => {
        if (!currentUserId) return;
        const { avatar } = req;

        const data = loadData();
        if (data.users[currentUserId]) {
            data.users[currentUserId].avatar = avatar;
            saveData(data);

            socket.emit('avatarUpdated', {
                userId: currentUserId,
                avatar: avatar
            });

            // Обновляем аватары в чатах
            io.emit('onlineUsers', getOnlineUsers());
        }
    });

    // ==================== 2FA ====================
    socket.on('enable2FA', () => {
        if (!currentUserId) return;
        const data = loadData();
        const user = data.users[currentUserId];
        if (!user) return;

        const secret = speakeasy.generateSecret({
            name: `SecureChat:${user.email}`
        });

        user.twoFactorSecret = secret.base32;
        user.twoFactorEnabled = true;
        saveData(data);

        socket.emit('2FAEnabled');
        console.log('🔐 2FA включена для:', user.username);
    });

    socket.on('disable2FA', () => {
        if (!currentUserId) return;
        const data = loadData();
        const user = data.users[currentUserId];
        if (!user) return;

        user.twoFactorSecret = null;
        user.twoFactorEnabled = false;
        saveData(data);

        socket.emit('2FADisabled');
    });

    // ==================== ВЫХОД ====================
    socket.on('logout', () => {
        currentUserId = null;
        socket.userId = null;
        io.emit('onlineUsers', getOnlineUsers());
    });

    // ==================== ОТКЛЮЧЕНИЕ ====================
    socket.on('disconnect', () => {
        console.log('🔌 Клиент отключился:', socket.id);
        if (currentUserId) {
            currentUserId = null;
            io.emit('onlineUsers', getOnlineUsers());
        }
    });
});

// ==================== ONLINE ПОЛЬЗОВАТЕЛИ ====================
function getOnlineUsers() {
    const online = [];
    io.sockets.sockets.forEach((socket) => {
        if (socket.userId) {
            online.push(socket.userId);
        }
    });
    return online;
}

// ==================== ЗАПУСК ====================
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log('📂 Папка клиента:', clientDir);
    console.log('💾 Файл данных:', DATA_FILE);
});
