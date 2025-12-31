const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = 3000;

// Store available workers and active sessions
// Map: socketId -> { type: 'worker' | 'client', sessionId: string }
const connections = new Map();

// Map: sessionId -> { clientSocket: socket, workerSocket: socket }
const sessions = new Map();

// Queue of waiting clients if no worker is available (simple implementation)
const waitingClients = [];
const availableWorkers = [];

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // --- 1. Identify Connection Type ---
  socket.on('register-worker', () => {
    console.log(`🔌 Worker registered: ${socket.id}`);
    connections.set(socket.id, { type: 'worker', status: 'idle' });

    // Check if any clients are waiting
    if (waitingClients.length > 0) {
      // Assign immediately - DO NOT add to availableWorkers pool
      const clientSocket = waitingClients.shift();
      matchClientWithWorker(clientSocket, socket);
    } else {
      availableWorkers.push(socket);
    }
  });

  socket.on('register-client', () => {
    console.log(`👤 Client registered: ${socket.id}`);
    if (!connections.has(socket.id)) {
      connections.set(socket.id, { type: 'client' });
    }
  });

  // --- 2. Session Management ---
  socket.on('request-session', (config) => {
    console.log(`Client ${socket.id} requesting session`);

    // Auto-register if missing (handling race condition)
    if (!connections.has(socket.id)) {
      console.log(`⚠️ Client ${socket.id} not registered, auto-registering.`);
      connections.set(socket.id, { type: 'client' });
    }

    // Find an available worker
    // Filter out any disconnected/busy workers that might be lingering
    let workerSocket = null;
    while (availableWorkers.length > 0) {
      const candidate = availableWorkers[0];
      const conn = connections.get(candidate.id);

      if (conn && conn.status === 'idle') {
        workerSocket = availableWorkers.shift(); // Remove from pool
        break;
      } else {
        // Cleanup invalid worker
        availableWorkers.shift();
      }
    }

    if (workerSocket) {
      matchClientWithWorker(socket, workerSocket, config);
    } else {
      console.log('No workers available, queuing client...');
      socket.emit('status', 'Waiting for available browser engine...');
      waitingClients.push(socket);
    }
  });

  // --- 3. Relay Logic (WebRTC Signaling / Protocol) ---
  socket.on('signal', (data) => {
    // Relay signal from Client <-> Worker
    const conn = connections.get(socket.id);
    if (!conn || !conn.sessionId) return;

    const session = sessions.get(conn.sessionId);
    if (!session) return;

    const target = conn.type === 'client' ? session.workerSocket : session.clientSocket;
    if (target) {
      target.emit('signal', data);
    }
  });

  // Relay generic inputs/outputs
  socket.on('browser-event', (data) => {
    const conn = connections.get(socket.id);
    if (!conn || !conn.sessionId) return;

    const session = sessions.get(conn.sessionId);
    if (!session) return;

    // If from client, send to worker
    if (conn.type === 'client') {
      session.workerSocket.emit('input-event', data);
    }
    // If from worker (e.g. video frame), send to client
    else if (conn.type === 'worker') {
      session.clientSocket.emit('frame', data);
    }
  });

  socket.on('disconnect', () => {
    const conn = connections.get(socket.id);
    if (!conn) return;

    if (conn.type === 'worker') {
      // Remove from available
      const idx = availableWorkers.indexOf(socket);
      if (idx > -1) availableWorkers.splice(idx, 1);

      // Notify partner if in session
      if (conn.sessionId) {
        const session = sessions.get(conn.sessionId);
        if (session && session.clientSocket) {
          session.clientSocket.emit('worker-disconnected');
        }
        sessions.delete(conn.sessionId);
      }
    } else {
      // Client disconnected
      if (conn.sessionId) {
        const session = sessions.get(conn.sessionId);
        if (session && session.workerSocket) {
          // Kill session 
          session.workerSocket.emit('stop-session');

          // Allow some time for cleanup before making worker available again
          setTimeout(() => {
            // Check if worker is still connected
            if (connections.has(session.workerSocket.id)) {
              connections.get(session.workerSocket.id).status = 'idle';
              connections.get(session.workerSocket.id).sessionId = null;
              availableWorkers.push(session.workerSocket);
            }
          }, 1000);
        }
        sessions.delete(conn.sessionId);
      }
      // Remove from queue
      const qIdx = waitingClients.indexOf(socket);
      if (qIdx > -1) waitingClients.splice(qIdx, 1);
    }
    connections.delete(socket.id);
  });
});

function matchClientWithWorker(clientSocket, workerSocket, config) {
  if (!clientSocket || !workerSocket) return;

  // Safety check: ensure client entry exists
  if (!connections.has(clientSocket.id)) {
    connections.set(clientSocket.id, { type: 'client' });
  }

  // Safety check: ensure worker entry exists
  if (!connections.has(workerSocket.id)) {
    console.error(`Worker ${workerSocket.id} disappeared before assignment`);
    return;
  }

  const sessionId = Math.random().toString(36).substring(7);
  console.log(`Assigning Worker ${workerSocket.id} to Client ${clientSocket.id} (Session: ${sessionId})`);

  // Update States
  connections.get(clientSocket.id).sessionId = sessionId;
  connections.get(workerSocket.id).sessionId = sessionId;
  connections.get(workerSocket.id).status = 'busy';

  sessions.set(sessionId, { clientSocket, workerSocket });

  // Tell worker to start
  workerSocket.emit('start-session', config);
  clientSocket.emit('session-started', { sessionId });
}

server.listen(PORT, () => {
  console.log(`🌉 Gateway (Middle Bridge) running on http://localhost:${PORT}`);
});
