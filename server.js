const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxFileSize: 10 * 1024 * 1024 // 10MB для фото
});

const accounts = new Map();
const onlineUsers = new Map();

const clientDir = path.join(__dirname, 'client');
const uploadsDir = path.join(clientDir, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(clientDir));
app.use('/uploads', express.static(uploadsDir));

// Загрузка аватарок
app.post('/upload-avatar', (req, res) => {
    const { userId, image } = req.body;
    if (!image || !userId) return res.status(400).send('No data');
    
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const filename = `avatar_${userId}.png`;
    fs.writeFileSync(path.join(uploadsDir, filename), base64Data, 'base64');
    
    const account = getAccountByUserId(userId);
    if (account) account.avatar = `/uploads/${filename}`;
    
    res.json({ avatarUrl: `/uploads/${filename}` });
});

const htmlContent = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SecureChat</title>
<style>
:root {
    --bg: #ffffff;
    --bg-secondary: #f0f0f0;
    --text: #000000;
    --text-secondary: #666666;
    --bubble-other: #e9e9eb;
    --bubble-own: linear-gradient(135deg, #667eea, #764ba2);
    --sidebar-bg: #f8f9fa;
    --input-bg: #ffffff;
    --border: #e0e0e0;
    --shadow: rgba(0,0,0,0.1);
}
.dark-theme {
    --bg: #1a1a1a;
    --bg-secondary: #2d2d2d;
    --text: #ffffff;
    --text-secondary: #999999;
    --bubble-other: #3a3a3c;
    --bubble-own: linear-gradient(135deg, #667eea, #764ba2);
    --sidebar-bg: #2d2d2d;
    --input-bg: #3a3a3c;
    --border: #404040;
    --shadow: rgba(0,0,0,0.3);
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;background:var(--bg);color:var(--text);height:100vh;transition:all 0.3s}
.auth-screen{display:flex;justify-content:center;align-items:center;height:100vh;padding:20px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}
.auth-box{background:var(--bg);border-radius:20px;padding:40px;box-shadow:0 8px 32px var(--shadow);width:100%;max-width:400px;text-align:center}
.auth-box h2{color:#667eea;margin-bottom:10px;font-size:2rem}
.auth-box p{color:var(--text-secondary);margin-bottom:25px}
.auth-input{width:100%;padding:12px 16px;margin-bottom:15px;border:2px solid var(--border);border-radius:10px;font-size:1rem;outline:none;background:var(--input-bg);color:var(--text)}
.auth-input:focus{border-color:#667eea}
.auth-button{width:100%;padding:14px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;border-radius:10px;font-size:1.1rem;cursor:pointer;margin-bottom:15px}
.auth-link{color:#667eea;cursor:pointer;text-decoration:underline}
.error-message{color:#f44336;margin:10px 0;font-size:.9rem}
.app-container{max-width:1200px;height:100vh;margin:0 auto;background:var(--bg);display:flex;overflow:hidden;box-shadow:0 0 40px var(--shadow)}
.sidebar{width:320px;background:var(--sidebar-bg);border-right:1px solid var(--border);display:flex;flex-direction:column}
.sidebar-header{padding:20px;border-bottom:1px solid var(--border)}
.user-info{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;gap:10px}
.user-profile{display:flex;align-items:center;gap:10px;flex:1}
.avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;overflow:hidden;flex-shrink:0}
.avatar img{width:100%;height:100%;object-fit:cover}
.username-text{font-weight:500;font-size:.9rem}
.theme-toggle{background:none;border:1px solid var(--border);color:var(--text);padding:5px 10px;border-radius:15px;cursor:pointer;font-size:.8rem}
.logout-btn{background:#ff4757;border:none;color:white;padding:8px 15px;border-radius:8px;cursor:pointer;font-size:.8rem}
.search-box{position:relative;margin-top:10px}
.search-box input{width:100%;padding:10px 15px 10px 35px;border:1px solid var(--border);border-radius:20px;background:var(--input-bg);color:var(--text);outline:none;font-size:.9rem}
.search-icon{position:absolute;left:12px;top:10px;color:var(--text-secondary)}
.chats-list{flex:1;overflow-y:auto}
.chat-item{padding:12px 15px;cursor:pointer;display:flex;align-items:center;gap:12px;transition:background 0.2s;border-bottom:1px solid var(--border)}
.chat-item:hover{background:var(--bg-secondary)}
.chat-item.active{background:#667eea20;border-left:3px solid #667eea}
.chat-item-avatar{width:45px;height:45px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;overflow:hidden;flex-shrink:0}
.chat-item-avatar img{width:100%;height:100%;object-fit:cover}
.chat-item-info{flex:1;min-width:0}
.chat-item-name{font-weight:500;color:var(--text)}
.chat-item-last{font-size:.8rem;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat-item-time{font-size:.7rem;color:var(--text-secondary)}
.chat-area{flex:1;display:flex;flex-direction:column;background:var(--bg)}
.chat-header{padding:15px 20px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px}
.chat-header .avatar{width:40px;height:40px}
.messages-container{flex:1;overflow-y:auto;padding:20px;background:var(--bg);display:flex;flex-direction:column;gap:2px}
.message{display:flex;margin-bottom:5px;align-items:flex-end;gap:8px}
.message.own{flex-direction:row-reverse}
.message-avatar{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;color:white;font-size:.7rem;font-weight:bold;overflow:hidden;flex-shrink:0}
.message-avatar img{width:100%;height:100%;object-fit:cover}
.message-bubble{max-width:70%;padding:10px 15px;border-radius:18px;word-wrap:break-word;position:relative;font-size:.95rem}
.message.other .message-bubble{background:var(--bubble-other);color:var(--text);border-bottom-left-radius:5px}
.message.own .message-bubble{background:var(--bubble-own);color:white;border-bottom-right-radius:5px}
.message-image{max-width:250px;border-radius:15px;cursor:pointer}
.message-time{font-size:.65rem;color:var(--text-secondary);margin-top:2px;text-align:right}
.message.own .message-time{color:rgba(255,255,255,0.7)}
.input-container{padding:15px 20px;background:var(--bg-secondary);border-top:1px solid var(--border);display:flex;gap:10px;align-items:center}
.image-btn{background:none;border:1px solid var(--border);color:var(--text);font-size:1.5rem;cursor:pointer;padding:5px 10px;border-radius:10px;transition:background 0.2s}
.image-btn:hover{background:var(--bg)}
#messageInput{flex:1;padding:12px 16px;border:1px solid var(--border);border-radius:25px;font-size:.95rem;outline:none;background:var(--input-bg);color:var(--text)}
#imageInput{display:none}
.send-btn{background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;border-radius:50%;width:40px;height:40px;cursor:pointer;font-size:1.2rem;display:flex;align-items:center;justify-content:center}
.no-chat{flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);flex-direction:column;gap:10px;font-size:1.1rem}
.no-chat-icon{font-size:4rem;opacity:0.3}
.users-list{max-height:200px;overflow-y:auto;border-top:1px solid var(--border);padding:10px}
.users-list-title{font-size:.75rem;color:var(--text-secondary);text-transform:uppercase;padding:5px 15px;letter-spacing:1px}
.user-item{padding:10px 15px;cursor:pointer;display:flex;align-items:center;gap:10px;border-radius:8px;transition:background 0.2s}
.user-item:hover{background:var(--bg-secondary)}
.user-avatar{width:35px;height:35px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:.8rem;overflow:hidden;flex-shrink:0}
.user-avatar img{width:100%;height:100%;object-fit:cover}
.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:1000;justify-content:center;align-items:center}
.modal img{max-width:90%;max-height:90%}
.modal-close{position:absolute;top:20px;right:20px;color:white;font-size:2rem;cursor:pointer}
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
<div style="position:relative;display:inline-block;margin-bottom:15px">
<div id="regAvatar" class="avatar" style="width:80px;height:80px;font-size:2rem;cursor:pointer" onclick="document.getElementById('avatarInput').click()">📷</div>
<input type="file" id="avatarInput" accept="image/*" style="display:none" onchange="previewAvatar(this)">
</div>
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
<div class="user-info">
<div class="user-profile">
<div id="myAvatar" class="avatar" onclick="changeAvatar()">👤</div>
<div class="username-text" id="myUsername"></div>
</div>
<button class="theme-toggle" onclick="toggleTheme()">🌓</button>
<button class="logout-btn" onclick="logout()">Выход</button>
</div>
<div class="search-box">
<span class="search-icon">🔍</span>
<input type="text" id="searchUser" placeholder="Поиск пользователя..." oninput="searchUsers()">
</div>
</div>
<div class="chats-list" id="chatsList"></div>
<div class="users-list" id="usersList"></div>
</div>
<div class="chat-area">
<div class="chat-header" id="chatHeader" style="display:none">
<div id="chatAvatar" class="avatar">👤</div>
<div id="chatTitle" style="font-weight:500">Выберите чат</div>
</div>
<div class="messages-container" id="messagesContainer">
<div class="no-chat">
<div class="no-chat-icon">💬</div>
<div>Выберите чат для начала общения</div>
</div>
</div>
<div class="input-container" id="inputContainer" style="display:none">
<button class="image-btn" onclick="document.getElementById('imageInput').click()">🖼️</button>
<input type="file" id="imageInput" accept="image/*" multiple style="display:none" onchange="sendImage(this)">
<input type="text" id="messageInput" placeholder="iMessage" maxlength="1000" onkeypress="handleEnter(event)">
<button class="send-btn" onclick="sendMessage()">➤</button>
</div>
</div>
</div>
<div class="modal" id="imageModal" onclick="this.style.display='none'">
<span class="modal-close">✕</span>
<img id="modalImage">
</div>
<input type="file" id="avatarChangeInput" accept="image/*" style="display:none" onchange="uploadAvatar(this)">
<script src="/socket.io/socket.io.js"></script>
<script>
var socket, currentUser=null, currentChat=null, allChats=[], allUsers=[], regAvatarData=null;

function showRegister(){document.getElementById('loginScreen').style.display='none';document.getElementById('registerScreen').style.display='flex'}
function showLogin(){document.getElementById('registerScreen').style.display='none';document.getElementById('loginScreen').style.display='flex'}
function toggleTheme(){document.body.classList.toggle('dark-theme');localStorage.setItem('theme',document.body.classList.contains('dark-theme')?'dark':'light')}

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
    var p=document.getElementById('regPassword').value;
    var pc=document.getElementById('regPasswordConfirm').value;
    if(!u||!p){showError('regError','Заполните поля');return}
    if(u.length<3){showError('regError','Минимум 3 символа');return}
    if(p.length<4){showError('regError','Пароль от 4 символов');return}
    if(p!==pc){showError('regError','Пароли не совпадают');return}
    socket.emit('register',{username:u,password:p,avatar:regAvatarData});
}

function showError(id,msg){
    var el=document.getElementById(id);
    el.textContent=msg;
    el.style.display='block';
    setTimeout(function(){el.style.display='none'},3000);
}

function logout(){
    socket.emit('logout');
    socket.disconnect();
    currentUser=null;currentChat=null;allChats=[];
    document.getElementById('chatScreen').style.display='none';
    document.getElementById('loginScreen').style.display='flex';
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
        if(localStorage.getItem('theme')==='dark')document.body.classList.add('dark-theme');
    });
    
    socket.on('authError',function(d){showError('loginError',d.message)});
    socket.on('regSuccess',function(){showLogin();alert('Аккаунт создан!')});
    socket.on('regError',function(d){showError('regError',d.message)});
    
    socket.on('searchResults',function(u){
        allUsers=u.filter(function(x){return x.userId!==currentUser.userId});
        displayUsers(allUsers);
    });
    
    socket.on('chatMessages',function(d){
        if(currentChat===d.chatId)displayMessages(d.messages);
    });
    
    socket.on('newMessage',function(d){
        if(currentChat===d.chatId)appendMessage(d.message);
        updateChatPreview(d);
    });
    
    socket.on('avatarUpdated',function(d){
        if(d.userId===currentUser.userId){
            document.getElementById('myAvatar').innerHTML=d.avatar?'<img src="'+d.avatar+'">':currentUser.username.charAt(0).toUpperCase();
        }
        updateAllAvatars();
    });
}

function searchUsers(){
    var query=document.getElementById('searchUser').value.trim();
    if(query){
        socket.emit('searchUsers',{query:query});
    }else{
        document.getElementById('usersList').innerHTML='';
    }
}

function displayUsers(users){
    var html='<div class="users-list-title">Найденные пользователи</div>';
    users.forEach(function(u){
        var initial=u.username.charAt(0).toUpperCase();
        html+='<div class="user-item" onclick="startChat(\\''+u.userId+'\\',\\''+u.username.replace(/'/g,"\\\\'")+'\\',\\''+(u.avatar||'')+'\\')">';
        html+='<div class="user-avatar">'+(u.avatar?'<img src="'+u.avatar+'">':initial)+'</div>';
        html+='<span>'+u.username.replace(/</g,'&lt;')+'</span></div>';
    });
    document.getElementById('usersList').innerHTML=html||'<div style="padding:10px;color:var(--text-secondary)">Пользователи не найдены</div>';
}

function startChat(peerId,peerName,peerAvatar){
    currentChat=peerId;
    document.getElementById('chatHeader').style.display='flex';
    document.getElementById('chatTitle').textContent=peerName;
    document.getElementById('chatAvatar').innerHTML=peerAvatar?'<img src="'+peerAvatar+'">':peerName.charAt(0).toUpperCase();
    document.getElementById('inputContainer').style.display='flex';
    document.getElementById('messagesContainer').innerHTML='';
    socket.emit('getChat',{peerId:peerId});
    updateChatsList();
    document.getElementById('usersList').innerHTML='';
    document.getElementById('searchUser').value='';
}

function switchChat(chatId,peerName,peerAvatar){
    currentChat=chatId;
    document.getElementById('chatHeader').style.display='flex';
    document.getElementById('chatTitle').textContent=peerName;
    document.getElementById('chatAvatar').innerHTML=peerAvatar?'<img src="'+peerAvatar+'">':peerName.charAt(0).toUpperCase();
    document.getElementById('inputContainer').style.display='flex';
    document.getElementById('messagesContainer').innerHTML='';
    socket.emit('getChat',{chatId:chatId});
    updateChatsList();
}

function sendMessage(){
    var inp=document.getElementById('messageInput');
    var txt=inp.value.trim();
    if(!txt||!currentChat)return;
    socket.emit('sendMessage',{to:currentChat,text:txt,type:'text'});
    inp.value='';
}

function sendImage(input){
    if(!input.files||!input.files.length||!currentChat)return;
    Array.from(input.files).forEach(function(file){
        var reader=new FileReader();
        reader.onload=function(e){
            socket.emit('sendMessage',{to:currentChat,image:e.target.result,type:'image'});
        };
        reader.readAsDataURL(file);
    });
    input.value='';
}

function handleEnter(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}}

