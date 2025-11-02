const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();

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

// Serve main page
app.get('/', async (req, res) => {
    const session = await getBrowserSession();

    if (!session) {
        return res.status(503).send('Browserless not available');
    }

    // Extract the WebSocket URL for CDP
    const wsUrl = session.webSocketDebuggerUrl.replace('ws://', '');

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
        // Use wss:// for HTTPS, ws:// for HTTP
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = wsProtocol + '//${wsUrl}';
        let ws = null;
        let commandId = 1;
        let viewportWidth = window.innerWidth;
        let viewportHeight = window.innerHeight;

        const status = document.getElementById('status');
        const browserView = document.getElementById('browserView');

        // Connect to CDP WebSocket
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

app.listen(PORT, () => {
    console.log(`\n🚀 Browser Remote (CDP Direct)`);
    console.log(`\n👉 Open: http://localhost:${PORT}`);
    console.log(`\nDirect Chrome DevTools Protocol connection`);
    console.log(`Connected to: ${BROWSERLESS_URL}`);
    console.log(`\nFeatures:`);
    console.log(`  ✓ Native CDP screencast`);
    console.log(`  ✓ Direct WebSocket to browser`);
    console.log(`  ✓ Full interactivity (click, type, scroll)`);
    console.log(`  ✓ No middleware overhead`);
    console.log(`\nBrowser view only - no DevTools UI\n`);
});
