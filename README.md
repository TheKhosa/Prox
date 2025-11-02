# Prox - Real-time Interactive Browser Streaming

A high-performance web application that provides real-time browser streaming at 60fps with full interactivity. Connects to a remote browserless instance for scalable browser automation. Built with Node.js, Puppeteer, Socket.io, and Chrome DevTools Protocol.

## Features

- **60fps Real-time Streaming**: Smooth video-like browser streaming using Chrome DevTools Protocol screencast
- **Full Interactivity**: Click, type, scroll, and zoom on the streamed browser
- **URL Navigation**: Navigate to any website via URL parameters
- **YouTube Support**: Watch YouTube videos with smooth 60fps playback
- **Socket.io WebSocket**: Low-latency frame delivery
- **Responsive**: Automatically adapts to browser viewport size

## Quick Start

### Prerequisites

- Node.js (v14 or higher)
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/TheKhosa/Prox.git
cd Prox

# Install dependencies
npm install

# Start the server
npm start
```

The server will start on `http://localhost:3001`

## Usage

### Basic Usage

Open your browser and navigate to:
```
http://localhost:3001
```

This will display Google UK by default.

### Navigate to Different URLs

Use the `?url=` parameter to navigate to any website:

```
http://localhost:3001/?url=youtube.com
http://localhost:3001/?url=github.com
http://localhost:3001/?url=wikipedia.org
http://localhost:3001/?url=docs.google.com
```

The system automatically adds `https://` if no protocol is specified.

### Interactions

| Action | How to Use |
|--------|------------|
| **Click** | Left-click anywhere on the page |
| **Type** | Use keyboard to type text |
| **Submit** | Press Enter |
| **Delete** | Press Backspace |
| **Navigate Fields** | Press Tab |
| **Scroll** | Use mouse wheel |
| **Zoom** | Ctrl + Mouse Wheel |
| **Refresh** | F5 or Ctrl+R |

## Architecture

### Technology Stack

- **Backend**: Node.js + Express
- **Browser Automation**: Puppeteer connected to remote browserless instance
- **Browserless Instance**: ws://145.239.253.161:3000
- **Real-time Communication**: Socket.io
- **Streaming Protocol**: Chrome DevTools Protocol (CDP)

### How It Works

1. **Server** (`server.js`):
   - Connects to remote browserless instance via Puppeteer
   - Establishes CDP session for screencast streaming
   - Streams JPEG frames at 60fps to connected clients
   - Handles user interactions (click, type, scroll, zoom)
   - Provides REST API endpoints for browser control

2. **Client** (`test.html`):
   - Connects to server via Socket.io
   - Receives and displays frames in real-time
   - Captures user interactions
   - Sends interactions to server for execution

3. **Frame Flow**:
   ```
   Headless Browser → CDP Screencast → Server → Socket.io → Client Browser
   ```

4. **Interaction Flow**:
   ```
   User Input → Client → HTTP POST → Server → Puppeteer → Browser
   ```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Check if browser is ready |
| `/screenshot` | GET | Get static screenshot (PNG) |
| `/click` | POST | Send click event `{x, y, width, height}` |
| `/type` | POST | Send keyboard input `{key}` or `{text}` |
| `/navigate` | POST | Navigate to URL `{url}` |
| `/scroll` | POST | Scroll page `{deltaX, deltaY}` |
| `/zoom` | POST | Zoom in/out `{scale}` |
| `/reload` | POST | Reload current page |

## Configuration

### Default Settings

- **Port**: 3001
- **Default Viewport**: 1280x720
- **Frame Format**: JPEG
- **Frame Quality**: 90
- **Max Resolution**: 1920x1080
- **Frame Rate**: 60fps (everyNthFrame: 1)

### Customizing Server

Edit `server.js` to customize:

```javascript
// Change viewport size
await page.setViewport({
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1
});

// Change screencast quality
await cdpSession.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,  // 1-100
    maxWidth: 1920,
    maxHeight: 1080,
    everyNthFrame: 1  // 1 = 60fps, 2 = 30fps
});
```

## Project Structure

```
Prox/
├── server.js                   # Main server application
├── test.html                   # Client interface
├── package.json                # Dependencies
├── README.md                   # Documentation
├── FUNCTIONALITY_TEST.md       # Testing guide
└── node_modules/               # Dependencies (gitignored)
```

## Performance

- **Latency**: ~16-50ms per frame
- **Frame Rate**: Up to 60fps
- **Bandwidth**: ~500KB/s - 2MB/s (depends on content)
- **CPU Usage**: Moderate (Chrome rendering + JPEG encoding)

## Use Cases

- Remote browser access
- Web testing and QA
- Live demos and presentations
- Browser automation with visual feedback
- Collaborative browsing
- Accessibility tools
- Security sandboxing

## Known Limitations

Currently not implemented:
- Right-click context menu
- Text selection/copy/paste
- Drag and drop
- File uploads
- Browser back/forward buttons
- Download handling
- Multiple tabs/windows

## Development

### Running in Development

```bash
npm start
```

### Testing

See `FUNCTIONALITY_TEST.md` for comprehensive testing guide.

## Troubleshooting

### Browser not launching
- Ensure Chromium dependencies are installed
- Try running with `--no-sandbox` flag (already enabled)

### Low frame rate
- Reduce `quality` parameter in screencast settings
- Reduce `maxWidth` and `maxHeight`
- Check network bandwidth

### High CPU usage
- Lower the quality setting
- Reduce viewport resolution
- Increase `everyNthFrame` (e.g., 2 for 30fps)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this project for any purpose.

## Author

TheKhosa

## Acknowledgments

- Built with [Puppeteer](https://pptr.dev/)
- Powered by [Socket.io](https://socket.io/)
- Uses Chrome DevTools Protocol

---

**Note**: This is a powerful tool that can access any website. Use responsibly and ensure compliance with websites' terms of service.