function displayMessages(msgs){
    var c=document.getElementById('messagesContainer');
    c.innerHTML='';
    if(msgs)msgs.forEach(function(m){appendMessage(m)});
    c.scrollTop=c.scrollHeight;
}

function appendMessage(m){
    var c=document.getElementById('messagesContainer');
    var div=document.createElement('div');
    var isOwn=m.from===currentUser.userId;
    div.className='message'+(isOwn?' own':' other');
    
    var avatarHtml='';
    if(!isOwn){
        var peerAccount=allUsers.find(function(u){return u.userId===m.from});
        var initial=(m.fromName||'?').charAt(0).toUpperCase();
        avatarHtml='<div class="message-avatar">'+(peerAccount&&peerAccount.avatar?'<img src="'+peerAccount.avatar+'">':initial)+'</div>';
    }
    
    var bubble='<div class="message-bubble">';
    if(m.type==='image'){
        bubble+='<img class="message-image" src="'+m.image+'" onclick="showImage(\\''+m.image+'\\')">';
    }else{
        bubble+=m.text.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    
    var time=new Date(m.timestamp).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
    bubble+='<div class="message-time">'+time+'</div></div>';
    
    div.innerHTML=avatarHtml+bubble;
    c.appendChild(div);
    c.scrollTop=c.scrollHeight;
}

function showImage(src){
    document.getElementById('modalImage').src=src;
    document.getElementById('imageModal').style.display='flex';
}

function updateChatPreview(d){
    var chat=allChats.find(function(x){return x.id===d.chatId});
    if(!chat){
        var peerName=d.message.fromName||'Пользователь';
        chat={id:d.chatId,with:peerName,avatar:'',lastMessage:'',lastTime:0};
        allChats.push(chat);
    }
    chat.lastMessage=d.message.type==='image'?'📷 Фото':d.message.text;
    chat.lastTime=d.message.timestamp;
    updateChatsList();
}

function updateChatsList(){
    var cl=document.getElementById('chatsList');
    var html='';
    allChats.sort(function(a,b){return(b.lastTime||0)-(a.lastTime||0)});
    allChats.forEach(function(c){
        var t=c.lastTime?new Date(c.lastTime).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
        html+='<div class="chat-item'+(currentChat===c.id?' active':'')+'" onclick="switchChat(\\''+c.id+'\\',\\''+c.with.replace(/'/g,"\\\\'")+'\\',\\''+(c.avatar||'')+'\\')">';
        html+='<div class="chat-item-avatar">'+(c.avatar?'<img src="'+c.avatar+'">':c.with.charAt(0).toUpperCase())+'</div>';
        html+='<div class="chat-item-info"><div class="chat-item-name">'+c.with.replace(/</g,'&lt;')+'</div>';
        html+='<div class="chat-item-last">'+(c.lastMessage||'Нет сообщений').replace(/</g,'&lt;')+'</div></div>';
        html+='<div class="chat-item-time">'+t+'</div></div>';
    });
    cl.innerHTML=html||'<div style="padding:20px;text-align:center;color:var(--text-secondary)">Нет чатов</div>';
}

