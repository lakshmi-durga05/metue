const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3001;

const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5174',
      'http://localhost:5175',
      'http://127.0.0.1:5175',
    ],
    methods: ['GET', 'POST']
  }
});

const whiteboards = new Map(); // roomId -> { actions: Array<stroke|fill> }

io.on('connection', (socket) => {
  let joinedRoom = null;
  let user = null;

  socket.on('room:join', ({ roomId, userId, name, avatar }) => {
    joinedRoom = roomId;
    user = { id: userId, name, avatar };
    socket.join(roomId);
    socket.to(roomId).emit('presence:join', user);

    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    const members = clients
      .map((id) => io.sockets.sockets.get(id))
      .filter(Boolean)
      .map((s) => s.data.user)
      .filter(Boolean);

    socket.emit('presence:roster', members);
    socket.data.user = user;
    if (!whiteboards.has(roomId)) whiteboards.set(roomId, { actions: [] });
  });

  function findSocketIdByUserId(roomId, targetUserId) {
    const clientIds = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    for (const sid of clientIds) {
      const s = io.sockets.sockets.get(sid);
      if (s && s.data && s.data.user && s.data.user.id === targetUserId) {
        return sid;
      }
    }
    return null;
  }

  socket.on('webrtc:signal', (payload) => {
    if (!joinedRoom || !user) return;
    const { to, from, data } = payload || {};
    const targetSid = findSocketIdByUserId(joinedRoom, to);
    if (targetSid) {
      io.to(targetSid).emit('webrtc:signal', { from: from || user.id, data });
    }
  });

  socket.on('avatar:pose', (payload) => {
    if (!joinedRoom) return;
    socket.to(joinedRoom).emit('avatar:pose', payload);
  });

  socket.on('avatar:update', (payload) => {
    if (!joinedRoom || !user) return;
    const { avatar } = payload || {};
    if (!avatar) return;
    user.avatar = avatar;
    socket.data.user = user;
    io.to(joinedRoom).emit('presence:update', user);
  });

  socket.on('cursor:pos', (payload) => {
    if (!joinedRoom) return;
    socket.to(joinedRoom).emit('cursor:pos', payload);
  });

  socket.on('whiteboard:stroke', (payload) => {
    if (!joinedRoom) return;
    const board = whiteboards.get(joinedRoom) || { actions: [] };
    if (payload && Array.isArray(payload.points)) {
      const act = { type: 'stroke', tool: payload.tool || 'pencil', color: payload.color, size: payload.size, points: payload.points };
      board.actions.push(act);
      whiteboards.set(joinedRoom, board);
      socket.to(joinedRoom).emit('whiteboard:stroke', act);
    }
  });

  socket.on('whiteboard:fill', (payload) => {
    if (!joinedRoom) return;
    const board = whiteboards.get(joinedRoom) || { actions: [] };
    if (payload && typeof payload.x === 'number' && typeof payload.y === 'number') {
      const act = { type: 'fill', color: payload.color, x: payload.x, y: payload.y };
      board.actions.push(act);
      whiteboards.set(joinedRoom, board);
      socket.to(joinedRoom).emit('whiteboard:fill', act);
    }
  });

  socket.on('whiteboard:clear', () => {
    if (!joinedRoom) return;
    whiteboards.set(joinedRoom, { actions: [] });
    io.to(joinedRoom).emit('whiteboard:clear');
  });

  socket.on('whiteboard:requestState', () => {
    if (!joinedRoom) return;
    const board = whiteboards.get(joinedRoom) || { actions: [] };
    socket.emit('whiteboard:state', board);
  });

  socket.on('chat:message', (payload) => {
    if (!joinedRoom || !payload || typeof payload.text !== 'string') return;
    const msg = {
      userId: user?.id,
      name: user?.name || 'Guest',
      text: payload.text,
      ts: Date.now(),
      cid: payload.cid,
    };
    io.to(joinedRoom).emit('chat:message', msg);
  });

  socket.on('disconnect', () => {
    if (joinedRoom && user) {
      socket.to(joinedRoom).emit('presence:leave', user);
    }
  });
});

server.listen(PORT, () => {
  console.log(`socket.io server listening on http://localhost:${PORT}`);
});