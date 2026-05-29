const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const accounts = new Map();
const onlineUsers = new Map();

const clientDir = path.join(__dirname, 'client');
if (!fs.existsSync(clientDir)) {
    fs.mkdirSync(clientDir, { recursive: true });
}

const htmlContent = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SecureChat</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);height:100vh}
.auth-screen{display:flex;justify-content:center;align-items:center;height:100vh;padding:20px}
.auth-box{background:rgba(255,255,255,0.95);border-radius:20px;padding:40px;box-shadow:0 8px 32px rgba(0,0,0,0.3);width:100%;max-width:400px;text-align:center}
.auth-box h2{color:#667eea;margin-bottom:10px;font-size:2rem}
.auth-input{width:100%;padding:12px 16px;margin-bottom:15px;border:2px solid #e0e0e0;border-radius:10px;font-size:1rem;outline:none}
.auth-input:focus{border-color:#667eea}
.auth-button{width:100%;padding:14px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;border-radius:10px;font-size:1.1rem;cursor:pointer;margin-bottom:15px}
.auth-link{color:#667eea;cursor:pointer;text-decoration:underline}
.error-message{color:#f44336;margin:10px 0;font-size:.9rem}
.app-container{max-width:1200px;height:90vh;margin:5vh auto;background:rgba(255,255,255,0.95);border-radius:20px;box-shadow:0 8px 32px rgba(0,0,0,0.3);display:flex;overflow:hidden}
.sidebar{width:300px;background:#f8f9fa;border-right:1px solid #e0e0e0;display:flex;flex-direction:column}
.sidebar-header{padding:20px;background:linear-gradient(135deg,#667eea,#764ba2);color:white}
.user-info{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.logout-btn{background:rgba(255,255,255,0.2);border:none;color:white;padding:5px 12px;border-radius:5px;cursor:pointer}
.chats-list{flex:1;overflow-y:auto}
.chat-item{padding:15px 20px;cursor:pointer;border-bottom:1px solid #eee}
.chat-item:hover{background:#e3f2fd}
.chat-item.active{background:#bbdefb;border-left:3px solid #667eea}
.chat-item-name{font-weight:500;color:#333}
.online-user{padding:8px 12px;margin:3px 0;cursor:pointer;border-radius:8px;display:flex;align-items:center;gap:8px}
.online-user:hover{background:#e3f2fd}
.online-dot{width:8px;height:8px;background:#4caf50;border-radius:50%}
.chat-area{flex:1;display:flex;flex-direction:column}
.chat-header{padding:20px;background:white;border-bottom:1px solid #e0e0e0}
.messages-container{flex:1;overflow-y:auto;padding:20px;background:#f5f5f5}
.message{margin-bottom:15px;display:flex;flex-direction:column}
.message.own{align-items:flex-end}
.message-bubble{padding:10px 16px;border-radius:18px;max-width:70%;word-wrap:break-word}
.message.other .message-bubble{background:white;box-shadow:0 2px 5px rgba(0,0,0,0.1)}
.message.own .message-bubble{background:linear-gradient(135deg,#667eea,#764ba2);color:white}
.input-container{padding:20px;background:white;display:flex;gap:10px;border-top:1px solid #eee}
#messageInput{flex:1;padding:12px 16px;border:2px solid #e0e0e0;border-radius:25px;font-size:.95rem;outline:none}
#sendButton{padding:12px 25px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;border-radius:25px;cursor:pointer}
.no-chat{flex:1;display:flex;align-items:center;justify-content:center;color:#999}
</style>
</head>
<body>
<div id="loginScreen" class="auth-screen">
<div class="auth-box">
<h2>SecureChat</h2>
<p>Войдите в аккаунт</p>
<input type="text" id="loginUsername" class="auth-input" placeholder="Логин" maxlength="20">
<input type="password" id="loginPassword" class="auth-input" placeholder="Пароль">
<div class="error-message" id="loginError" style="display:none"></div>
<button class="auth-button" onclick="login()">Войти</button>
<p>Нет аккаунта? <span class="auth-link" onclick="showRegister()">Создать</span></p>
</div>
</div>
<div id="registerScreen" class="auth-screen" style="display:none">
<div class="auth-box">
<h2>Регистрация</h2>
<p>Создайте аккаунт</p>
<input type="text" id="regUsername" class="auth-input" placeholder="Логин" maxlength="20">
<input type="password" id="regPassword" class="auth-input" placeholder="Пароль">
<input type="password" id="regPasswordConfirm" class="auth-input" placeholder="Подтвердите пароль">
<div class="error-message" id="regError" style="display:none"></div>
<button class="auth-button" onclick="register()">Создать</button>
<p>Есть аккаунт? <span class="auth-link" onclick="showLogin()">Войти</span></p>
</div>
</div>
<div id="chatScreen" style="display:none" class="app-container">
<div class="sidebar">
<div class="sidebar-header">
<div class="user-info"><h2>Чаты</h2><button class="logout-btn" onclick="logout()">Выйти</button></div>
<div id="currentUsername"></div>
<input type="text" id="searchUser" placeholder="Поиск..." onkeyup="filterUsers()" style="margin-top:10px;width:100%;padding:8px;border:none;border-radius:20px">
</div>
<div class="chats-list" id="chatsList"></div>
<div style="border-top:2px solid #e0e0e0;padding:10px">
<div style="font-size:.8rem;color:#999;padding:5px">Онлайн</div>
<div id="usersList"></div>
</div>
</div>
<div class="chat-area">
<div class="chat-header"><h3 id="chatTitle">Выберите чат</h3></div>
<div class="messages-container" id="messagesContainer"><div class="no-chat">Выберите пользователя</div></div>
<div class="input-container" id="inputContainer" style="display:none">
<input type="text" id="messageInput" placeholder="Сообщение..." maxlength="500">
<button id="sendButton" onclick="sendMessage()">Отпр.</button>
</div>
</div>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
var socket, currentUser=null, currentChat=null, allChats=[], onlineUsersList=[];
function showRegister(){document.getElementById('loginScreen').style.display='none';document.getElementById('registerScreen').style.display='flex'}
function showLogin(){document.getElementById('registerScreen').style.display='none';document.getElementById('loginScreen').style.display='flex'}
function login(){var u=document.getElementById('loginUsername').value.trim();var p=document.getElementById('loginPassword').value;if(!u||!p){showError('loginError','Заполните все поля');return}socket.emit('login',{username:u,password:p})}
function register(){var u=document.getElementById('regUsername').value.trim();var p=document.getElementById('regPassword').value;var pc=document.getElementById('regPasswordConfirm').value;if(!u||!p){showError('regError','Заполните поля');return}if(u.length<3){showError('regError','Минимум 3 символа');return}if(p.length<4){showError('regError','Пароль от 4 символов');return}if(p!==pc){showError('regError','Пароли не совпадают');return}socket.emit('register',{username:u,password:p})}
function showError(id,msg){var el=document.getElementById(id);el.textContent=msg;el.style.display='block';setTimeout(function(){el.style.display='none'},3000)}
function logout(){socket.emit('logout');socket.disconnect();currentUser=null;currentChat=null;allChats=[];document.getElementById('chatScreen').style.display='none';document.getElementById('loginScreen').style.display='flex'}
function connectSocket(){socket=io();socket.on('authSuccess',function(d){currentUser=d;document.getElementById('currentUsername').textContent=d.username;document.getElementById('loginScreen').style.display='none';document.getElementById('registerScreen').style.display='none';document.getElementById('chatScreen').style.display='flex';allChats=d.chats||[];updateChatsList()});socket.on('authError',function(d){showError('loginError',d.message)});socket.on('regSuccess',function(){showLogin();alert('Аккаунт создан!')});socket.on('regError',function(d){showError('regError',d.message)});socket.on('onlineUsers',function(u){onlineUsersList=u.filter(function(x){return x.username!==currentUser.username});filterUsers()});socket.on('chatMessages',function(d){if(currentChat===d.chatId){displayMessages(d.messages)}});socket.on('newMessage',function(d){if(currentChat===d.chatId){appendMessage(d.message)}updateChatPreview(d)})}
function filterUsers(){var s=(document.getElementById('searchUser').value||'').toLowerCase();var ul=document.getElementById('usersList');var h='';onlineUsersList.forEach(function(u){if(u.username.toLowerCase().indexOf(s)!==-1){h+='<div class="online-user" onclick="startChat(\\''+u.userId+'\\',\\''+u.username.replace(/'/g,"\\\\'")+'\\')"><span class="online-dot"></span><span>'+u.username.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span></div>'}});ul.innerHTML=h||'<div style="padding:10px;color:#999">Нет</div>'}
function startChat(pid,pname){currentChat=pid;document.getElementById('chatTitle').textContent=pname;document.getElementById('inputContainer').style.display='flex';document.getElementById('messagesContainer').innerHTML='';socket.emit('getChat',{peerId:pid});updateChatsList()}
function switchChat(cid,pname){currentChat=cid;document.getElementById('chatTitle').textContent=pname;document.getElementById('inputContainer').style.display='flex';document.getElementById('messagesContainer').innerHTML='';socket.emit('getChat',{chatId:cid});updateChatsList()}
function sendMessage(){var inp=document.getElementById('messageInput');var txt=inp.value.trim();if(!txt||!currentChat)return;socket.emit('sendMessage',{to:currentChat,text:txt});inp.value=''}
function displayMessages(msgs){var c=document.getElementById('messagesContainer');c.innerHTML='';if(msgs)msgs.forEach(function(m){appendMessage(m)});c.scrollTop=c.scrollHeight}
function appendMessage(m){var c=document.getElementById('messagesContainer');var d=document.createElement('div');d.className='message'+(m.from===currentUser.userId?' own':' other');var t=new Date(m.timestamp).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});d.innerHTML='<div style="font-size:.7rem;color:#999">'+t+'</div><div class="message-bubble">'+m.text.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>';c.appendChild(d);c.scrollTop=c.scrollHeight}
function updateChatPreview(d){var c=allChats.find(function(x){return x.id===d.chatId});if(!c){c={id:d.chatId,with:d.message.fromName||'User',messages:[]};allChats.push(c)}c.lastMessage=d.message.text;c.lastTime=d.message.timestamp;updateChatsList()}
function updateChatsList(){var cl=document.getElementById('chatsList');var h='';allChats.forEach(function(c){var t=c.lastTime?new Date(c.lastTime).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';h+='<div class="chat-item'+(currentChat===c.id?' active':'')+'" onclick="switchChat(\\''+c.id+'\\',\\''+c.with.replace(/'/g,"\\\\'")+'\\')"><div class="chat-item-name">'+c.with.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div><div style="font-size:.8rem;color:#999">'+(c.lastMessage||'Нет сообщений').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div><div style="font-size:.7rem;color:#bbb;float:right">'+t+'</div></div>'});cl.innerHTML=h||'<div style="padding:20px;text-align:center;color:#999">Нет чатов</div>'}
connectSocket();
document.addEventListener('keypress',function(e){if(e.key==='Enter'){if(document.getElementById('loginScreen').style.display==='flex')login();else if(document.getElementById('registerScreen').style.display==='flex')register();else if(document.getElementById('chatScreen').style.display==='flex')sendMessage()}});
</script>
</body>
</html>`;

const indexPath = path.join(clientDir, 'index.html');
fs.writeFileSync(indexPath, htmlContent, 'utf8');

app.use(express.static(clientDir));
app.get('/', (req, res) => {
    res.sendFile(indexPath);
});

io.on('connection', (socket) => {
    console.log('New connection');

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

        socket.emit('regSuccess');
    });

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

        onlineUsers.set(account.userId, {
            username: account.username,
            socketId: socket.id
        });

        socket.userId = account.userId;
        socket.username = account.username;

        const userChats = [];
        account.chats.forEach((messages, chatId) => {
            const parts = chatId.split('_');
            const peerId = parts.find(p => p !== account.userId);
            const peerAccount = Array.from(accounts.values()).find(a => a.userId === peerId);
            const lastMsg = messages[messages.length - 1];
            
            userChats.push({
                id: chatId,
                with: peerAccount ? peerAccount.username : 'Unknown',
                lastMessage: lastMsg ? lastMsg.text : '',
                lastTime: lastMsg ? lastMsg.timestamp : 0
            });
        });

        socket.emit('authSuccess', {
            userId: account.userId,
            username: account.username,
            chats: userChats.sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0))
        });

        broadcastOnlineUsers();
    });

    socket.on('getChat', (data) => {
        if (!socket.userId) return;
        const peerId = data.peerId || data.chatId;
        const chatId = [socket.userId, peerId].sort().join('_');
        const account = getAccountByUserId(socket.userId);
        if (!account) return;
        const messages = account.chats.get(chatId) || [];
        socket.emit('chatMessages', { chatId, messages });
    });

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

        const senderAccount = getAccountByUserId(socket.userId);
        if (senderAccount) {
            if (!senderAccount.chats.has(chatId)) senderAccount.chats.set(chatId, []);
            senderAccount.chats.get(chatId).push(message);
        }

        const receiverAccount = getAccountByUserId(data.to);
        if (receiverAccount) {
            if (!receiverAccount.chats.has(chatId)) receiverAccount.chats.set(chatId, []);
            receiverAccount.chats.get(chatId).push(message);
        }

        const receiver = onlineUsers.get(data.to);
        if (receiver) {
            io.to(receiver.socketId).emit('newMessage', { chatId, message });
        }

        socket.emit('newMessage', { chatId, message });
    });

    socket.on('logout', () => {
        if (socket.userId) {
            onlineUsers.delete(socket.userId);
            broadcastOnlineUsers();
        }
    });

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
    console.log('Server running on port ' + PORT);
});
