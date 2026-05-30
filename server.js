const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const crypto = require('crypto');
const https = require('https');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Настройки Telegram бота
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'ТВОЙ_ТОКЕН_БОТА';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'ТВОЙ_CHAT_ID';

// Хранилища
const users = new Map();
const messages = [];
const groups = new Map(); // groupId -> { id, name, avatar, members: Set, createdBy, created }
const groupMessages = []; // [{ id, groupId, from, text, time, type, readBy: Set }]
const sessions = new Map();
const online = new Map();
const callRequests = new Map();

function sendToTelegram(code, email) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || 
        TELEGRAM_BOT_TOKEN === 'ТВОЙ_ТОКЕН_БОТА' || 
        TELEGRAM_CHAT_ID === 'ТВОЙ_CHAT_ID') {
        console.log(`\n⚠️  Telegram бот не настроен. Код для ${email}: ${code}\n`);
        return;
    }
    
    const text = `🔐 *Messages 2FA*\n\n📧 Email: \`${email}\`\n🔑 Код: \`${code}\`\n⏰ ${new Date().toLocaleString('ru-RU')}`;
    
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const data = JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'Markdown'
    });
    
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };
    
    const req = https.request(url, options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            try {
                const result = JSON.parse(body);
                if (result.ok) {
                    console.log(`✅ Код для ${email} отправлен в Telegram`);
                } else {
                    console.log(`❌ Ошибка Telegram: ${result.description}`);
                    console.log(`📧 Код для ${email}: ${code}`);
                }
            } catch(e) {
                console.log(`📧 Код для ${email}: ${code}`);
            }
        });
    });
    
    req.on('error', (err) => {
        console.log(`❌ Ошибка Telegram API: ${err.message}`);
        console.log(`📧 Код для ${email}: ${code}`);
    });
    
    req.write(data);
    req.end();
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
    
    sendToTelegram(code, email);
    res.json({ success: true, message: 'Код отправлен в Telegram бот' });
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
    sendToTelegram(code, email);
    return res.json({ need2FA: true, email });
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

app.post('/edit-message', (req, res) => {
    const { token, id, newText } = req.body;
    // Приводим email к нижнему регистру при поиске
const user = users.get(searchEmail.toLowerCase().trim());

// Если пользователь не найден — пишем об этом
if (!user) return res.json({ error: 'Пользователь не найден' });

// Если нужно, чтобы искались только верифицированные, оставьте !user.verified, 
// но убедитесь, что вы поставили user.verified = true при успешной 2FA.
    
    let msg = messages.find(m => m.id === id);
    if (!msg) msg = groupMessages.find(m => m.id === id);
    
    if (!msg) return res.json({ error: 'Сообщение не найдено' });
    if (msg.from !== email) return res.json({ error: 'Нельзя редактировать чужое сообщение' });
    
    const tenMinutes = 10 * 60 * 1000;
    if (Date.now() - msg.time > tenMinutes) return res.json({ error: 'Можно редактировать только 10 минут' });
    
    msg.text = newText;
    msg.edited = true;
    msg.editedTime = Date.now();
    
    if (msg.groupId) {
        io.to('group:' + msg.groupId).emit('messageEdited', { id, newText, edited: true, groupId: msg.groupId });
    } else if (online.has(msg.to)) {
        io.to(online.get(msg.to)).emit('messageEdited', { id, newText, edited: true });
    }
    
    res.json({ success: true, message: msg });
});

app.post('/delete-message', (req, res) => {
    const { token, id } = req.body;
    const email = sessions.get(token);
    if (!email) return res.json({ error: 'Не авторизован' });
    
    let msg = messages.find(m => m.id === id);
    if (!msg) msg = groupMessages.find(m => m.id === id);
    
    if (!msg) return res.json({ error: 'Сообщение не найдено' });
    if (msg.from !== email) return res.json({ error: 'Нельзя удалить чужое сообщение' });
    
    msg.deleted = true;
    msg.text = 'Сообщение удалено';
    msg.deletedTime = Date.now();
    
    if (msg.groupId) {
        io.to('group:' + msg.groupId).emit('messageDeleted', { id, deleted: true, groupId: msg.groupId });
    } else if (online.has(msg.to)) {
        io.to(online.get(msg.to)).emit('messageDeleted', { id, deleted: true });
    }
    
    res.json({ success: true });
});

app.get('/find-user', (req, res) => {
    const { token, email: searchEmail } = req.query;
    const myEmail = sessions.get(token);
    if (!myEmail) return res.json({ error: 'Не авторизован' });
    if (searchEmail === myEmail) return res.json({ error: 'Это вы' });
    
    // 1. Приводим поиск к нижнему регистру и убираем лишние пробелы
    const user = users.get(searchEmail.toLowerCase().trim());
    
    // 2. Убираем условие !user.verified, если хотите находить и не верифицированных пользователей
    if (!user) return res.json({ error: 'Пользователь не найден' });
    
    res.json({ 
        found: true, 
        email: searchEmail, 
        nickname: user.nickname, 
        avatar: user.avatar, 
        status: user.status, 
        online: online.has(searchEmail.toLowerCase().trim()) // Также проверяем статус по корректному email
    });
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
    
    const myGroups = [];
    for (const [gid, group] of groups) {
        if (group.members.has(email)) {
            const lastMsg = groupMessages.filter(m => m.groupId === gid).slice(-1)[0];
            myGroups.push({
                id: gid,
                name: group.name,
                avatar: group.avatar,
                type: 'group',
                online: false,
                members: [...group.members].map(e => ({
                    email: e,
                    nickname: users.get(e)?.nickname || e,
                    avatar: users.get(e)?.avatar
                })),
                lastMessage: lastMsg ? {
                    text: lastMsg.deleted ? 'Сообщение удалено' : lastMsg.text,
                    time: lastMsg.time,
                    from: lastMsg.from,
                    type: lastMsg.type || 'text',
                    readBy: [...lastMsg.readBy]
                } : null,
                unread: groupMessages.filter(m => m.groupId === gid && !m.readBy.has(email)).length
            });
        }
    }
    
    const list = [];
    for (const [e, u] of users) {
        if (e !== email && u.verified) {
            const lastMsg = messages.filter(m => 
                (m.from === email && m.to === e) || (m.from === e && m.to === email)
            ).slice(-1)[0];
            
            list.push({
                email: e, 
                nickname: u.nickname, 
                avatar: u.avatar,
                status: u.status, 
                online: online.has(e),
                type: 'user',
                hasMessages: contactsWithMessages.has(e),
                lastMessage: lastMsg ? {
                    text: lastMsg.deleted ? 'Сообщение удалено' : lastMsg.text,
                    time: lastMsg.time,
                    from: lastMsg.from,
                    type: lastMsg.type || 'text',
                    read: lastMsg.read
                } : null
            });
        }
    }
    
    list.sort((a, b) => {
        if (a.hasMessages !== b.hasMessages) return a.hasMessages ? -1 : 1;
        if (a.online !== b.online) return a.online ? -1 : 1;
        return (a.nickname || a.email).localeCompare(b.nickname || b.email);
    });
    
    res.json({ contacts: list, groups: myGroups, myProfile: getUserData(email) });
});

app.get('/messages', (req, res) => {
    const { token, with: withUser } = req.query;
    const email = sessions.get(token);
    if (!email) return res.json({ error: 'Не авторизован' });
    
    const msgs = messages.filter(m =>
        (m.from === email && m.to === withUser) || (m.from === withUser && m.to === email)
    );
    
    msgs.forEach(m => {
        if (m.to === email && !m.read) {
            m.read = true;
            m.readTime = Date.now();
            
            if (online.has(m.from)) {
                io.to(online.get(m.from)).emit('messageRead', { id: m.id, read: true, readTime: m.readTime });
            }
        }
    });
    
    const withUserData = users.get(withUser);
    res.json({ 
        messages: msgs, 
        chatUser: withUserData ? {
            email: withUser, 
            nickname: withUserData.nickname,
            avatar: withUserData.avatar, 
            status: withUserData.status,
            online: online.has(withUser)
        } : null
    });
});

app.get('/group-messages', (req, res) => {
    const { token, groupId } = req.query;
    const email = sessions.get(token);
    if (!email) return res.json({ error: 'Не авторизован' });
    
    const group = groups.get(groupId);
    if (!group || !group.members.has(email)) return res.json({ error: 'Нет доступа' });
    
    const msgs = groupMessages.filter(m => m.groupId === groupId);
    
    msgs.forEach(m => {
        if (!m.readBy.has(email)) {
            m.readBy.add(email);
            
            io.to('group:' + groupId).emit('messageRead', { 
                id: m.id, 
                groupId, 
                readBy: [...m.readBy].length 
            });
        }
    });
    
    res.json({ 
        messages: msgs,
        group: {
            id: group.id,
            name: group.name,
            avatar: group.avatar,
            members: [...group.members].map(e => ({
                email: e,
                nickname: users.get(e)?.nickname || e,
                avatar: users.get(e)?.avatar,
                online: online.has(e)
            })),
            createdBy: group.createdBy,
            created: group.created
        }
    });
});

