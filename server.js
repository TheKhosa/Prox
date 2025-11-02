const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const BROWSERLESS_URL = 'ws://145.239.253.161:3000';
let browser = null;
let page = null;
let isReady = false;
let cdpSession = null;

// Initialize browser
async function initBrowser() {
    try {
        console.log('Connecting to browserless at', BROWSERLESS_URL);

        browser = await puppeteer.connect({
            browserWSEndpoint: BROWSERLESS_URL
        });

        const pages = await browser.pages();
        page = pages[0] || await browser.newPage();

        // Set default viewport
        await page.setViewport({
            width: 1280,
            height: 720,
            deviceScaleFactor: 1
        });

        console.log('Navigating to google.co.uk...');
        await page.goto('https://www.google.co.uk', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Set up CDP session for screencast
        cdpSession = await page.target().createCDPSession();

        // Start screencast at 60fps for smooth video
        await cdpSession.send('Page.startScreencast', {
            format: 'jpeg',
            quality: 90,
            maxWidth: 1920,
            maxHeight: 1080,
            everyNthFrame: 1 // Every frame for 60fps
        });

        // Handle screencast frames
        cdpSession.on('Page.screencastFrame', async ({data, metadata, sessionId}) => {
            // Acknowledge frame receipt
            await cdpSession.send('Page.screencastFrameAck', {sessionId});

            // Broadcast frame to all connected clients
            io.emit('frame', {
                image: data,
                metadata
            });
        });

        isReady = true;
        console.log('Browser ready with screencast streaming at 60fps!');
        console.log('\n🚀 Interactive Browser Server with 60fps streaming!');
        console.log(`\n👉 Open in browser: http://localhost:${PORT}`);
        console.log('\nFeatures:');
        console.log('  ✓ Real-time 60fps video stream via browserless');
        console.log('  ✓ YouTube playback supported');
        console.log('  ✓ Click, type, scroll, zoom');
        console.log('  ✓ Smooth animations');
        console.log('\nBrowser is ready!');

    } catch (error) {
        console.error('Browser init error:', error);
        isReady = false;
    }
}

// Socket.io connections
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Get status
app.get('/status', (req, res) => {
    res.json({ ready: isReady });
});

// Handle click
app.post('/click', async (req, res) => {
    if (!isReady || !page) {
        return res.status(503).json({ error: 'Browser not ready' });
    }

    try {
        const { x, y, width, height } = req.body;

        console.log(`Click at: ${x}, ${y}`);

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

        // Perform click
        await page.mouse.click(x, y);

        res.json({ success: true });

    } catch (error) {
        console.error('Click error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Handle keyboard input
app.post('/type', async (req, res) => {
    if (!isReady || !page) {
        return res.status(503).json({ error: 'Browser not ready' });
    }

    try {
        const { text, key } = req.body;

        console.log(`Type: ${text || key}`);

        if (text) {
            await page.keyboard.type(text);
        } else if (key) {
            await page.keyboard.press(key);
        }

        res.json({ success: true });

    } catch (error) {
        console.error('Type error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Navigate to URL
app.post('/navigate', async (req, res) => {
    if (!isReady || !page) {
        return res.status(503).json({ error: 'Browser not ready' });
    }

    try {
        const { url } = req.body;

        console.log(`Navigating to: ${url}`);

        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        res.json({ success: true });

    } catch (error) {
        console.error('Navigate error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Handle scroll
app.post('/scroll', async (req, res) => {
    if (!isReady || !page) {
        return res.status(503).json({ error: 'Browser not ready' });
    }

    try {
        const { deltaX, deltaY } = req.body;

        console.log(`Scroll: deltaX=${deltaX}, deltaY=${deltaY}`);

        // Scroll using mouse wheel
        await page.mouse.wheel({ deltaX: deltaX || 0, deltaY: deltaY || 0 });

        res.json({ success: true });

    } catch (error) {
        console.error('Scroll error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Handle zoom
app.post('/zoom', async (req, res) => {
    if (!isReady || !page) {
        return res.status(503).json({ error: 'Browser not ready' });
    }

    try {
        const { scale } = req.body;

        console.log(`Zoom to scale: ${scale}`);

        // Get current viewport
        const viewport = page.viewport();

        // Update viewport with new scale
        await page.setViewport({
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: scale || 1
        });

        res.json({ success: true });

    } catch (error) {
        console.error('Zoom error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Reload page
app.post('/reload', async (req, res) => {
    if (!isReady || !page) {
        return res.status(503).json({ error: 'Browser not ready' });
    }

    try {
        console.log('Reloading page...');

        await page.reload({
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        res.json({ success: true });

    } catch (error) {
        console.error('Reload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve test.html as index
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'test.html'));
});

// Start server
const PORT = 3001;

initBrowser().then(() => {
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}).catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});

// Cleanup on exit
process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    if (browser) {
        await browser.disconnect();
    }
    process.exit(0);
});
