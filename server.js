const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const puppeteer = require('puppeteer-core');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket'],
    perMessageDeflate: {
        threshold: 1024
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const BROWSERLESS_URL = 'ws://145.239.253.161:3000';

let browser = null;
let activeSessions = new Map(); // Track active client sessions

// Initialize browser connection
async function initBrowser() {
    if (browser) return browser;

    try {
        console.log('Connecting to browserless at', BROWSERLESS_URL);
        browser = await puppeteer.connect({
            browserWSEndpoint: BROWSERLESS_URL
        });

        console.log('Connected to browserless');

        browser.on('disconnected', () => {
            console.log('Browser disconnected');
            browser = null;
            // Clean up all sessions
            activeSessions.forEach((session) => {
                if (session.page) session.page.close().catch(() => {});
                if (session.cdpSession) session.cdpSession.detach().catch(() => {});
            });
            activeSessions.clear();
        });

        return browser;
    } catch (error) {
        console.error('Failed to connect to browserless:', error);
        return null;
    }
}

// Socket.io connections
io.on('connection', async (socket) => {
    console.log('Client connected:', socket.id);

    let page = null;
    let cdpSession = null;

    try {
        // Ensure browser is connected
        const browserInstance = await initBrowser();
        if (!browserInstance) {
            socket.emit('error', { message: 'Failed to connect to browser' });
            socket.disconnect();
            return;
        }

        // Create new page for this client
        page = await browserInstance.newPage();
        await page.setViewport({
            width: 1280,
            height: 720,
            deviceScaleFactor: 1
        });

        console.log('Created new page for client:', socket.id);

        // Navigate to initial page
        await page.goto('https://www.google.com', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Set up CDP session for screencast
        cdpSession = await page.target().createCDPSession();

        // Start screencast
        await cdpSession.send('Page.startScreencast', {
            format: 'jpeg',
            quality: 80,
            maxWidth: 1280,
            maxHeight: 720,
            everyNthFrame: 1
        });

        // Handle screencast frames
        cdpSession.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
            await cdpSession.send('Page.screencastFrameAck', { sessionId });
            socket.emit('frame', { image: data, metadata });
        });

        // Listen for page navigation events
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame()) {
                const url = frame.url();
                socket.emit('url-changed', { url });
                console.log('Page navigated to:', url);
            }
        });

        // Send initial URL
        socket.emit('url-changed', { url: page.url() });

        // Store session
        activeSessions.set(socket.id, { page, cdpSession });

        // Handle client interactions
        socket.on('click', async (data) => {
            try {
                const { x, y, width, height } = data;

                // Update viewport if needed
                if (width && height) {
                    const viewport = page.viewport();
                    if (viewport.width !== width || viewport.height !== height) {
                        await page.setViewport({
                            width: parseInt(width),
                            height: parseInt(height),
                            deviceScaleFactor: 1
                        });
                    }
                }

                await page.mouse.click(x, y);
            } catch (error) {
                console.error('Click error:', error.message);
            }
        });

        socket.on('type', async (data) => {
            try {
                const { key, text } = data;
                if (text) {
                    // Type full text (for paste)
                    await page.keyboard.type(text);
                } else if (key) {
                    await page.keyboard.press(key);
                }
            } catch (error) {
                console.error('Type error:', error.message);
            }
        });

        socket.on('mousedown', async (data) => {
            try {
                const { x, y } = data;
                await page.mouse.move(x, y);
                await page.mouse.down();
            } catch (error) {
                console.error('Mousedown error:', error.message);
            }
        });

        socket.on('mousemove', async (data) => {
            try {
                const { x, y } = data;
                await page.mouse.move(x, y);
            } catch (error) {
                console.error('Mousemove error:', error.message);
            }
        });

        socket.on('mouseup', async (data) => {
            try {
                const { x, y } = data;
                await page.mouse.move(x, y);
                await page.mouse.up();
            } catch (error) {
                console.error('Mouseup error:', error.message);
            }
        });

        socket.on('copy', async () => {
            try {
                // Get selected text from the browser
                const selectedText = await page.evaluate(() => {
                    return window.getSelection().toString();
                });
                socket.emit('copied-text', { text: selectedText });
            } catch (error) {
                console.error('Copy error:', error.message);
            }
        });

        socket.on('navigate', async (data) => {
            try {
                const { url } = data;
                await page.goto(url, {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });
            } catch (error) {
                console.error('Navigate error:', error.message);
            }
        });

        socket.on('scroll', async (data) => {
            try {
                const { deltaX, deltaY } = data;
                await page.mouse.wheel({ deltaX: deltaX || 0, deltaY: deltaY || 0 });
            } catch (error) {
                console.error('Scroll error:', error.message);
            }
        });

    } catch (error) {
        console.error('Error setting up client session:', error);
        socket.emit('error', { message: error.message });
        socket.disconnect();
    }

    // Cleanup on disconnect
    socket.on('disconnect', async () => {
        console.log('Client disconnected:', socket.id);

        const session = activeSessions.get(socket.id);
        if (session) {
            try {
                if (session.cdpSession) {
                    await session.cdpSession.detach();
                }
                if (session.page) {
                    await session.page.close();
                }
            } catch (error) {
                console.error('Cleanup error:', error.message);
            }
            activeSessions.delete(socket.id);
        }
    });
});

