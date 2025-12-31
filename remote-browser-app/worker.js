const { io } = require('socket.io-client');
const { chromium } = require('playwright');

// Connect to the Middleware Bridge
const GATEWAY_URL = 'http://localhost:3000';
const socket = io(GATEWAY_URL);

let browser;
let context;
let page;
let cdpClient;
let activeSessionId = null;

socket.on('connect', () => {
    console.log('✅ Connected to Gateway');
    socket.emit('register-worker');
});

socket.on('start-session', async (config) => {
    console.log('🚀 Starting Browser Session...');
    await launchBrowser(config?.url);
});

socket.on('input-event', async (event) => {
    if (!page) return;
    try {
        switch (event.type) {
            case 'mousemove':
                if (event.xp !== undefined && event.yp !== undefined) {
                    const view = page.viewportSize();
                    if (view) {
                        await page.mouse.move(event.xp * view.width, event.yp * view.height);
                    }
                } else {
                    await page.mouse.move(event.x, event.y);
                }
                break;
            case 'mousedown':
                // Ensure we move to the latest position first if provided
                if (event.xp !== undefined && event.yp !== undefined) {
                    const view = page.viewportSize();
                    if (view) {
                        await page.mouse.move(event.xp * view.width, event.yp * view.height);
                    }
                }
                await page.mouse.down();
                break;
            case 'mouseup':
                await page.mouse.up();
                break;
            case 'click':
                // Keeping click as fallback, but mousedown/up is better
                await page.mouse.click(event.x, event.y);
                break;
            case 'keydown':
                // Handles Enter, Backspace, Arrows, modifiers, etc.
                await page.keyboard.press(event.key);
                break;
            case 'wheel':
                await page.mouse.wheel(event.deltaX || 0, event.deltaY);
                break;
            case 'resize':
                console.log(`Resizing to ${event.width}x${event.height}`);
                await page.setViewportSize({ width: event.width, height: event.height });
                // We must restart screencast to match new dims to avoid scaling artifacts
                if (cdpClient) {
                    await cdpClient.send('Page.startScreencast', {
                        format: 'jpeg',
                        quality: 70,
                        maxWidth: event.width,
                        maxHeight: event.height
                    });
                }
                break;
            case 'navigate':
                await page.goto(event.url);
                break;
        }
    } catch (e) {
        console.error('Input error:', e.message);
    }
});

socket.on('stop-session', async () => {
    console.log('🛑 Stopping Session');
    if (browser) {
        await browser.close();
        browser = null;
        page = null;
    }
});

async function launchBrowser(startUrl = 'https://www.google.com') {
    try {
        if (browser) await browser.close();

        browser = await chromium.launch({
            headless: true, // Headless but we stream the view
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        context = await browser.newContext({
            viewport: { width: 1280, height: 720 }
        });

        page = await context.newPage();
        await page.goto(startUrl);

        // Start CDP Screencast (Simulated WebRTC Video Stream source)
        cdpClient = await page.context().newCDPSession(page);
        await cdpClient.send('Page.startScreencast', {
            format: 'jpeg',
            quality: 70,
            maxWidth: 1280,
            maxHeight: 720
        });

        cdpClient.on('Page.screencastFrame', async (frame) => {
            const { data, sessionId, metadata } = frame;

            // Emit frame to gateway -> client
            // "data" is base64 encoded jpeg
            socket.emit('browser-event', `data:image/jpeg;base64,${data}`);

            try {
                await cdpClient.send('Page.screencastFrameAck', { sessionId });
            } catch (e) { }
        });

        console.log(`Browser running at ${startUrl}`);

    } catch (e) {
        console.error('Failed to launch browser:', e);
    }
}
