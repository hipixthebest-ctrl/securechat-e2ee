const fs = require('fs');
const path = require('path');

// Создаём папку client и index.html если их нет
const clientPath = path.join(__dirname, 'client');
const indexPath = path.join(clientPath, 'index.html');

if (!fs.existsSync(clientPath)) {
    fs.mkdirSync(clientPath, { recursive: true });
    console.log('📁 Created client/ folder');
}

if (!fs.existsSync(indexPath)) {
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SecureChat E2EE</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            color: white;
        }
        .container {
            text-align: center;
            padding: 40px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
            border: 1px solid rgba(255, 255, 255, 0.18);
        }
        h1 {
            font-size: 3.5rem;
            margin-bottom: 20px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        .status {
            background: rgba(255, 255, 255, 0.2);
            padding: 20px;
            border-radius: 15px;
            margin: 20px 0;
        }
        .status p { margin: 10px 0; font-size: 1.2rem; }
        .online { color: #4ade80; font-weight: bold; }
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 30px;
        }
        .feature {
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 10px;
            transition: transform 0.3s;
        }
        .feature:hover { transform: translateY(-5px); }
        .feature .icon { font-size: 2rem; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔒 SecureChat E2EE</h1>
        <div class="status">
            <p>Server Status: <span class="online">Online ✅</span></p>
            <p>WebSocket: <span id="wsStatus">Connecting...</span></p>
        </div>
        <div class="features">
            <div class="feature">
                <div class="icon">🔐</div>
                <h3>End-to-End Encryption</h3>
                <p>Your messages are secure</p>
            </div>
            <div class="feature">
                <div class="icon">⚡</div>
                <h3>Real-time Chat</h3>
                <p>Instant messaging</p>
            </div>
            <div class="feature">
                <div class="icon">🛡️</div>
                <h3>Secure Protocol</h3>
                <p>Signal Protocol</p>
            </div>
        </div>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        socket.on('connect', () => {
            document.getElementById('wsStatus').innerHTML = 'Connected ✅';
            document.getElementById('wsStatus').style.color = '#4ade80';
        });
        socket.on('disconnect', () => {
            document.getElementById('wsStatus').innerHTML = 'Disconnected ❌';
            document.getElementById('wsStatus').style.color = '#ef4444';
        });
    </script>
</body>
</html>`;

    fs.writeFileSync(indexPath, htmlContent, 'utf8');
    console.log('✅ Created client/index.html automatically');
}