app.post('/create-group', (req, res) => {
    const { token, name, members } = req.body;
    const email = sessions.get(token);
    if (!email) return res.json({ error: 'Не авторизован' });
    if (!name) return res.json({ error: 'Название обязательно' });
    if (!members || !Array.isArray(members) || members.length < 1) 
        return res.json({ error: 'Добавьте хотя бы одного участника' });
    
    const groupId = crypto.randomBytes(10).toString('hex');
    const memberSet = new Set([email, ...members]);
    
    for (const member of memberSet) {
        if (!users.has(member) || !users.get(member).verified) {
            return res.json({ error: `Пользователь ${member} не найден` });
        }
    }
    
    groups.set(groupId, {
        id: groupId,
        name,
        avatar: null,
        members: memberSet,
        createdBy: email,
        created: Date.now()
    });
    
    memberSet.forEach(member => {
        if (online.has(member)) {
            io.to(online.get(member)).emit('groupCreated', {
                groupId,
                name,
                members: [...memberSet].map(e => ({
                    email: e,
                    nickname: users.get(e)?.nickname || e,
                    avatar: users.get(e)?.avatar
                }))
            });
        }
    });
    
    const sysMsg = {
        id: crypto.randomBytes(8).toString('hex'),
        groupId,
        from: 'system',
        text: `${users.get(email)?.nickname || email} создал группу "${name}"`,
        time: Date.now(),
        type: 'system',
        readBy: new Set()
    };
    groupMessages.push(sysMsg);
    
    io.to('group:' + groupId).emit('groupMessage', sysMsg);
    
    res.json({ 
        success: true, 
        groupId, 
        name,
        members: [...memberSet].map(e => ({
            email: e,
            nickname: users.get(e)?.nickname || e,
            avatar: users.get(e)?.avatar
        }))
    });
});

