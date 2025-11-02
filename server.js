const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const BROWSERLESS_URL = 'http://145.239.253.161:3000';

// Get active browser session
async function getBrowserSession() {
    try {
        const response = await axios.get(`${BROWSERLESS_URL}/json/list`);
        return response.data[0];
    } catch (error) {
        console.error('Failed to get browser session:', error.message);
        return null;
    }
}

// WebSocket proxy to browserless CDP
wss.on('connection', async (clientWs) => {
    console.log('Client WebSocket connected');

    let browserlessWs = null;
    let isConnecting = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;

    async function connectToBrowserless() {
        if (isConnecting) return;
        isConnecting = true;

        try {
            // Get fresh browserless session
            const session = await getBrowserSession();
            if (!session) {
                console.error('No browserless session available');
                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    setTimeout(() => {
                        isConnecting = false;
                        connectToBrowserless();
                    }, 2000);
                } else {
                    clientWs.send(JSON.stringify({ error: 'Browserless not available' }));
                    clientWs.close();
                }
                return;
            }

            console.log('Connecting to browserless:', session.webSocketDebuggerUrl);
            browserlessWs = new WebSocket(session.webSocketDebuggerUrl);

            browserlessWs.on('open', () => {
                console.log('Connected to browserless CDP');
                reconnectAttempts = 0;
                isConnecting = false;
            });

            browserlessWs.on('message', (message) => {
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(message);
                }
            });

            browserlessWs.on('error', (error) => {
                console.error('Browserless WebSocket error:', error.message);
                isConnecting = false;
            });

            browserlessWs.on('close', (code, reason) => {
                console.log('Browserless WebSocket closed:', code, reason.toString());
                isConnecting = false;

                // Try to reconnect if client is still connected
                if (clientWs.readyState === WebSocket.OPEN && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    console.log(`Reconnecting to browserless (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                    setTimeout(() => connectToBrowserless(), 2000);
                } else {
                    clientWs.close();
                }
            });

        } catch (error) {
            console.error('Error connecting to browserless:', error);
            isConnecting = false;
            clientWs.close();
        }
    }

    // Proxy messages from client to browserless
    clientWs.on('message', (message) => {
        if (browserlessWs && browserlessWs.readyState === WebSocket.OPEN) {
            browserlessWs.send(message);
        }
    });

    clientWs.on('close', () => {
        console.log('Client WebSocket closed');
        if (browserlessWs) {
            browserlessWs.close();
        }
    });

    clientWs.on('error', (error) => {
        console.error('Client WebSocket error:', error.message);
        if (browserlessWs) {
            browserlessWs.close();
        }
    });

    // Initial connection
    await connectToBrowserless();
});

// Serve main page
app.get('/', async (req, res) => {
    // Get the WebSocket URL for our proxy
    // Check X-Forwarded-Proto for reverse proxy setups (like render.com)
    const protocol = req.get('X-Forwarded-Proto') || req.protocol;
    const wsProtocol = protocol === 'https' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${req.get('host')}`;

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Browser Remote</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            overflow: hidden;
            background-color: #000;
            font-family: Arial, sans-serif;
        }

        #browserView {
            width: 100vw;
            height: 100vh;
            object-fit: contain;
            display: block;
            cursor: pointer;
        }

        #status {
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.7);
            color: #0f0;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 1000;
        }
    </style>
</head>
<body>
    <div id="status">Connecting...</div>
    <img id="browserView" src="" alt="Browser View">

    <script>
        const wsUrl = '${wsUrl}';
        let ws = null;
        let commandId = 1;
        let viewportWidth = window.innerWidth;
        let viewportHeight = window.innerHeight;

        const status = document.getElementById('status');
        const browserView = document.getElementById('browserView');

        // Connect to our WebSocket proxy
        function connect() {
            status.textContent = 'Connecting to CDP...';
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                status.textContent = 'Connected';

                // Start screencast
                sendCommand('Page.startScreencast', {
                    format: 'jpeg',
                    quality: 80,
                    maxWidth: viewportWidth,
                    maxHeight: viewportHeight,
                    everyNthFrame: 1
                });
            };

            ws.onmessage = (event) => {
                const message = JSON.parse(event.data);

                // Handle screencast frame
                if (message.method === 'Page.screencastFrame') {
                    const { data, sessionId } = message.params;

                    // Display frame
                    browserView.src = 'data:image/jpeg;base64,' + data;

                    // Acknowledge frame
                    sendCommand('Page.screencastFrameAck', { sessionId });
                }
            };

            ws.onerror = (error) => {
                status.textContent = 'Connection error';
                console.error('WebSocket error:', error);
            };

            ws.onclose = () => {
                status.textContent = 'Disconnected. Reconnecting...';
                setTimeout(connect, 2000);
            };
        }

        function sendCommand(method, params = {}) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    id: commandId++,
                    method: method,
                    params: params
                }));
            }
        }

        // Handle click
        browserView.addEventListener('click', (event) => {
            const rect = browserView.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            const scaleX = viewportWidth / rect.width;
            const scaleY = viewportHeight / rect.height;

            const actualX = Math.round(x * scaleX);
            const actualY = Math.round(y * scaleY);

            // Send mouse click via CDP
            sendCommand('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: actualX,
                y: actualY,
                button: 'left',
                clickCount: 1
            });

            setTimeout(() => {
                sendCommand('Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    x: actualX,
                    y: actualY,
                    button: 'left',
                    clickCount: 1
                });
            }, 50);
        });

        // Handle keyboard
        document.addEventListener('keydown', (event) => {
            if (event.target.tagName === 'INPUT') return;

            event.preventDefault();

            sendCommand('Input.dispatchKeyEvent', {
                type: 'keyDown',
                key: event.key,
                code: event.code,
                text: event.key.length === 1 ? event.key : undefined
            });
        });

        document.addEventListener('keyup', (event) => {
            if (event.target.tagName === 'INPUT') return;

            event.preventDefault();

            sendCommand('Input.dispatchKeyEvent', {
                type: 'keyUp',
                key: event.key,
                code: event.code
            });
        });

        // Handle scroll
        browserView.addEventListener('wheel', (event) => {
            event.preventDefault();

            sendCommand('Input.dispatchMouseEvent', {
                type: 'mouseWheel',
                x: 0,
                y: 0,
                deltaX: event.deltaX,
                deltaY: event.deltaY
            });
        }, { passive: false });

        // Handle resize
        window.addEventListener('resize', () => {
            viewportWidth = window.innerWidth;
            viewportHeight = window.innerHeight;

            // Restart screencast with new dimensions
            sendCommand('Page.stopScreencast');
            setTimeout(() => {
                sendCommand('Page.startScreencast', {
                    format: 'jpeg',
                    quality: 80,
                    maxWidth: viewportWidth,
                    maxHeight: viewportHeight,
                    everyNthFrame: 1
                });
            }, 100);
        });

        // Start connection
        connect();
    </script>
</body>
</html>
    `);
});

// Get browser info
app.get('/info', async (req, res) => {
    const session = await getBrowserSession();
    res.json(session || { error: 'No browser session' });
});

// Start server
const PORT = process.env.PORT || 3002;

server.listen(PORT, () => {
    console.log(`\n🚀 Browser Remote (CDP Proxy)`);
    console.log(`\n👉 Open: http://localhost:${PORT}`);
    console.log(`\nWebSocket proxy to browserless CDP`);
    console.log(`Connected to: ${BROWSERLESS_URL}`);
    console.log(`\nFeatures:`);
    console.log(`  ✓ WebSocket proxy for HTTPS compatibility`);
    console.log(`  ✓ Native CDP screencast`);
    console.log(`  ✓ Full interactivity (click, type, scroll)`);
    console.log(`  ✓ Works over HTTPS`);
    console.log(`\nBrowser view only - no DevTools UI\n`);
});