function changeAvatar(){
    document.getElementById('avatarChangeInput').click();
}

function uploadAvatar(input){
    if(!input.files||!input.files[0]||!currentUser)return;
    var reader=new FileReader();
    reader.onload=function(e){
        fetch('/upload-avatar',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({userId:currentUser.userId,image:e.target.result})
        }).then(function(r){return r.json()}).then(function(d){
            socket.emit('updateAvatar',{avatarUrl:d.avatarUrl});
        });
    };
    reader.readAsDataURL(input.files[0]);
}

function updateAllAvatars(){
    // Обновить аватарки в чатах
    var chatAvatars=document.querySelectorAll('.chat-item-avatar img');
    chatAvatars.forEach(function(img){
        var src=img.getAttribute('src');
        if(src)img.setAttribute('src',src+'?'+Date.now());
    });
}

connectSocket();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(clientDir, 'index.html'), htmlContent, 'utf8');

app.get('/', (req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
});

io.on('connection', (socket) => {
    console.log('User connected');

    socket.on('register', (data) => {
        const { username, password, avatar } = data;
        const userKey = username.toLowerCase();

        if (accounts.has(userKey)) {
            socket.emit('regError', { message: 'Пользователь уже существует' });
            return;
        }

        const userId = 'usr_' + crypto.randomBytes(8).toString('hex');
        const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
        
        let avatarUrl = '';
        if (avatar && avatar.startsWith('data:image')) {
            const base64Data = avatar.replace(/^data:image\/\w+;base64,/, '');
            const filename = `avatar_${userId}.png`;
            fs.writeFileSync(path.join(uploadsDir, filename), base64Data, 'base64');
            avatarUrl = `/uploads/${filename}`;
        }

        accounts.set(userKey, {
            password: hashedPassword,
            userId,
            username,
            avatar: avatarUrl,
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
            socketId: socket.id,
            avatar: account.avatar
        });

        socket.userId = account.userId;
        socket.username = account.username;
        socket.avatar = account.avatar;

        const userChats = [];
        account.chats.forEach((messages, chatId) => {
            const parts = chatId.split('_');
            const peerId = parts.find(p => p !== account.userId);
            const peerAccount = Array.from(accounts.values()).find(a => a.userId === peerId);
            const lastMsg = messages[messages.length - 1];
            
            userChats.push({
                id: chatId,
                with: peerAccount ? peerAccount.username : 'Unknown',
                avatar: peerAccount ? peerAccount.avatar : '',
                lastMessage: lastMsg ? (lastMsg.type === 'image' ? '📷 Фото' : lastMsg.text) : '',
                lastTime: lastMsg ? lastMsg.timestamp : 0
            });
        });

        socket.emit('authSuccess', {
            userId: account.userId,
            username: account.username,
            avatar: account.avatar,
            chats: userChats
        });

        broadcastOnlineUsers();
    });

    socket.on('searchUsers', (data) => {
        if (!socket.userId) return;
        const query = data.query.toLowerCase();
        const results = [];
        
        accounts.forEach((acc) => {
            if (acc.username.toLowerCase().includes(query) && acc.userId !== socket.userId) {
                results.push({
                    userId: acc.userId,
                    username: acc.username,
                    avatar: acc.avatar,
                    online: onlineUsers.has(acc.userId)
                });
            }
        });
        
        socket.emit('searchResults', results);
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
            text: data.text || '',
            type: data.type || 'text',
            image: data.image || '',
            avatar: socket.avatar || '',
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

    socket.on('updateAvatar', (data) => {
        if (!socket.userId) return;
        const account = getAccountByUserId(socket.userId);
        if (account) {
            account.avatar = data.avatarUrl;
            socket.avatar = data.avatarUrl;
            
            const onlineEntry = onlineUsers.get(socket.userId);
            if (onlineEntry) onlineEntry.avatar = data.avatarUrl;
            
            io.emit('avatarUpdated', {
                userId: socket.userId,
                avatar: data.avatarUrl
            });
        }
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
    console.log('Server started on port ' + PORT);
});