app.post('/add-group-members', (req, res) => {
    const { token, groupId, members } = req.body;
    const email = sessions.get(token);
    if (!email) return res.json({ error: 'Не авторизован' });
    
    const group = groups.get(groupId);
    if (!group) return res.json({ error: 'Группа не найдена' });
    if (!group.members.has(email)) return res.json({ error: 'Вы не участник' });
    
    for (const member of members) {
        if (users.has(member) && users.get(member).verified) {
            group.members.add(member);
            if (online.has(member)) {
                io.to(online.get(member)).emit('addedToGroup', {
                    groupId,
                    name: group.name,
                    members: [...group.members].map(e => ({
                        email: e,
                        nickname: users.get(e)?.nickname || e,
                        avatar: users.get(e)?.avatar
                    }))
                });
                online.get(member).join('group:' + groupId);
            }
        }
    }
    
    const sysMsg = {
        id: crypto.randomBytes(8).toString('hex'),
        groupId,
        from: 'system',
        text: `${users.get(email)?.nickname || email} добавил ${members.length} участников`,
        time: Date.now(),
        type: 'system',
        readBy: new Set()
    };
    groupMessages.push(sysMsg);
    io.to('group:' + groupId).emit('groupMessage', sysMsg);
    
    res.json({ success: true, group });
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
        
        for (const [gid, group] of groups) {
            if (group.members.has(email)) {
                socket.join('group:' + gid);
            }
        }
        
        socket.broadcast.emit('userStatus', { email, online: true });
        console.log(`🟢 ${email} онлайн`);
    });
    
    socket.on('message', (data) => {
        const { to, text, time, type } = data;
        const msg = {
            id: crypto.randomBytes(8).toString('hex'),
            from: currentUser, to, text,
            time: time || Date.now(), 
            type: type || 'text',
            read: false
        };
        messages.push(msg);
        
        if (online.has(to)) {
            io.to(online.get(to)).emit('message', msg);
        }
        socket.emit('messageSelf', msg);
    });
    
    socket.on('groupMessage', (data) => {
        const { groupId, text, time, type } = data;
        const group = groups.get(groupId);
        if (!group || !group.members.has(currentUser)) return;
        
        const msg = {
            id: crypto.randomBytes(8).toString('hex'),
            groupId, from: currentUser, text,
            time: time || Date.now(), 
            type: type || 'text',
            readBy: new Set([currentUser])
        };
        groupMessages.push(msg);
        io.to('group:' + groupId).emit('groupMessage', msg);
    });
    
    socket.on('readMessages', (data) => {
        const { chatWith } = data;
        
        messages.forEach(m => {
            if (m.to === currentUser && m.from === chatWith && !m.read) {
                m.read = true;
                m.readTime = Date.now();
                if (online.has(m.from)) {
                    io.to(online.get(m.from)).emit('messageRead', { 
                        id: m.id, 
                        read: true, 
                        readTime: m.readTime 
                    });
                }
            }
        });
    });
    
    socket.on('readGroupMessages', (data) => {
        const { groupId } = data;
        
        groupMessages.forEach(m => {
            if (m.groupId === groupId && !m.readBy.has(currentUser)) {
                m.readBy.add(currentUser);
            }
        });
        
        io.to('group:' + groupId).emit('groupMessagesRead', {
            groupId,
            readBy: currentUser
        });
    });
    
    socket.on('editMessage', (data) => {
        const { id, newText } = data;
        let msg = messages.find(m => m.id === id);
        if (!msg) msg = groupMessages.find(m => m.id === id);
        
        if (!msg || msg.from !== currentUser) return;
        
        msg.text = newText;
        msg.edited = true;
        
        if (msg.groupId) {
            io.to('group:' + msg.groupId).emit('messageEdited', { id, newText, edited: true, groupId: msg.groupId });
        } else if (online.has(msg.to)) {
            io.to(online.get(msg.to)).emit('messageEdited', { id, newText, edited: true });
        }
        socket.emit('messageEdited', { id, newText, edited: true });
    });
    
    socket.on('deleteMessage', (data) => {
        const { id } = data;
        let msg = messages.find(m => m.id === id);
        if (!msg) msg = groupMessages.find(m => m.id === id);
        
        if (!msg || msg.from !== currentUser) return;
        
        msg.deleted = true;
        msg.text = 'Сообщение удалено';
        
        if (msg.groupId) {
            io.to('group:' + msg.groupId).emit('messageDeleted', { id, deleted: true, groupId: msg.groupId });
        } else if (online.has(msg.to)) {
            io.to(online.get(msg.to)).emit('messageDeleted', { id, deleted: true });
        }
        socket.emit('messageDeleted', { id, deleted: true });
    });
    
    socket.on('callRequest', (data) => {
        const { to } = data;
        const callId = crypto.randomBytes(8).toString('hex');
        callRequests.set(callId, { id: callId, from: currentUser, to, status: 'ringing', time: Date.now() });
        
        if (online.has(to)) {
            io.to(online.get(to)).emit('incomingCall', {
                callId,
                from: currentUser,
                nickname: users.get(currentUser)?.nickname || currentUser,
                avatar: users.get(currentUser)?.avatar || null
            });
        }
        socket.emit('callStatus', { callId, status: 'ringing' });
    });
    
    socket.on('callResponse', (data) => {
        const { callId, response } = data;
        const call = callRequests.get(callId);
        if (!call) return;
        
        if (response === 'accept') {
            call.status = 'accepted';
            if (online.has(call.from)) {
                io.to(online.get(call.from)).emit('callAccepted', { callId });
            }
        } else {
            call.status = 'rejected';
            if (online.has(call.from)) {
                io.to(online.get(call.from)).emit('callRejected', { callId });
            }
        }
        callRequests.set(callId, call);
    });
    
    socket.on('callEnd', (data) => {
        const { callId } = data;
        const call = callRequests.get(callId);
        if (!call) return;
        
        const otherParty = call.from === currentUser ? call.to : call.from;
        if (online.has(otherParty)) {
            io.to(online.get(otherParty)).emit('callEnded', { callId });
        }
        callRequests.delete(callId);
    });
    
    socket.on('webrtcOffer', (data) => {
        if (online.has(data.to)) {
            io.to(online.get(data.to)).emit('webrtcOffer', { from: currentUser, offer: data.offer });
        }
    });
    
    socket.on('webrtcAnswer', (data) => {
        if (online.has(data.to)) {
            io.to(online.get(data.to)).emit('webrtcAnswer', { from: currentUser, answer: data.answer });
        }
    });
    
    socket.on('webrtcIce', (data) => {
        if (online.has(data.to)) {
            io.to(online.get(data.to)).emit('webrtcIce', { from: currentUser, candidate: data.candidate });
        }
    });
    
    socket.on('typing', (to) => {
        if (online.has(to)) {
            io.to(online.get(to)).emit('typing', {
                user: currentUser,
                nickname: users.get(currentUser)?.nickname || currentUser
            });
        }
    });
    
    socket.on('groupTyping', (data) => {
        socket.to('group:' + data.groupId).emit('groupTyping', {
            user: currentUser,
            nickname: users.get(currentUser)?.nickname || currentUser,
            groupId: data.groupId
        });
    });
    
    socket.on('disconnect', () => {
        if (currentUser) {
            online.delete(currentUser);
            socket.broadcast.emit('userStatus', { email: currentUser, online: false });
            
            for (const [cid, call] of callRequests) {
                if (call.from === currentUser || call.to === currentUser) {
                    const otherParty = call.from === currentUser ? call.to : call.from;
                    if (online.has(otherParty)) {
                        io.to(online.get(otherParty)).emit('callEnded', { callId: cid });
                    }
                    callRequests.delete(cid);
                }
            }
            
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
        .wallpaper-gradient1{--wallpaper:linear-gradient(135deg,#1a1a2e,#16213e)}.wallpaper-gradient2{--wallpaper:linear-gradient(135deg,#0f2027,#2c5364)}.wallpaper-space{--wallpaper:linear-gradient(135deg,#0c0c1d,#1a1a3e)}.wallpaper-sunset{--wallpaper:linear-gradient(135deg,#ff512f,#dd2476)}.wallpaper-ocean{--wallpaper:linear-gradient(135deg,#2193b0,#6dd5ed)}
        .light.wallpaper-gradient1{--wallpaper:linear-gradient(135deg,#f5f7fa,#c3cfe2)}.light.wallpaper-gradient2{--wallpaper:linear-gradient(135deg,#e0f7fa,#b2ebf2)}.light.wallpaper-space{--wallpaper:linear-gradient(135deg,#e8eaf6,#c5cae9)}.light.wallpaper-sunset{--wallpaper:linear-gradient(135deg,#ffe0b2,#ffccbc)}.light.wallpaper-ocean{--wallpaper:linear-gradient(135deg,#e0f7fa,#b2ebf2)}
        .font-small{--fs:0.9}.font-medium{--fs:1}.font-large{--fs:1.15}.font-xlarge{--fs:1.3}
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro','Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);height:100vh;height:100dvh;overflow:hidden;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;font-size:calc(16px * var(--fs))}
        .screen{display:none;height:100vh;height:100dvh;flex-direction:column;position:absolute;top:0;left:0;right:0;bottom:0;background:var(--bg)}.screen.active{display:flex}
        .nav{background:var(--nav-bg);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);padding:12px 16px;text-align:center;font-size:calc(17px * var(--fs));font-weight:600;border-bottom:0.5px solid var(--border);position:relative;z-index:10}
        .nav-back{position:absolute;left:4px;top:50%;transform:translateY(-50%);background:0;border:0;color:#0a84ff;font-size:calc(17px * var(--fs));cursor:pointer;padding:8px 12px}
        .container{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
        #login-screen{justify-content:center}#login-screen .container{display:flex;flex-direction:column;justify-content:center;align-items:center;padding:32px}
        .logo{font-size:56px;margin-bottom:8px;animation:float 3s ease-in-out infinite}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
        .title{font-size:calc(32px * var(--fs));font-weight:700;margin-bottom:4px}.subtitle{color:var(--text-secondary);margin-bottom:32px;font-size:calc(15px * var(--fs))}
        .input-group{width:100%;max-width:340px;margin-bottom:12px}
        .input-group input{width:100%;padding:14px 16px;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:calc(16px * var(--fs));outline:0;transition:all 0.2s}
        .input-group input:focus{border-color:#0a84ff;box-shadow:0 0 0 3px rgba(10,132,255,0.2)}
        .btn{width:100%;max-width:340px;padding:14px;border-radius:12px;border:0;font-size:calc(17px * var(--fs));font-weight:600;cursor:pointer;margin-bottom:8px;transition:all 0.2s}.btn:active{transform:scale(0.97)}.btn-primary{background:#0a84ff;color:#fff}.btn-secondary{background:var(--surface);color:#0a84ff;border:1px solid #0a84ff}
        .error{color:var(--danger);font-size:calc(14px * var(--fs));margin-top:8px;text-align:center;min-height:20px}.success{color:var(--success);font-size:calc(14px * var(--fs));margin-top:4px;text-align:center}
        .chat-item{display:flex;align-items:center;padding:10px 16px;cursor:pointer;transition:background 0.1s;position:relative}.chat-item:active{background:var(--surface)}
        .avatar{width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg,#0a84ff,#5e5ce6);display:flex;align-items:center;justify-content:center;font-size:22px;color:#fff;margin-right:12px;flex-shrink:0;overflow:hidden;position:relative}
        .avatar img{width:100%;height:100%;object-fit:cover}
        .group-avatar{background:linear-gradient(135deg,#5e5ce6,#0a84ff)}
        .chat-info{flex:1;min-width:0}
        .chat-name{font-weight:600;font-size:calc(16px * var(--fs));display:flex;align-items:center;gap:6px}
        .chat-preview{color:var(--text-secondary);font-size:calc(14px * var(--fs));margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .online-dot{width:10px;height:10px;border-radius:50%;background:var(--success);position:absolute;bottom:2px;right:2px;border:2px solid var(--bg)}
        .chat-time{font-size:calc(12px * var(--fs));color:var(--text-secondary);flex-shrink:0;margin-left:8px}
        .unread-badge{min-width:20px;height:20px;border-radius:10px;background:var(--danger);color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center;padding:0 6px;margin-top:4px;flex-shrink:0}
        .fab{position:fixed;bottom:24px;right:16px;width:56px;height:56px;border-radius:50%;background:#0a84ff;color:#fff;border:0;font-size:28px;cursor:pointer;box-shadow:0 4px 12px rgba(10,132,255,0.4);z-index:50;display:flex;align-items:center;justify-content:center;transition:all 0.2s}.fab:active{transform:scale(0.9)}
        .fab.create-group{right:84px;background:#5e5ce6;box-shadow:0 4px 12px rgba(94,92,230,0.4)}
        .empty-state{text-align:center;padding:60px 32px;color:var(--text-secondary)}.empty-state .icon{font-size:48px;margin-bottom:16px}.empty-state p{font-size:calc(16px * var(--fs));margin-bottom:8px}
        .messages{flex:1;overflow-y:auto;padding:8px 4px;display:flex;flex-direction:column;gap:2px;-webkit-overflow-scrolling:touch}
        .message-row{display:flex;flex-direction:column;margin:1px 8px;max-width:80%;animation:msgIn 0.3s ease-out;position:relative}@keyframes msgIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .message-row.sent{align-self:flex-end;align-items:flex-end}.message-row.received{align-self:flex-start;align-items:flex-start}
        .message-row.system{align-self:center;align-items:center;max-width:90%}
        .message-bubble{padding:8px 12px;border-radius:18px;font-size:calc(16px * var(--fs));line-height:1.35;word-wrap:break-word;letter-spacing:-0.2px;position:relative}
        .sent .message-bubble{background:var(--bubble-sent);color:#fff;border-bottom-right-radius:4px}.received .message-bubble{background:var(--bubble-received);color:var(--text);border-bottom-left-radius:4px}
        .system .message-bubble{background:transparent;color:var(--text-secondary);font-size:calc(13px * var(--fs));padding:4px 12px;text-align:center;font-style:italic}
        .message-bubble.deleted{font-style:italic;opacity:0.6}.message-bubble.edited-badge:after{content:' (изм.)';font-size:10px;opacity:0.6}
        .message-bubble.heart,.message-bubble.like,.message-bubble.fire,.message-bubble.rocket{font-size:44px;padding:2px 8px;background:0!important}
        .message-time{font-size:calc(11px * var(--fs));color:var(--text-secondary);margin-top:1px;padding:0 4px;display:flex;align-items:center;gap:4px}
        .message-read-status{font-size:11px;color:#0a84ff;margin-top:1px;padding:0 4px}
        .sent .message-read-status{text-align:right}
        .received .message-read-status{text-align:left}
        .message-actions{display:none;position:absolute;top:-30px;right:0;gap:4px;z-index:5}
        .message-row.sent:hover .message-actions,.message-row.sent:active .message-actions{display:flex}
        .action-btn{width:28px;height:28px;border-radius:50%;border:0;background:var(--surface2);color:var(--text);font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s}.action-btn:active{background:#0a84ff;color:#fff}
        .group-message-sender{font-size:calc(13px * var(--fs));font-weight:600;color:#0a84ff;margin-bottom:2px;padding:0 4px}
        .typing-indicator{font-size:calc(13px * var(--fs));color:var(--text-secondary);padding:6px 16px;display:flex;align-items:center;gap:4px}
        .typing-dots{display:flex;gap:3px}.typing-dots span{width:6px;height:6px;border-radius:50%;background:var(--text-secondary);animation:dotBounce 1.4s infinite}.typing-dots span:nth-child(2){animation-delay:0.2s}.typing-dots span:nth-child(3){animation-delay:0.4s}@keyframes dotBounce{0%,80%,100%{transform:scale(0.8);opacity:0.5}40%{transform:scale(1.2);opacity:1}}
        .input-bar{display:flex;padding:8px 8px calc(8px + env(safe-area-inset-bottom,0px));background:var(--surface);border-top:0.5px solid var(--border);align-items:center;gap:6px}
        .input-bar input{flex:1;padding:10px 16px;border-radius:20px;border:1px solid var(--border);background:var(--input-bg);color:var(--text);font-size:calc(16px * var(--fs));outline:0}.input-bar input:focus{border-color:#0a84ff}
        .icon-btn{width:36px;height:36px;border-radius:50%;border:0;background:0;color:#0a84ff;font-size:20px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all 0.2s}.icon-btn:active{background:var(--surface2);transform:scale(0.9)}.icon-btn.send{background:#0a84ff;color:#fff}
        .effects-bar{display:flex;gap:4px;padding:4px 8px;overflow-x:auto;border-top:0.5px solid var(--border);background:var(--surface)}
        .effect-btn{padding:6px 12px;border-radius:16px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:calc(18px * var(--fs));cursor:pointer;transition:all 0.2s;flex-shrink:0}.effect-btn:active{background:#0a84ff;border-color:#0a84ff;transform:scale(0.95)}
        .header-status{font-size:calc(12px * var(--fs));color:var(--text-secondary);text-align:center;font-weight:400}
        .nav-actions{display:flex;gap:12px;align-items:center}
        .nav-call-btn{background:0;border:0;color:#0a84ff;font-size:20px;cursor:pointer;padding:4px;transition:all 0.2s}.nav-call-btn:active{transform:scale(0.9)}
        .nav-group-info-btn{background:0;border:0;color:#5e5ce6;font-size:20px;cursor:pointer;padding:4px;transition:all 0.2s}.nav-group-info-btn:active{transform:scale(0.9)}
        .group-members-list{display:flex;flex-wrap:wrap;gap:8px;padding:12px}
        .group-member-chip{display:flex;align-items:center;gap:6px;background:var(--surface2);border-radius:20px;padding:6px 12px;font-size:calc(14px * var(--fs))}
        .group-member-chip .mini-avatar{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#0a84ff,#5e5ce6);display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;overflow:hidden}
        .group-member-chip .mini-avatar img{width:100%;height:100%;object-fit:cover}
        .call-overlay{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:200;flex-direction:column;align-items:center;justify-content:center;gap:24px}
        .call-overlay.active{display:flex}
        .call-avatar{width:100px;height:100px;border-radius:50%;background:linear-gradient(135deg,#0a84ff,#5e5ce6);display:flex;align-items:center;justify-content:center;font-size:50px;color:#fff;overflow:hidden}
        .call-avatar img{width:100%;height:100%;object-fit:cover}
        .call-name{color:#fff;font-size:calc(24px * var(--fs));font-weight:600}
        .call-status{color:var(--text-secondary);font-size:calc(16px * var(--fs))}
        .call-timer{color:#fff;font-size:calc(20px * var(--fs));font-variant-numeric:tabular-nums}
        .call-buttons{display:flex;gap:24px}
        .call-btn{width:64px;height:64px;border-radius:50%;border:0;font-size:28px;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center}
        .call-btn:active{transform:scale(0.9)}
        .call-btn-accept{background:var(--success)}.call-btn-reject{background:var(--danger)}
        .call-btn-end{background:var(--danger)}
        .call-btn-mute{width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,0.2);border:0;color:#fff;font-size:20px;cursor:pointer;transition:all 0.2s}
        .call-btn-mute.muted{background:rgba(255,255,255,0.5)}
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
        .profile-nickname{font-size:calc(20px * var(--fs));font-weight:600;margin-top:4px}.profile-status{color:var(--text-secondary);font-size:calc(14px * var(--fs));margin-top:4px}
        .modal{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:100;align-items:flex-end;justify-content:center}
        .modal.active{display:flex}.modal-content{background:var(--surface);border-radius:14px 14px 0 0;padding:8px 16px 24px;width:100%;max-width:500px;max-height:80vh;overflow-y:auto}
        .modal-handle{width:36px;height:5px;border-radius:3px;background:#48484a;margin:8px auto 16px}
        .modal-title{font-size:calc(17px * var(--fs));font-weight:600;text-align:center;margin-bottom:16px}
        .wallpaper-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
        .wallpaper-option{height:80px;border-radius:12px;cursor:pointer;border:3px solid transparent;transition:all 0.2s;display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.5)}
        .wallpaper-option.selected{border-color:#0a84ff}
        .font-size-btns{display:flex;gap:8px}.font-size-btn{padding:6px 16px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;transition:all 0.2s}.font-size-btn.selected{background:#0a84ff;color:#fff;border-color:#0a84ff}
        .file-input-hidden{display:none}
        .toast{position:fixed;top:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:8px 20px;border-radius:20px;font-size:14px;z-index:300;animation:toastIn 0.3s ease-out;backdrop-filter:blur(10px)}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .checkbox-group{display:flex;flex-direction:column;gap:8px;margin:12px 0}
        .checkbox-item{display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;cursor:pointer;transition:background 0.1s}.checkbox-item:active{background:var(--surface2)}
        .checkbox-item input[type=checkbox]{width:20px;height:20px;accent-color:#0a84ff}
    </style>
</head>
<body>
    <div id="login-screen" class="screen active">
        <div class="container">
            <div class="logo">💬</div>
            <div class="title">Messages</div>
            <div class="subtitle">Безопасный мессенджер</div>
            <div class="input-group"><input type="email" id="login-email" placeholder="Email" autocomplete="email"></div>
            <div class="input-group"><input type="password" id="login-password" placeholder="Пароль" autocomplete="current-password"></div>
            <div class="error" id="login-error"></div>
            <button class="btn btn-primary" onclick="login()">Войти</button>
            <button class="btn btn-secondary" onclick="register()">Создать аккаунт</button>
        </div>
    </div>
    
    <div id="2fa-screen" class="screen">
        <div class="container" style="display:flex;flex-direction:column;justify-content:center;align-items:center;padding:32px">
            <div class="logo">🔐</div>
            <div class="title" style="font-size:calc(24px * var(--fs))">Подтверждение</div>
            <div class="subtitle">Код отправлен в Telegram бот</div>
            <div class="input-group"><input type="text" id="2fa-code" placeholder="Введите код" maxlength="6" inputmode="numeric"></div>
            <div class="error" id="2fa-error"></div>
            <button class="btn btn-primary" onclick="verify2FA()">Подтвердить</button>
        </div>
    </div>
    
    <div id="chats-screen" class="screen">
        <div class="nav">
            <span id="chats-nav-title">Чаты</span>
            <div style="position:absolute;right:12px;top:50%;transform:translateY(-50%)">
                <button class="nav-call-btn" onclick="showScreen('settings')" style="font-size:20px">⚙️</button>
            </div>
        </div>
        <div class="container" id="chats-list"></div>
        <button class="fab create-group" onclick="createGroup()" title="Создать группу">👥</button>
        <button class="fab" onclick="showNewChatModal()" title="Новый чат">+</button>
    </div>
    
    <div id="chat-screen" class="screen">
        <div class="nav">
            <button class="nav-back" onclick="goBack()">←</button>
            <div id="chat-header">
                <div id="chat-user-name">...</div>
                <div class="header-status" id="chat-user-status"></div>
            </div>
            <div class="nav-actions" style="position:absolute;right:12px;top:50%;transform:translateY(-50%)">
                <button class="nav-call-btn" id="chat-call-btn" onclick="startCall()" title="Позвонить">📞</button>
                <button class="nav-group-info-btn" id="chat-group-info-btn" onclick="showGroupInfo()" title="Инфо группы" style="display:none">ℹ️</button>
            </div>
        </div>
        <div class="messages" id="chat-messages"></div>
        <div class="typing-indicator" id="typing-indicator" style="display:none">
            <div class="typing-dots"><span></span><span></span><span></span></div>
            <span id="typing-text">печатает...</span>
        </div>
        <div class="effects-bar" id="effects-bar">
            <button class="effect-btn" onclick="sendEffect('❤️','heart')">❤️</button>
            <button class="effect-btn" onclick="sendEffect('👍','like')">👍</button>
            <button class="effect-btn" onclick="sendEffect('🔥','fire')">🔥</button>
            <button class="effect-btn" onclick="sendEffect('🚀','rocket')">🚀</button>
            <button class="effect-btn" onclick="sendEffect('😂','laugh')">😂</button>
            <button class="effect-btn" onclick="sendEffect('😍','love')">😍</button>
        </div>
        <div class="input-bar" id="edit-message-bar">
            <input type="text" id="edit-message-input" placeholder="Редактировать сообщение...">
            <button class="icon-btn send" onclick="saveEditMessage()">✓</button>
            <button class="icon-btn" onclick="cancelEditMessage()">✕</button>
        </div>
        <div class="input-bar" id="message-input-bar">
            <button class="icon-btn" onclick="toggleEffects()">😊</button>
            <input type="text" id="message-input" placeholder="Сообщение" onkeypress="onKeyPress(event)" oninput="onTyping()">
            <button class="icon-btn send" onclick="sendMessage()">↑</button>
        </div>
    </div>
    
    <div id="settings-screen" class="screen">
        <div class="nav">
            <button class="nav-back" onclick="showScreen('chats')">←</button>
            Настройки
        </div>
        <div class="container" id="settings-content"></div>
    </div>
    
    <div class="modal" id="new-chat-modal">
        <div class="modal-content">
            <div class="modal-handle"></div>
            <div class="modal-title">Новый чат</div>
            <div class="input-group"><input type="email" id="search-email" placeholder="Email пользователя"></div>
            <div class="error" id="search-error"></div>
            <div id="search-result"></div>
            <button class="btn btn-primary" onclick="searchUser()">Найти</button>
            <button class="btn btn-secondary" onclick="closeModal('new-chat-modal')">Отмена</button>
        </div>
    </div>
    
    <div class="modal" id="edit-modal">
        <div class="modal-content">
            <div class="modal-handle"></div>
            <div class="modal-title" id="edit-modal-title"></div>
            <div class="input-group"><input type="text" id="edit-input"></div>
            <button class="btn btn-primary" onclick="saveEdit()">Сохранить</button>
            <button class="btn btn-secondary" onclick="closeModal('edit-modal')">Отмена</button>
        </div>
    </div>
    
    <div class="modal" id="group-modal">
        <div class="modal-content">
            <div class="modal-handle"></div>
            <div class="modal-title">Создать группу</div>
            <div class="input-group"><input type="text" id="group-name-input" placeholder="Название группы"></div>
            <div class="input-group"><input type="email" id="group-members-input" placeholder="Email участников (через запятую)"></div>
            <div class="error" id="group-error"></div>
            <button class="btn btn-primary" onclick="createGroupAction()">Создать</button>
            <button class="btn btn-secondary" onclick="closeModal('group-modal')">Отмена</button>
        </div>
    </div>
    
    <div class="modal" id="group-info-modal">
        <div class="modal-content" id="group-info-content">
            <div class="modal-handle"></div>
            <div class="modal-title">Информация о группе</div>
            <div id="group-info-inner"></div>
            <button class="btn btn-secondary" onclick="closeModal('group-info-modal')">Закрыть</button>
        </div>
    </div>
    
    <div class="call-overlay" id="call-overlay">
        <div class="call-avatar" id="call-avatar">👤</div>
        <div class="call-name" id="call-name"></div>
        <div class="call-status" id="call-status">Звонок...</div>
        <div class="call-timer" id="call-timer" style="display:none">00:00</div>
        <button class="call-btn-mute" id="mute-btn" onclick="toggleMute()" style="display:none">🎤</button>
        <div class="call-buttons" id="call-buttons"></div>
    </div>
    
    <script src="/socket.io/socket.io.js"></script>
    <script>
        // ========== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==========
        let socket;
        let token = localStorage.getItem('token') || '';
        let myEmail = localStorage.getItem('myEmail') || '';
        let myProfile = null;
        let currentChat = null;
        let currentGroup = null;
        let editingMsgId = null;
        let contextMsgId = null;
        let typingTimeout = null;
        
        // WebRTC
        let peerConnection;
        let localStream;
        let currentCallId;
        let currentCallWith;
        let callTimerInterval;
        let callStartTime;
        let isMuted = false;
        const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        
        // ========== ИНИЦИАЛИЗАЦИЯ ==========
        function init() {
            if (token && myEmail) {
                socket = io();
                socket.on('connect', () => {
                    socket.emit('join', myEmail);
                });
                
                setupSocketListeners();
                showScreen('chats');
                loadContacts();
            } else {
                showScreen('login');
            }
        }
        
        function setupSocketListeners() {
            socket.on('message', (msg) => {
                if (currentChat === msg.from) {
                    addMessage(msg);
                    socket.emit('readMessages', { chatWith: msg.from });
                }
                loadContacts();
                updateUnreadBadge();
            });
            
            socket.on('messageSelf', (msg) => {
                if (currentChat === msg.to) {
                    addMessage(msg);
                }
                loadContacts();
            });
            
            socket.on('groupMessage', (msg) => {
                if (currentGroup === msg.groupId) {
                    addMessage(msg);
                    socket.emit('readGroupMessages', { groupId: msg.groupId });
                }
                loadContacts();
                updateUnreadBadge();
            });
            
            socket.on('messageEdited', (data) => {
                updateMessageBubble(data.id, data.newText, data.edited, false);
                loadContacts();
            });
            
            socket.on('messageDeleted', (data) => {
                updateMessageBubble(data.id, 'Сообщение удалено', false, true);
                loadContacts();
            });
            
            socket.on('messageRead', (data) => {
                updateMessageReadStatus(data.id);
            });
            
            socket.on('groupMessagesRead', (data) => {
                if (currentGroup === data.groupId) {
                    updateGroupReadStatus(data.groupId);
                }
            });
            
            socket.on('userStatus', (data) => {
                loadContacts();
                if (currentChat === data.email) {
                    updateChatHeader(currentChat);
                }
            });
            
            socket.on('typing', (data) => {
                if (currentChat === data.user) {
                    showTyping(data.user, false);
                }
            });
            
            socket.on('groupTyping', (data) => {
                if (currentGroup === data.groupId && data.user !== myEmail) {
                    showTyping(data.user, true);
                }
            });
            
            socket.on('incomingCall', (data) => {
                showIncomingCall(data);
            });
            
            socket.on('callAccepted', (data) => {
                document.getElementById('call-status').textContent = 'Соединение...';
                document.getElementById('call-buttons').innerHTML = '<button class="call-btn call-btn-end" onclick="endCall()">📞</button>';
                startWebRTC(true);
            });
            
            socket.on('callRejected', (data) => {
                document.getElementById('call-status').textContent = 'Звонок отклонён';
                setTimeout(closeCallOverlay, 1500);
            });
            
            socket.on('callEnded', (data) => {
                document.getElementById('call-status').textContent = 'Звонок завершён';
                setTimeout(closeCallOverlay, 1500);
            });
            
            socket.on('webrtcOffer', async (data) => {
                if (!peerConnection) await startWebRTC(false);
                
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                socket.emit('webrtcAnswer', { to: data.from, answer });
            });
            
            socket.on('webrtcAnswer', async (data) => {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            });
            
            socket.on('webrtcIce', async (data) => {
                if (data.candidate) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                }
            });
            
            socket.on('groupCreated', (data) => {
                loadContacts();
                showToast('Группа создана! 🎉');
            });
            
            socket.on('addedToGroup', (data) => {
                loadContacts();
                showToast('Вас добавили в группу!');
            });
        }
        
        // ========== ЭКРАНЫ ==========
        function showScreen(screen) {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            const screenMap = { 'login': 'login-screen', '2fa': '2fa-screen', 'chats': 'chats-screen', 'chat': 'chat-screen', 'settings': 'settings-screen' };
            const screenId = screenMap[screen] || screen;
            document.getElementById(screenId).classList.add('active');
            
            if (screen === 'settings') loadSettingsUI();
        }
        
        function goBack() {
            currentChat = null;
            currentGroup = null;
            cancelEditMessage();
            closeCallOverlay();
            showScreen('chats');
            loadContacts();
        }
        
        // ========== АВТОРИЗАЦИЯ ==========
        async function register() {
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value.trim();
            document.getElementById('login-error').textContent = '';
            
            if (!email || !password) {
                document.getElementById('login-error').textContent = 'Заполните все поля';
                return;
            }
            
            const data = await request('/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            if (data.error) {
                document.getElementById('login-error').textContent = data.error;
            } else {
                document.getElementById('login-error').textContent = '';
                document.getElementById('login-error').className = 'success';
                document.getElementById('login-error').textContent = 'Код отправлен в Telegram бот!';
                
                localStorage.setItem('pendingEmail', email);
                setTimeout(() => showScreen('2fa'), 1500);
            }
        }
        
        async function login() {
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value.trim();
            document.getElementById('login-error').textContent = '';
            
            if (!email || !password) {
                document.getElementById('login-error').textContent = 'Заполните все поля';
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
                localStorage.setItem('pendingEmail', email);
                showScreen('2fa');
            } else if (data.token) {
                saveSession(data);
            }
        }
        
        async function verify2FA() {
            const email = localStorage.getItem('pendingEmail');
            const code = document.getElementById('2fa-code').value.trim();
            document.getElementById('2fa-error').textContent = '';
            
            if (!code) {
                document.getElementById('2fa-error').textContent = 'Введите код';
                return;
            }
            
            const data = await request('/verify-2fa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code })
            });
            
            if (data.error) {
                document.getElementById('2fa-error').textContent = data.error;
            } else if (data.token) {
                saveSession(data);
            }
        }
        
        function saveSession(data) {
            token = data.token;
            myEmail = data.email;
            myProfile = data.user;
            
            localStorage.setItem('token', token);
            localStorage.setItem('myEmail', myEmail);
            localStorage.removeItem('pendingEmail');
            
            if (myProfile) {
                const theme = myProfile.theme || getSavedTheme();
                const wallpaper = myProfile.wallpaper || getSavedWallpaper();
                const fontSize = myProfile.fontSize || getSavedFontSize();
                document.body.className = theme + ' wallpaper-' + wallpaper + ' font-' + fontSize;
                document.querySelector('meta[name=theme-color]').content = theme === 'dark' ? '#000' : '#f2f2f7';
            }
            
            socket = io();
            socket.on('connect', () => {
                socket.emit('join', myEmail);
            });
            setupSocketListeners();
            
            showScreen('chats');
            loadContacts();
        }
        
        function getSavedTheme() { return localStorage.getItem('theme') || 'dark'; }
        function getSavedWallpaper() { return localStorage.getItem('wallpaper') || 'gradient1'; }
        function getSavedFontSize() { return localStorage.getItem('fontSize') || 'medium'; }
        
        async function request(url, options = {}) {
            try {
                const res = await fetch(url, options);
                return await res.json();
            } catch(e) {
                return { error: 'Ошибка соединения' };
            }
        }
        
        // ========== КОНТАКТЫ ==========
        async function loadContacts() {
            if (!token) return;
            const data = await request('/contacts?token=' + token);
            if (data.error) return;
            
            if (data.myProfile) myProfile = data.myProfile;
            
            const container = document.getElementById('chats-list');
            container.innerHTML = '';
            
            if (data.groups && data.groups.length > 0) {
                const groupsSection = document.createElement('div');
                groupsSection.className = 'settings-section-title';
                groupsSection.textContent = 'Группы';
                groupsSection.style.padding = '16px 16px 8px';
                container.appendChild(groupsSection);
                
                data.groups.forEach(group => {
                    const div = createGroupItem(group);
                    container.appendChild(div);
                });
            }
            
            // Чаты (те у кого есть сообщения)
            const activeChats = data.contacts.filter(c => c.hasMessages);
            const otherChats = data.contacts.filter(c => !c.hasMessages);
            
            if (activeChats.length > 0) {
                const sectionTitle = document.createElement('div');
                sectionTitle.className = 'settings-section-title';
                sectionTitle.textContent = 'Чаты';
                sectionTitle.style.padding = '16px 16px 8px';
                container.appendChild(sectionTitle);
            }
            
            activeChats.forEach(contact => {
                const div = createChatItem(contact);
                container.appendChild(div);
            });
            
            if (otherChats.length > 0) {
                const contactsSection = document.createElement('div');
                contactsSection.className = 'settings-section-title';
                contactsSection.textContent = 'Контакты';
                contactsSection.style.padding = '16px 16px 8px';
                container.appendChild(contactsSection);
                
                otherChats.forEach(contact => {
                    const div = createChatItem(contact);
                    container.appendChild(div);
                });
            }
            
            if (activeChats.length === 0 && otherChats.length === 0 && (!data.groups || data.groups.length === 0)) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="icon">👋</div>
                        <p>Нет чатов</p>
                        <p style="color:var(--text-secondary);font-size:14px">Нажмите + чтобы найти пользователя</p>
                    </div>
                \`;
            }
        }
        
        function createChatItem(contact) {
            const div = document.createElement('div');
            div.className = 'chat-item';
            
            const lastMsg = contact.lastMessage;
            const lastText = lastMsg ? (lastMsg.deleted ? 'Сообщение удалено' : (lastMsg.type === 'heart' ? '❤️' : lastMsg.type === 'like' ? '👍' : lastMsg.type === 'fire' ? '🔥' : lastMsg.type === 'rocket' ? '🚀' : lastMsg.text)) : '';
            const timeStr = lastMsg ? formatTime(lastMsg.time) : '';
            const isMyMsg = lastMsg && lastMsg.from === myEmail;
            const prefix = isMyMsg ? 'Вы: ' : '';
            const readStatus = lastMsg && isMyMsg ? (lastMsg.read ? ' ✓✓' : ' ✓') : '';
            
            div.innerHTML = \`
                <div class="avatar">\${contact.avatar ? '<img src="'+contact.avatar+'">' : '👤'}</div>
                <div class="chat-info">
                    <div class="chat-name">\${contact.nickname || contact.email}\${readStatus ? '<span style="color:#0a84ff;font-size:12px">'+readStatus+'</span>' : ''}</div>
                    <div class="chat-preview">\${prefix}\${lastText}</div>
                    \${contact.unread > 0 ? '<div class="unread-badge">'+contact.unread+'</div>' : ''}
                </div>
                \${timeStr ? '<div class="chat-time">'+timeStr+'</div>' : ''}
                \${contact.online ? '<div class="online-dot" style="position:static;width:8px;height:8px;margin-left:6px"></div>' : ''}
            \`;
            
            div.onclick = () => openChat(contact.email);
            return div;
        }
        
        function createGroupItem(group) {
            const div = document.createElement('div');
            div.className = 'chat-item';
            
            const lastMsg = group.lastMessage;
            const lastText = lastMsg ? (lastMsg.text || '') : '';
            const timeStr = lastMsg ? formatTime(lastMsg.time) : '';
            
            div.innerHTML = \`
                <div class="avatar group-avatar">\${group.avatar ? '<img src="'+group.avatar+'">' : '👥'}</div>
                <div class="chat-info">
                    <div class="chat-name">\${group.name} <span style="font-size:12px;color:var(--text-secondary)">(\${group.members ? group.members.length : ''})</span></div>
                    <div class="chat-preview">\${lastText}</div>
                    \${group.unread > 0 ? '<div class="unread-badge">'+group.unread+'</div>' : ''}
                </div>
                \${timeStr ? '<div class="chat-time">'+timeStr+'</div>' : ''}
            \`;
            
            div.onclick = () => openGroup(group.id);
            return div;
        }
        
        function updateUnreadBadge() {
            if (currentChat || currentGroup) return; 
            loadContacts();
        }
        
        function showNewChatModal() {
            document.getElementById('search-email').value = '';
            document.getElementById('search-error').textContent = '';
            document.getElementById('search-result').innerHTML = '';
            document.getElementById('new-chat-modal').classList.add('active');
        }
        
        function closeModal(id) {
            document.getElementById(id).classList.remove('active');
        }
        
        async function searchUser() {
            const email = document.getElementById('search-email').value.trim();
            document.getElementById('search-error').textContent = '';
            document.getElementById('search-result').innerHTML = '';
            
            if (!email) {
                document.getElementById('search-error').textContent = 'Введите email';
                return;
            }
            
            const data = await request('/find-user?token='+token+'&email='+email);
            
            if (data.error) {
                document.getElementById('search-error').textContent = data.error;
            } else if (data.found) {
                document.getElementById('search-result').innerHTML = \`
                    <div class="chat-item" onclick="openChat('\${data.email}');closeModal('new-chat-modal')">
                        <div class="avatar">\${data.avatar ? '<img src="'+data.avatar+'">' : '👤'}</div>
                        <div class="chat-info">
                            <div class="chat-name">\${data.nickname || data.email}</div>
                            <div class="chat-preview">\${data.status || ''}</div>
                        </div>
                        \${data.online ? '<div class="online-dot" style="position:static;width:8px;height:8px;margin-left:6px"></div>' : ''}
                    </div>
                \`;
            }
        }
        
        // ========== ГРУППЫ ==========
        function createGroup() {
            document.getElementById('group-name-input').value = '';
            document.getElementById('group-members-input').value = '';
            document.getElementById('group-error').textContent = '';
            document.getElementById('group-modal').classList.add('active');
        }
        
        async function createGroupAction() {
            const name = document.getElementById('group-name-input').value.trim();
            const membersStr = document.getElementById('group-members-input').value.trim();
            document.getElementById('group-error').textContent = '';
            
            if (!name) {
                document.getElementById('group-error').textContent = 'Введите название';
                return;
            }
            
            const members = membersStr.split(',').map(m => m.trim()).filter(m => m && m !== myEmail);
            
            if (members.length < 1) {
                document.getElementById('group-error').textContent = 'Добавьте хотя бы одного участника';
                return;
            }
            
            const data = await request('/create-group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, name, members })
            });
            
            if (data.error) {
                document.getElementById('group-error').textContent = data.error;
            } else {
                closeModal('group-modal');
                showToast('Группа создана!');
                loadContacts();
                openGroup(data.groupId);
            }
        }
        
        function showGroupInfo() {
            const modal = document.getElementById('group-info-modal');
            const inner = document.getElementById('group-info-inner');
            document.getElementById('group-modal').classList.add('active');
            
            request('/group-messages?token='+token+'&groupId='+currentGroup).then(data => {
                if (data.group) {
                    const group = data.group;
                    inner.innerHTML = \`
                        <div style="text-align:center;margin-bottom:16px">
                            <div class="avatar group-avatar" style="width:60px;height:60px;font-size:28px;margin:0 auto 8px">\${group.avatar ? '<img src="'+group.avatar+'">' : '👥'}</div>
                            <div style="font-weight:600;font-size:calc(18px * var(--fs))">\${group.name}</div>
                            <div style="color:var(--text-secondary);font-size:13px">\${group.members.length} участников</div>
                        </div>
                        <div class="settings-section-title">Участники</div>
                        <div class="group-members-list">
                            \${group.members.map(m => \`
                                <div class="group-member-chip">
                                    <div class="mini-avatar">\${m.avatar ? '<img src="'+m.avatar+'">' : '👤'}</div>
                                    <span>\${m.nickname || m.email}</span>
                                    \${m.online ? '<div class="online-dot" style="position:static;width:6px;height:6px"></div>' : ''}
                                </div>
                            \`).join('')}
                        </div>
                        <div class="input-group" style="margin-top:16px">
                            <input type="email" id="add-member-input" placeholder="Email для добавления">
                        </div>
                        <button class="btn btn-primary" onclick="addMemberToGroup()" style="margin-top:8px">Добавить участника</button>
                    \`;
                    modal.classList.add('active');
                }
            });
        }
        
        async function addMemberToGroup() {
            const email = document.getElementById('add-member-input').value.trim();
            if (!email) return;
            
            const data = await request('/add-group-members', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, groupId: currentGroup, members: [email] })
            });
            
            if (data.error) {
                showToast(data.error);
            } else {
                showToast('Участник добавлен');
                closeModal('group-info-modal');
                loadContacts();
            }
        }
        
        // ========== ЧАТ ==========
        async function openChat(email) {
            currentChat = email;
            currentGroup = null;
            showScreen('chat');
            
            document.getElementById('message-input-bar').style.display = 'flex';
            document.getElementById('edit-message-bar').style.display = 'none';
            document.getElementById('chat-call-btn').style.display = 'block';
            document.getElementById('chat-group-info-btn').style.display = 'none';
            document.getElementById('message-input').value = '';
            
            updateChatHeader(email);
            await loadMessages();
            scrollToBottom();
        }
        
        async function openGroup(groupId) {
            currentGroup = groupId;
            currentChat = null;
            showScreen('chat');
            
            document.getElementById('message-input-bar').style.display = 'flex';
            document.getElementById('edit-message-bar').style.display = 'none';
            document.getElementById('chat-call-btn').style.display = 'none';
            document.getElementById('chat-group-info-btn').style.display = 'block';
            document.getElementById('message-input').value = '';
            
            await updateGroupHeader(groupId);
            await loadGroupMessages();
            scrollToBottom();
        }
        
        async function updateChatHeader(email) {
            const data = await request('/messages?token='+token+'&with='+email);
            if (data.chatUser) {
                document.getElementById('chat-user-name').textContent = data.chatUser.nickname || email;
                document.getElementById('chat-user-status').textContent = data.chatUser.online ? 'онлайн' : 'был(а) недавно';
            }
        }
        
        async function updateGroupHeader(groupId) {
            const data = await request('/group-messages?token='+token+'&groupId='+groupId);
            if (data.group) {
                document.getElementById('chat-user-name').textContent = data.group.name;
                const onlineCount = data.group.members.filter(m => m.online).length;
                document.getElementById('chat-user-status').textContent = data.group.members.length + ' участников, ' + onlineCount + ' онлайн';
            }
        }
        
        async function loadMessages() {
            if (!currentChat) return;
            const data = await request('/messages?token='+token+'&with='+currentChat);
            renderMessages(data.messages || []);
        }
        
        async function loadGroupMessages() {
            if (!currentGroup) return;
            const data = await request('/group-messages?token='+token+'&groupId='+currentGroup);
            renderMessages(data.messages || []);
        }
        
        function renderMessages(msgs) {
            const container = document.getElementById('chat-messages');
            container.innerHTML = '';
            
            msgs.forEach(msg => {
                addMessage(msg);
            });
        }
        
        function addMessage(msg) {
            const container = document.getElementById('chat-messages');
            const existing = document.getElementById('msg-' + msg.id);
            if (existing) return; 
            
            const isMine = msg.from === myEmail;
            const isSystem = msg.from === 'system';
            const isGroup = !!msg.groupId;
            
            const row = document.createElement('div');
            row.id = 'msg-' + msg.id;
            row.className = 'message-row ' + (isSystem ? 'system' : (isMine ? 'sent' : 'received'));
            
            const bubbleText = msg.deleted ? 'Сообщение удалено' : (msg.type === 'heart' ? '❤️' : msg.type === 'like' ? '👍' : msg.type === 'fire' ? '🔥' : msg.type === 'rocket' ? '🚀' : msg.type === 'laugh' ? '😂' : msg.type === 'love' ? '😍' : msg.text);
            const bubbleClass = 'message-bubble ' + (msg.deleted ? 'deleted' : '') + (msg.edited ? ' edited-badge' : '') + (msg.type && msg.type !== 'text' ? ' ' + msg.type : '');
            
            let senderHtml = '';
            if (isGroup && !isMine && !isSystem && msg.from) {
                const sender = msg.from;
                senderHtml = '<div class="group-message-sender">' + (sender) + '</div>';
            }
            
            row.innerHTML = \`
                \${senderHtml}
                <div class="message-bubble \${bubbleClass}">\${bubbleText}</div>
                <div class="message-time">
                    \${formatTime(msg.time)}
                    \${msg.edited ? '<span class="edited-label">изм.</span>' : ''}
                </div>
                <div class="message-read-status" id="read-status-\${msg.id}">
                    \${getReadStatus(msg)}
                </div>
                \${isMine && !isSystem ? \`
                    <div class="message-actions">
                        <button class="action-btn" onclick="startEditMessage('\${msg.id}','\${escapeHtml(bubbleText)}')">✎</button>
                        <button class="action-btn" onclick="deleteMessage('\${msg.id}')">✕</button>
                    </div>
                \` : ''}
            \`;
            
            container.appendChild(row);
            scrollToBottom();
        }
        
        function getReadStatus(msg) {
            if (msg.from !== myEmail) return '';
            if (msg.groupId && msg.readBy) {
                return '✓✓ ' + msg.readBy.length;
            }
            if (msg.read) return '✓✓';
            return '✓';
        }
        
        function updateMessageBubble(id, newText, edited, deleted) {
            const row = document.getElementById('msg-' + id);
            if (!row) return;
            
            const bubble = row.querySelector('.message-bubble');
            if (bubble) {
                bubble.textContent = deleted ? 'Сообщение удалено' : newText;
                if (deleted) {
                    bubble.classList.add('deleted');
                }
                if (edited) {
                    bubble.classList.add('edited-badge');
                }
            }
        }
        
        function updateMessageReadStatus(id) {
            const statusEl = document.getElementById('read-status-' + id);
            if (statusEl) {
                statusEl.textContent = '✓✓';
            }
        }
        
        function updateGroupReadStatus(groupId) {
            const statusEls = document.querySelectorAll('[id^="read-status-"]');
        }
        
        function sendMessage() {
            const input = document.getElementById('message-input');
            const text = input.value.trim();
            if (!text) return;
            
            if (currentGroup) {
                socket.emit('groupMessage', {
                    groupId: currentGroup,
                    text,
                    time: Date.now()
                });
            } else if (currentChat) {
                socket.emit('message', {
                    to: currentChat,
                    text,
                    time: Date.now()
                });
            }
            
            input.value = '';
            document.getElementById('effects-bar').style.display = 'none';
        }
        
        function sendEffect(emoji, type) {
            if (currentGroup) {
                socket.emit('groupMessage', {
                    groupId: currentGroup,
                    text: emoji,
                    type,
                    time: Date.now()
                });
            } else if (currentChat) {
                socket.emit('message', {
                    to: currentChat,
                    text: emoji,
                    type,
                    time: Date.now()
                });
            }
            document.getElementById('effects-bar').style.display = 'none';
        }
        
        function toggleEffects() {
            const bar = document.getElementById('effects-bar');
            bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
        }
        
        function onKeyPress(e) {
            if (e.key === 'Enter' && !editingMsgId) {
                sendMessage();
            }
        }
        
        function onTyping() {
            if (typingTimeout) clearTimeout(typingTimeout);
            
            if (currentGroup) {
                socket.emit('groupTyping', { groupId: currentGroup });
            } else if (currentChat) {
                socket.emit('typing', currentChat);
            }
            
            typingTimeout = setTimeout(() => {
                // Перестаем печатать
            }, 2000);
        }
        
        function showTyping(user, isGroup) {
            const indicator = document.getElementById('typing-indicator');
            const text = document.getElementById('typing-text');
            
            if (isGroup) {
                text.textContent = user + ' печатает...';
            } else {
                text.textContent = 'печатает...';
            }
            
            indicator.style.display = 'flex';
            clearTimeout(window._typingHideTimeout);
            window._typingHideTimeout = setTimeout(() => {
                indicator.style.display = 'none';
            }, 3000);
        }
        
        // ========== РЕДАКТИРОВАНИЕ ==========
        function startEditMessage(id, text) {
            editingMsgId = id;
            document.getElementById('message-input-bar').style.display = 'none';
            document.getElementById('edit-message-bar').style.display = 'flex';
            document.getElementById('edit-message-input').value = text;
            document.getElementById('edit-message-input').focus();
            
            const el = document.getElementById('msg-' + id);
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }
        
        function cancelEditMessage() {
            editingMsgId = null;
            document.getElementById('message-input-bar').style.display = 'flex';
            document.getElementById('edit-message-bar').style.display = 'none';
            document.getElementById('edit-message-input').value = '';
        }
        
        function saveEditMessage() {
            if (!editingMsgId) return;
            
            const newText = document.getElementById('edit-message-input').value.trim();
            if (!newText) {
                cancelEditMessage();
                return;
            }
            
            socket.emit('editMessage', { id: editingMsgId, newText });
            cancelEditMessage();
        }
        
        async function deleteMessage(id) {
            if (!confirm('Удалить сообщение?')) return;
            socket.emit('deleteMessage', { id });
        }
        
        // ========== ПРОФИЛЬ И НАСТРОЙКИ ==========
        function loadSettingsUI() {
            const container = document.getElementById('settings-content');
            container.innerHTML = \`
                <div class="profile-header">
                    <div class="profile-avatar" onclick="document.getElementById('avatar-input').click()">
                        \${myProfile && myProfile.avatar ? '<img src="'+myProfile.avatar+'">' : '👤'}
                        <div class="profile-avatar-overlay">📷</div>
                    </div>
                    <input type="file" id="avatar-input" class="file-input-hidden" accept="image/*" onchange="uploadAvatar(event)">
                    <div class="profile-nickname">\${myProfile ? myProfile.nickname : ''}</div>
                    <div class="profile-status">\${myProfile ? myProfile.status : ''}</div>
                </div>
                
                <div class="settings-section">
                    <div class="settings-section-title">Профиль</div>
                    <div class="settings-item" onclick="editNickaname()">
                        <span class="settings-label">Имя</span>
                        <span class="settings-value">\${myProfile ? myProfile.nickname : ''}</span>
                        <span class="settings-arrow">›</span>
                    </div>
                    <div class="settings-item" onclick="editStatus()">
                        <span class="settings-label">Статус</span>
                        <span class="settings-value">\${myProfile ? myProfile.status : ''}</span>
                        <span class="settings-arrow">›</span>
                    </div>
                </div>
                
                <div class="settings-section">
                    <div class="settings-section-title">Оформление</div>
                    <div class="settings-item" onclick="toggleTheme()">
                        <span class="settings-label">Тёмная тема</span>
                        <div class="toggle \${document.body.classList.contains('dark') ? 'active' : ''}" id="theme-toggle"></div>
                    </div>
                    <div class="settings-item" onclick="showWallpaperModal()">
                        <span class="settings-label">Обои</span>
                        <span class="settings-value">\${getWallpaperName()}</span>
                        <span class="settings-arrow">›</span>
                    </div>
                    <div class="settings-item" onclick="showFontSizeModal()">
                        <span class="settings-label">Размер шрифта</span>
                        <span class="settings-value">\${getFontSizeName()}</span>
                        <span class="settings-arrow">›</span>
                    </div>
                </div>
                
                <div class="settings-section">
                    <div class="settings-section-title">Уведомления</div>
                    <div class="settings-item" onclick="toggleSound()">
                        <span class="settings-label">Звук</span>
                        <div class="toggle \${myProfile && myProfile.sound !== false ? 'active' : ''}" id="sound-toggle"></div>
                    </div>
                </div>
                
                <div class="settings-section">
                    <div class="settings-item" onclick="logout()" style="color:var(--danger);justify-content:center">
                        <span class="settings-label" style="text-align:center;color:var(--danger)">Выйти</span>
                    </div>
                </div>
            \`;
        }
        
        function getWallpaperName() {
            const map = { gradient1: 'Синий', gradient2: 'Изумруд', space: 'Космос', sunset: 'Закат', ocean: 'Океан' };
            return map[getSavedWallpaper()] || 'Синий';
        }
        
        function getFontSizeName() {
            const map = { small: 'Маленький', medium: 'Средний', large: 'Большой', xlarge: 'Огромный' };
            return map[getSavedFontSize()] || 'Средний';
        }
        
        function editNickaname() {
            document.getElementById('edit-modal-title').textContent = 'Изменить имя';
            document.getElementById('edit-input').value = myProfile ? myProfile.nickname || '' : '';
            document.getElementById('edit-modal').classList.add('active');
            window._editField = 'nickname';
        }
        
        function editStatus() {
            document.getElementById('edit-modal-title').textContent = 'Изменить статус';
            document.getElementById('edit-input').value = myProfile ? myProfile.status || '' : '';
            document.getElementById('edit-modal').classList.add('active');
            window._editField = 'status';
        }
        
        async function saveEdit() {
            const value = document.getElementById('edit-input').value.trim();
            const field = window._editField;
            
            const body = { token };
            body[field] = value;
            
            const data = await request('/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            if (data.success && data.user) {
                myProfile = data.user;
                applyUserSettings(data.user);
            }
            
            closeModal('edit-modal');
            loadSettingsUI();
        }
        
        function uploadAvatar(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = async function(e) {
                const data = await request('/update-profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, avatar: e.target.result })
                });
                
                if (data.success && data.user) {
                    myProfile = data.user;
                    loadSettingsUI();
                    loadContacts();
                }
            };
            reader.readAsDataURL(file);
        }
        
        function toggleTheme() {
            const current = document.body.classList.contains('dark') ? 'light' : 'dark';
            applySetting('theme', current);
            document.body.className = document.body.className.replace(/dark|light/, current);
            document.querySelector('meta[name=theme-color]').content = current === 'dark' ? '#000' : '#f2f2f7';
            localStorage.setItem('theme', current);
            loadSettingsUI();
        }
        
        function showWallpaperModal() {
            const wallpapers = [
                { id: 'gradient1', name: 'Синий', gradient: 'linear-gradient(135deg,#1a1a2e,#16213e)' },
                { id: 'gradient2', name: 'Изумруд', gradient: 'linear-gradient(135deg,#0f2027,#2c5364)' },
                { id: 'space', name: 'Космос', gradient: 'linear-gradient(135deg,#0c0c1d,#1a1a3e)' },
                { id: 'sunset', name: 'Закат', gradient: 'linear-gradient(135deg,#ff512f,#dd2476)' },
                { id: 'ocean', name: 'Океан', gradient: 'linear-gradient(135deg,#2193b0,#6dd5ed)' }
            ];
            
            const currentWallpaper = getSavedWallpaper();
            
            const modal = document.createElement('div');
            modal.className = 'modal active';
            modal.id = 'wallpaper-modal';
            modal.innerHTML = \`
                <div class="modal-content">
                    <div class="modal-handle"></div>
                    <div class="modal-title">Выберите обои</div>
                    <div class="wallpaper-grid">
                        \${wallpapers.map(w => \`
                            <div class="wallpaper-option \${w.id === currentWallpaper ? 'selected' : ''}" 
                                 style="background:\${w.gradient}" 
                                 onclick="selectWallpaper('\${w.id}')">\${w.name}</div>
                        \`).join('')}
                    </div>
                    <button class="btn btn-secondary" onclick="document.getElementById('wallpaper-modal').remove()">Закрыть</button>
                </div>
            \`;
            document.body.appendChild(modal);
        }
        
        async function selectWallpaper(id) {
            applySetting('wallpaper', id);
            document.body.className = document.body.className.replace(/wallpaper-\w+/, 'wallpaper-' + id);
            localStorage.setItem('wallpaper', id);
            
            const modal = document.getElementById('wallpaper-modal');
            if (modal) modal.remove();
            
            loadSettingsUI();
        }
        
        function showFontSizeModal() {
            const sizes = [
                { id: 'small', name: 'A-', label: 'Маленький' },
                { id: 'medium', name: 'A', label: 'Средний' },
                { id: 'large', name: 'A+', label: 'Большой' },
                { id: 'xlarge', name: 'A++', label: 'Огромный' }
            ];
            
            const currentFont = getSavedFontSize();
            
            const modal = document.createElement('div');
            modal.className = 'modal active';
            modal.id = 'fontsize-modal';
            modal.innerHTML = \`
                <div class="modal-content">
                    <div class="modal-handle"></div>
                    <div class="modal-title">Размер шрифта</div>
                    <div class="font-size-btns" style="display:flex;gap:8px;justify-content:center">
                        \${sizes.map(s => \`
                            <button class="font-size-btn \${s.id === currentFont ? 'selected' : ''}" 
                                    onclick="selectFontSize('\${s.id}')">\${s.label}</button>
                        \`).join('')}
                    </div>
                    <button class="btn btn-secondary" onclick="document.getElementById('fontsize-modal').remove()" style="margin-top:16px">Закрыть</button>
                </div>
            \`;
            document.body.appendChild(modal);
        }
        
        async function selectFontSize(id) {
            applySetting('fontSize', id);
            document.body.className = document.body.className.replace(/font-\w+/, 'font-' + id);
            localStorage.setItem('fontSize', id);
            
            const modal = document.getElementById('fontsize-modal');
            if (modal) modal.remove();
            
            loadSettingsUI();
        }
        
        function toggleSound() {
            const newVal = myProfile && myProfile.sound === false ? true : false;
            applySetting('sound', newVal);
            const toggle = document.getElementById('sound-toggle');
            if (toggle) toggle.classList.toggle('active', newVal);
        }
        
        async function applySetting(key, value) {
            const body = { token };
            body[key] = value;
            
            const data = await request('/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            if (data.success && data.user) {
                myProfile = data.user;
            }
        }
        
        function applyUserSettings(user) {
            if (user.theme) {
                document.body.className = document.body.className.replace(/dark|light/, user.theme + ' wallpaper-' + (user.wallpaper || 'gradient1') + ' font-' + (user.fontSize || 'medium'));
                document.querySelector('meta[name=theme-color]').content = user.theme === 'dark' ? '#000' : '#f2f2f7';
                localStorage.setItem('theme', user.theme);
            }
            if (user.wallpaper) localStorage.setItem('wallpaper', user.wallpaper);
            if (user.fontSize) localStorage.setItem('fontSize', user.fontSize);
        }
        
        function logout() {
            localStorage.clear();
            token = '';
            myEmail = '';
            myProfile = null;
            currentChat = null;
            currentGroup = null;
            if (socket) socket.disconnect();
            document.body.className = 'dark wallpaper-gradient1 font-medium';
            showScreen('login');
        }
        
        // ========== ЗВОНКИ ==========
        function startCall() {
            if (!currentChat) return;
            
            currentCallWith = currentChat;
            socket.emit('callRequest', { to: currentChat });
            
            document.getElementById('call-overlay').classList.add('active');
            document.getElementById('call-name').textContent = currentChat;
            document.getElementById('call-status').textContent = 'Звонок...';
            document.getElementById('call-buttons').innerHTML = '<button class="call-btn call-btn-end" onclick="endCall()">📞</button>';
        }
        
        function showIncomingCall(data) {
            document.getElementById('call-overlay').classList.add('active');
            document.getElementById('call-name').textContent = data.nickname || data.from;
            document.getElementById('call-status').textContent = 'Входящий звонок...';
            document.getElementById('call-buttons').innerHTML = \`
                <button class="call-btn call-btn-reject" onclick="rejectCall('\${data.callId}')">📞</button>
                <button class="call-btn call-btn-accept" onclick="acceptCall('\${data.callId}')">📞</button>
            \`;
            
            currentCallId = data.callId;
            currentCallWith = data.from;
        }
        
        function acceptCall(callId) {
            socket.emit('callResponse', { callId, response: 'accept' });
            document.getElementById('call-status').textContent = 'Соединение...';
            document.getElementById('call-buttons').innerHTML = '<button class="call-btn call-btn-end" onclick="endCall()">📞</button>';
            document.getElementById('mute-btn').style.display = 'flex';
            
            setTimeout(() => startWebRTC(true), 500);
        }
        
        function rejectCall(callId) {
            socket.emit('callResponse', { callId, response: 'reject' });
            closeCallOverlay();
        }
        
        function endCall() {
            if (currentCallId) {
                socket.emit('callEnd', { callId: currentCallId });
            }
            closeCallOverlay();
        }
        
        function closeCallOverlay() {
            document.getElementById('call-overlay').classList.remove('active');
            document.getElementById('mute-btn').style.display = 'none';
            document.getElementById('call-timer').style.display = 'none';
            
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            if (callTimerInterval) {
                clearInterval(callTimerInterval);
                callTimerInterval = null;
            }
            
            currentCallId = null;
            currentCallWith = null;
            isMuted = false;
            document.getElementById('mute-btn').classList.remove('muted');
        }
        
        async function startWebRTC(isCaller) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                
                peerConnection = new RTCPeerConnection(rtcConfig);
                
                localStream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, localStream);
                });
                
                peerConnection.onconnectionstatechange = () => {
                    if (peerConnection.connectionState === 'connected') {
                        document.getElementById('call-status').textContent = 'Разговор';
                        document.getElementById('mute-btn').style.display = 'flex';
                        startCallTimer();
                    } else if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
                        document.getElementById('call-status').textContent = 'Связь потеряна';
                        setTimeout(closeCallOverlay, 2000);
                    }
                };
                
                peerConnection.onicecandidate = (event) => {
                    if (event.candidate && currentCallWith) {
                        socket.emit('webrtcIce', { to: currentCallWith, candidate: event.candidate });
                    }
                };
                
                if (isCaller) {
                    const offer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(offer);
                    socket.emit('webrtcOffer', { to: currentCallWith, offer });
                }
            } catch(e) {
                console.error('WebRTC error:', e);
                showToast('Нет доступа к микрофону');
                closeCallOverlay();
            }
        }
        
        function toggleMute() {
            if (localStream) {
                isMuted = !isMuted;
                localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
                document.getElementById('mute-btn').classList.toggle('muted', isMuted);
                document.getElementById('mute-btn').textContent = isMuted ? '🔇' : '🎤';
            }
        }
        
        function startCallTimer() {
            callStartTime = Date.now();
            document.getElementById('call-timer').style.display = 'block';
            
            callTimerInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
                const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
                const secs = (elapsed % 60).toString().padStart(2, '0');
                document.getElementById('call-timer').textContent = mins + ':' + secs;
            }, 1000);
        }
        
        // ========== УТИЛИТЫ ==========
        function formatTime(ts) {
            const date = new Date(ts);
            const now = new Date();
            const hours = date.getHours().toString().padStart(2, '0');
            const mins = date.getMinutes().toString().padStart(2, '0');
            
            if (date.toDateString() === now.toDateString()) {
                return hours + ':' + mins;
            }
            
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            if (date.toDateString() === yesterday.toDateString()) {
                return 'Вчера ' + hours + ':' + mins;
            }
            
            return date.getDate().toString().padStart(2, '0') + '.' + 
                   (date.getMonth()+1).toString().padStart(2, '0') + '.' + 
                   date.getFullYear().toString().slice(2);
        }
        
        function scrollToBottom() {
            setTimeout(() => {
                const container = document.getElementById('chat-messages');
                container.scrollTop = container.scrollHeight;
            }, 100);
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function showToast(msg) {
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = msg;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2500);
        }
        
        document.addEventListener('click', function(e) {
            document.querySelectorAll('.modal.active').forEach(modal => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });
        
        // ========== ЗАПУСК ==========
        init();
    </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 Messages сервер запущен: http://localhost:${PORT}`);
    console.log('================================');
    console.log('🔐 2FA через Telegram бота');
    console.log('👥 Поддержка групп');
    console.log('✏️  Редактирование и удаление сообщений');
    console.log('📞 Аудиозвонки (WebRTC)');
    console.log('🎨 Тёмная/светлая тема, обои, шрифты');
    console.log('✅ Статусы прочитано✓/не прочитано✓✓');
    console.log('================================\n');
});