// Serve main page
app.get('/', (req, res) => {
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
            top: 50px;
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

    <script src="/socket.io/socket.io.js"></script>
    <script>
        let viewportWidth = window.innerWidth;
        let viewportHeight = window.innerHeight;
        let isProcessing = false;

        const status = document.getElementById('status');
        const browserView = document.getElementById('browserView');

        // Connect to socket.io
        const socket = io({
            transports: ['websocket']
        });

        socket.on('connect', () => {
            status.textContent = 'Connected';
            console.log('Connected to server');

            // Check for URL parameter and navigate if present
            const params = new URLSearchParams(window.location.search);
            const urlParam = params.get('url');
            if (urlParam) {
                let url = urlParam;
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                    url = 'https://' + url;
                }
                socket.emit('navigate', { url });
            }
        });

        socket.on('frame', (data) => {
            browserView.src = 'data:image/jpeg;base64,' + data.image;
        });

        socket.on('error', (data) => {
            status.textContent = 'Error: ' + data.message;
            console.error('Server error:', data.message);
        });

        socket.on('disconnect', () => {
            status.textContent = 'Disconnected';
            console.log('Disconnected from server');
        });

        let isMouseDown = false;
        let dragStarted = false;
        let dragStartTime = 0;
        let dragStartX = 0;
        let dragStartY = 0;

        // Handle mousedown (start of potential drag or click)
        browserView.addEventListener('mousedown', (event) => {
            isMouseDown = true;
            dragStarted = false;
            dragStartTime = Date.now();

            const rect = browserView.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            const scaleX = viewportWidth / rect.width;
            const scaleY = viewportHeight / rect.height;

            dragStartX = Math.round(x * scaleX);
            dragStartY = Math.round(y * scaleY);
        });

        // Handle mousemove (dragging for text selection)
        browserView.addEventListener('mousemove', (event) => {
            if (!isMouseDown) return;

            const rect = browserView.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            const scaleX = viewportWidth / rect.width;
            const scaleY = viewportHeight / rect.height;

            const actualX = Math.round(x * scaleX);
            const actualY = Math.round(y * scaleY);

            const dragDistance = Math.sqrt(Math.pow(actualX - dragStartX, 2) + Math.pow(actualY - dragStartY, 2));

            // Start drag if mouse moved more than 5 pixels
            if (!dragStarted && dragDistance > 5) {
                dragStarted = true;
                socket.emit('mousedown', { x: dragStartX, y: dragStartY });
            }

            if (dragStarted) {
                socket.emit('mousemove', { x: actualX, y: actualY });
            }
        });

        // Handle mouseup (end of drag or click)
        browserView.addEventListener('mouseup', (event) => {
            if (!isMouseDown) return;

            const rect = browserView.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            const scaleX = viewportWidth / rect.width;
            const scaleY = viewportHeight / rect.height;

            const actualX = Math.round(x * scaleX);
            const actualY = Math.round(y * scaleY);

            if (dragStarted) {
                // Was a drag, send mouseup
                socket.emit('mouseup', { x: actualX, y: actualY });
            } else {
                // Was a click, send click event
                socket.emit('click', {
                    x: actualX,
                    y: actualY,
                    width: viewportWidth,
                    height: viewportHeight
                });
            }

            isMouseDown = false;
            dragStarted = false;
        });

        // Handle copy request from server
        socket.on('copied-text', async (data) => {
            try {
                await navigator.clipboard.writeText(data.text);
                console.log('Text copied to clipboard:', data.text);
            } catch (error) {
                console.error('Failed to copy to clipboard:', error);
            }
        });

        // Handle keyboard
        document.addEventListener('keydown', async (event) => {
            if (isProcessing || event.target.tagName === 'INPUT') return;

            // Handle copy (Ctrl+C or Cmd+C)
            if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
                event.preventDefault();
                socket.emit('copy');
                return;
            }

            // Handle paste (Ctrl+V or Cmd+V)
            if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
                event.preventDefault();
                try {
                    const text = await navigator.clipboard.readText();
                    if (text) {
                        socket.emit('type', { text: text });
                        console.log('Pasted text:', text);
                    }
                } catch (error) {
                    console.error('Failed to read clipboard:', error);
                }
                return;
            }

            if (event.key === 'F5' || (event.ctrlKey && event.key === 'r')) {
                event.preventDefault();
                return;
            }

            if (event.key.length === 1 || ['Enter', 'Backspace', 'Tab'].includes(event.key)) {
                event.preventDefault();
                isProcessing = true;
                socket.emit('type', { key: event.key });
                setTimeout(() => { isProcessing = false; }, 100);
            }
        });

        // Handle scroll
        browserView.addEventListener('wheel', (event) => {
            if (isProcessing) return;

            event.preventDefault();
            isProcessing = true;
            socket.emit('scroll', {
                deltaX: event.deltaX,
                deltaY: event.deltaY
            });
            setTimeout(() => { isProcessing = false; }, 100);
        }, { passive: false });

        // Handle resize
        window.addEventListener('resize', () => {
            viewportWidth = window.innerWidth;
            viewportHeight = window.innerHeight;
        });
    </script>
</body>
</html>
    `);
});

// Start server
const PORT = process.env.PORT || 3002;

server.listen(PORT, () => {
    console.log(`\n🚀 Browser Remote (Puppeteer Proxy)`);
    console.log(`\n👉 Open: http://localhost:${PORT}`);
    console.log(`\nPuppeteer proxy to browserless`);
    console.log(`Connected to: ${BROWSERLESS_URL}`);
    console.log(`\nFeatures:`);
    console.log(`  ✓ Puppeteer manages CDP connection`);
    console.log(`  ✓ Socket.io for frame delivery`);
    console.log(`  ✓ Each client gets own browser page`);
    console.log(`  ✓ Full interactivity (click, type, scroll)`);
    console.log(`\nBrowser view only\n`);
});
