import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Monitor, MousePointer2, Globe, Cpu, Network, Lock, AlertCircle } from 'lucide-react';

const GATEWAY_URL = 'http://localhost:3000';

function App() {
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState('Disconnected');
  const [sessionId, setSessionId] = useState(null);
  const [frame, setFrame] = useState(null);
  const [urlInput, setUrlInput] = useState('https://www.google.com');

  const imgRef = useRef(null);

  useEffect(() => {
    const newSocket = io(GATEWAY_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setStatus('Connected to Gateway');
      newSocket.emit('register-client');
    });

    newSocket.on('disconnect', () => {
      setStatus('Disconnected');
      setSessionId(null);
    });

    newSocket.on('session-started', ({ sessionId }) => {
      setStatus('Session Active');
      setSessionId(sessionId);
    });

    newSocket.on('status', (msg) => setStatus(msg));

    newSocket.on('frame', (data) => {
      setFrame(data);
    });

    newSocket.on('worker-disconnected', () => {
      setStatus('Browser Instance Lost');
      setSessionId(null);
      setFrame(null);
    });

    return () => newSocket.close();
  }, []);

  // Keyboard Event Capture
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!sessionId || !socket) return;
      // Don't capture inputs if user is typing in the URL bar
      if (document.activeElement.tagName === 'INPUT') return;

      // Prevent default browser actions (like F5, Ctrl+R, etc) while focused on the app
      // We permit some system keys if needed, but for "remote" feel, we block most.
      if (e.key !== 'F12' && e.key !== 'F11') {
        e.preventDefault();
      }

      console.log('Key pressed:', e.key);
      socket.emit('browser-event', { type: 'keydown', key: e.key });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [socket, sessionId]);

  const requestSession = () => {
    if (!socket) return;
    setStatus('Requesting Isolated Node...');
    socket.emit('request-session', { url: urlInput });
  };

  const terminateSession = () => {
    // window.location.reload(); // Too aggressive
    socket.emit('stop-session');
    setSessionId(null);
    setFrame(null);
    setStatus('Disconnected (Session Ended)');
  };

  const handleNavigate = (e) => {
    e.preventDefault();
    if (socket && sessionId) {
      let target = urlInput;
      if (!target.startsWith('http')) {
        target = 'https://' + target;
        setUrlInput(target);
      }
      socket.emit('browser-event', { type: 'navigate', url: target });
    }
  };


  // Resize Sync
  useEffect(() => {
    if (!imgRef.current || !sessionId || !socket) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        // Debounce could be added here
        socket.emit('browser-event', { type: 'resize', width: Math.floor(width), height: Math.floor(height) });
      }
    });

    resizeObserver.observe(imgRef.current);
    return () => resizeObserver.disconnect();
  }, [sessionId, socket]);

  const getNormalizedCoords = (e, rect) => {
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return {
      xp: x / rect.width,
      yp: y / rect.height
    };
  };

  const handleMouseDown = (e) => {
    if (!imgRef.current) return;
    const coords = getNormalizedCoords(e, imgRef.current.getBoundingClientRect());
    socket?.emit('browser-event', { type: 'mousedown', ...coords });
  };

  const handleMouseUp = (e) => {
    socket?.emit('browser-event', { type: 'mouseup' });
  };

  const handleWheel = (e) => {
    e.preventDefault();
    socket?.emit('browser-event', { type: 'wheel', deltaX: e.deltaX, deltaY: e.deltaY });
  };

  const handleInteraction = (e) => {
    if (!socket || !sessionId || !imgRef.current) return;
    const coords = getNormalizedCoords(e, imgRef.current.getBoundingClientRect());
    socket.emit('browser-event', { type: 'mousemove', ...coords });
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-[#050608] text-gray-100 font-sans overflow-hidden">

      {/* --- Top Bar (Command Center) --- */}
      <div className="flex h-16 items-center justify-between border-b border-white/5 bg-[#0f1115] px-6">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${status === 'Session Active' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-yellow-500'}`}></div>
          <span className="font-mono text-sm font-medium tracking-wide text-gray-400">{status.toUpperCase()}</span>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Network size={14} />
            <span>WebRTC Bridge</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Cpu size={14} />
            <span>Remote Chromium</span>
          </div>
          <div className="h-4 w-[1px] bg-white/10"></div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Lock size={14} />
            <span>E2E Encrypted</span>
          </div>
        </div>
      </div>

      {/* --- Main Content --- */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar Controls */}
        <div className="w-80 border-r border-white/5 bg-[#0a0c10] p-6 flex flex-col gap-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white mb-1">Virtual Browser</h1>
            <p className="text-sm text-gray-500">Remote Browser Isolation</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold text-gray-400 uppercase">Target URL</label>
              <form onSubmit={handleNavigate} className="flex flex-col gap-2">
                <div className="relative">
                  <Globe className="absolute left-3 top-2.5 text-gray-500" size={16} />
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    className="w-full rounded-lg bg-black/40 border border-white/10 py-2 pl-9 pr-3 text-sm text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                {sessionId && (
                  <button type="submit" className="w-full rounded-md bg-white/5 py-1.5 text-xs font-medium hover:bg-white/10">Navigate</button>
                )}
              </form>
            </div>

            {!sessionId ? (
              <button
                onClick={requestSession}
                className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white shadow-lg transition-all hover:bg-indigo-500"
              >
                <span className="relative z-10 flex items-center gap-2"><Cpu size={16} /> Allocate Instance</span>
                <div className="absolute inset-0 -z-0 translate-y-full bg-gradient-to-t from-black/20 to-transparent transition-transform group-hover:translate-y-0"></div>
              </button>
            ) : (
              <button
                onClick={terminateSession}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 font-semibold text-red-500 transition-colors hover:bg-red-500/20"
              >
                <AlertCircle size={16} /> Terminate
              </button>
            )}
          </div>

          <div className="mt-auto rounded-lg border border-yellow-500/10 bg-yellow-500/5 p-4">
            <h3 className="mb-1 text-xs font-bold text-yellow-500">System Status</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Gateway: <span className="text-green-400">Online</span><br />
              Worker Pools: <span className="text-blue-400">Auto-Scaling</span><br />
              Protocol: <span className="text-purple-400">WebSocket / MJPEG-Stream</span>
            </p>
          </div>
        </div>

        {/* Viewport Area */}
        <div className="relative flex flex-1 items-center justify-center bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-[#050608]">
          {frame ? (
            <div className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-white/10 shadow-2xl shadow-black/50 m-4">
              {/* Browser Header Bar */}
              <div className="flex h-8 w-full shrink-0 items-center gap-2 bg-[#1a1d24] px-3">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500/80"></div>
                  <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/80"></div>
                  <div className="h-2.5 w-2.5 rounded-full bg-green-500/80"></div>
                </div>
                <div className="ml-4 flex-1 rounded bg-black/20 py-0.5 text-center text-[10px] text-gray-500 font-mono">
                  {urlInput}
                </div>
              </div>

              {/* Stream Content */}
              <div className="flex-1 overflow-hidden bg-white/5 relative">
                <img
                  ref={imgRef}
                  src={frame}
                  className="h-full w-full object-fill cursor-crosshair"
                  onMouseMove={handleInteraction}
                  onMouseDown={handleMouseDown}
                  onMouseUp={handleMouseUp}
                  onWheel={handleWheel}
                  onContextMenu={(e) => e.preventDefault()}
                  alt="Remote Browser"
                  draggable={false}
                />
              </div>

              {/* Custom Cursor Overlay (Optional, for feel) */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                {/* Could add processing overlay here */}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 text-white/20">
              <Monitor size={64} strokeWidth={1} />
              <p className="font-mono text-sm">NO ACTIVE SIGNAL</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
