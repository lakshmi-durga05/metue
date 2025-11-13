require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@deepgram/sdk');
const cors = require('cors');
const PORT = process.env.PORT || 3001;
// Build Express app first so it can be attached to the same HTTP server as socket.io
const app = express();
app.use(cors({ origin: [/localhost:\d+$/], credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
// Create a single HTTP server for both Express and Socket.IO
const server = http.createServer(app);
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
  },
  // Allow larger payloads for base64 data URLs when sharing media
  maxHttpBufferSize: 5e7 // 50 MB
});

// Optional: enable Socket.IO Redis adapter when clustering across processes/instances
(async () => {
  try {
    const REDIS_URL = process.env.REDIS_URL;
    if (!REDIS_URL) return; // no-op if not configured
    const { createAdapter } = require('@socket.io/redis-adapter');
    const { createClient } = require('redis');
    const pub = createClient({ url: REDIS_URL });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    console.log('Socket.IO Redis adapter enabled');
  } catch (e) {
    console.warn('Redis adapter not enabled:', (e && e.message) || e);
  }
})();

const whiteboards = new Map(); // roomId -> { actions: Array<stroke|fill> }
const roomMedia = new Map();   // roomId -> { items: Array<{name,type,dataUrl}> }
const roomDocs = new Map();    // roomId -> { text: string }
const roomTranscripts = new Map(); // roomId -> { segments: Array<{ userId, name, text, ts }> }
const roomChats = new Map();   // roomId -> { messages: Array<{ userId, name, text, ts, cid? }> }
const roomPresence = new Map(); // roomId -> Map<userId, { mic: boolean; cam: boolean }>
const MED_KEYWORDS = ['dose','dosage','mg','antibiotic','analgesic','trial','clinical','study','randomized','placebo','arm','efficacy','effect','side effect','adverse','toxicity','contraindication','pharmacokinetics','pk','pd','onset','duration','synergy','interaction','paracetamol','ibuprofen','molecule'];

const transcriptsDir = path.join(__dirname, 'transcripts');
try { if (!fs.existsSync(transcriptsDir)) fs.mkdirSync(transcriptsDir, { recursive: true }); } catch {}
// Batch-only switch (disable Deepgram live websockets). Default false; enable only if explicitly set.
const STT_BATCH_ONLY = (process.env.STT_BATCH_ONLY === '1' || process.env.STT_BATCH_ONLY === 'true');

// Batch transcription fallback state (per room)
const roomAudio = new Map(); // roomId -> { mimetype: string, chunks: Buffer[], timer: NodeJS.Timeout|null }

function ensureRoomAudio(roomId, mimetype) {
  const r = roomAudio.get(roomId) || { mimetype: mimetype || 'pcm16', chunks: [], timer: null };
  r.mimetype = mimetype || r.mimetype || 'pcm16';
  if (!r.chunks) r.chunks = [];
  roomAudio.set(roomId, r);
  return r;
}

function pcm16ToWav(int16Buffer, sampleRate = 16000, channels = 1) {
  const bytesPerSample = 2;
  const dataLength = int16Buffer.byteLength;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM header size
  buffer.writeUInt16LE(1, 20); // audio format = PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(8 * bytesPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  Buffer.from(int16Buffer).copy(buffer, 44);
  return buffer;
}

async function transcribeBatchWithOpenAI(buf, mimetype) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const filename = mimetype === 'pcm16' ? 'audio.wav' : (mimetype.includes('ogg') ? 'audio.ogg' : 'audio.webm');
  const form = new FormData();
  form.append('file', new Blob([buf]), filename);
  form.append('model', 'whisper-1');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form
  });
  if (!res.ok) throw new Error('OpenAI transcribe failed: ' + res.status + ' ' + (await res.text()).slice(0, 500));
  const js = await res.json();
  return (js?.text || '').toString();
}

io.on('connection', (socket) => {
  let joinedRoom = null;
  let user = null;
  const deepgramKey = process.env.DEEPGRAM_API_KEY || '';
  const deepgram = deepgramKey ? createClient(deepgramKey) : null;
  let dgConn = null; // Deepgram live connection per socket

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
    if (!roomMedia.has(roomId)) roomMedia.set(roomId, { items: [] });
    if (!roomChats.has(roomId)) roomChats.set(roomId, { messages: [] });
    if (!roomPresence.has(roomId)) roomPresence.set(roomId, new Map());
    // Send current media presence state to the joining client
    try {
      const presence = Array.from((roomPresence.get(roomId) || new Map()).entries())
        .map(([uid, st]) => ({ userId: uid, mic: !!st.mic, cam: !!st.cam }));
      if (presence.length) socket.emit('presence:media:state', presence);
    } catch {}
  });

  // Live STT streaming via Deepgram
  // Client should emit:
  //  - 'stt:stream:start' with { mimetype?: string, language?: string }
  //  - 'stt:stream:chunk' with raw binary audio chunks (Buffer) from MediaRecorder
  //  - 'stt:stream:stop'
  socket.on('stt:stream:start', async (cfg = {}) => {
    // Allow STT even if Deepgram client isn't available (batch-only mode)
    if (!joinedRoom) { return; }
    try {
      if (dgConn) { try { await dgConn.finish(); } catch {} dgConn = null; }
      socket.emit('stt:dg:status', { ok: true, event: 'client_start', cfg });
      const mimetype = typeof cfg.mimetype === 'string' && cfg.mimetype ? cfg.mimetype : 'audio/webm;codecs=opus';
      const language = typeof cfg.language === 'string' && cfg.language ? cfg.language : 'en-US';
      // Map client mimetype to Deepgram encoding/options
      let dgOpts = {
        model: 'nova-2-general',
        language,
        detect_language: true,
        interim_results: true,
        smart_format: true,
        punctuate: true,
        endpointing: 100,
      };
      const mt = (mimetype || '').toLowerCase();
      if (STT_BATCH_ONLY) {
        // Initialize batch-only buffer as pcm16; client fallback sends Int16 chunks via socket
        const ra = ensureRoomAudio(joinedRoom, 'pcm16');
        if (!ra.timer) {
          ra.timer = setInterval(async () => {
            try {
              const current = roomAudio.get(joinedRoom);
              if (!current || current.chunks.length === 0) return;
              if ((current.mimetype || '').toLowerCase() !== 'pcm16') return;
              const merged = Buffer.concat(current.chunks);
              current.chunks = [];
              const wav = pcm16ToWav(merged, 16000, 1);
              try {
                try { socket.emit('stt:dg:status', { ok: true, event: 'batch_start', bytes: merged.length }); } catch {}
                const text = await transcribeBatchWithOpenAI(wav, 'pcm16');
                if (text && text.trim()) {
                  const entry = { userId: user?.id, name: user?.name || 'Guest', text: text.trim(), ts: Date.now() };
                  const bag = roomTranscripts.get(joinedRoom) || { segments: [] };
                  bag.segments.push(entry);
                  roomTranscripts.set(joinedRoom, bag);
                  io.to(joinedRoom).emit('stt:segment', entry);
                  try { socket.emit('stt:dg:status', { ok: true, event: 'batch_ok', chars: text.trim().length }); } catch {}
                }
              } catch (e) { }
            } catch {}
          }, 7000);
        }
        // Do not open Deepgram websocket in batch-only mode
        dgConn = null;
      } else if (deepgram) {
        if (mt === 'pcm16') {
          dgOpts = { ...dgOpts, encoding: 'linear16', sample_rate: 16000, channels: 1 };
        } else if (mt.includes('webm')) {
          dgOpts = { ...dgOpts, encoding: 'webm' };
        } else if (mt.includes('ogg')) {
          dgOpts = { ...dgOpts, encoding: 'ogg' };
        } else if (mt.includes('opus')) {
          dgOpts = { ...dgOpts, encoding: 'ogg' };
        } else {
          dgOpts = { ...dgOpts, encoding: 'webm' };
        }
        dgConn = deepgram.listen.live(dgOpts);
        dgConn.on('open', () => { socket.emit('stt:dg:status', { ok: true, event: 'open' }); });
        dgConn.on('error', (err) => { const msg = (err && (err.message || err.toString?.())) || 'unknown'; try { socket.emit('stt:dg:status', { ok: false, event: 'error', message: msg }); } catch {} });
        dgConn.on('close', (evt) => { let code, reason; try { code = evt?.code; reason = evt?.reason || evt?.message; } catch {} try { socket.emit('stt:dg:status', { ok: true, event: 'close', code, reason }); } catch {} });
        const handleTranscript = (dgMsg) => {
          try {
            const ch = dgMsg && dgMsg.channel; const alt = ch && ch.alternatives && ch.alternatives[0]; const text = (alt && alt.transcript) || '';
            if (!text) return; const isFinal = Boolean(dgMsg.is_final);
            if (isFinal) { const entry = { userId: user?.id, name: user?.name || 'Guest', text: text.trim(), ts: Date.now() }; const bag = roomTranscripts.get(joinedRoom) || { segments: [] }; bag.segments.push(entry); roomTranscripts.set(joinedRoom, bag); io.to(joinedRoom).emit('stt:segment', entry); }
            else { socket.emit('stt:interim', { text }); }
          } catch {}
        };
        dgConn.on('transcript', handleTranscript);
        dgConn.on('transcriptReceived', handleTranscript);
      }

      // Initialize batch fallback buffer for this room (only used for pcm16 reliably)
      try {
        const ra = ensureRoomAudio(joinedRoom, mimetype);
        if (!ra.timer) {
          ra.timer = setInterval(async () => {
            try {
              const current = roomAudio.get(joinedRoom);
              if (!current || current.chunks.length === 0) return;
              // Only batch for pcm16 to ensure valid WAV
              if ((current.mimetype || '').toLowerCase() !== 'pcm16') return;
              const merged = Buffer.concat(current.chunks);
              current.chunks = [];
              const wav = pcm16ToWav(merged, 16000, 1);
              try {
                try { socket.emit('stt:dg:status', { ok: true, event: 'batch_start', bytes: merged.length }); } catch {}
                const text = await transcribeBatchWithOpenAI(wav, 'pcm16');
                if (text && text.trim()) {
                  const entry = { userId: user?.id, name: user?.name || 'Guest', text: text.trim(), ts: Date.now() };
                  const bag = roomTranscripts.get(joinedRoom) || { segments: [] };
                  bag.segments.push(entry);
                  roomTranscripts.set(joinedRoom, bag);
                  io.to(joinedRoom).emit('stt:segment', entry);
                  try { socket.emit('stt:dg:status', { ok: true, event: 'batch_ok', chars: text.trim().length }); } catch {}
                }
              } catch (e) { }
            } catch {}
          }, 7000);
        }
      } catch {}

      // Note: transcript listeners are already attached above when dgConn is created.
    } catch (e) {
      socket.emit('stt:dg:status', { ok: false, event: 'start_error', error: String(e && e.message || e) });
    }
  });

  socket.on('stt:stream:chunk', async (chunk) => {
    if (!chunk) return;
    try {
      // chunk can be Buffer or ArrayBuffer
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buf && buf.length) {
        if (dgConn) { try { dgConn.send(buf); } catch {} }
        socket.emit('stt:dg:status', { ok: true, event: 'chunk_sent', bytes: buf.length });
      }
      // Save for batch fallback when using pcm16
      try {
        if (joinedRoom) {
          const ra = ensureRoomAudio(joinedRoom);
          // In batch-only mode we always store PCM16 chunks; client fallback sends Int16
          ra.chunks.push(buf);
        }
      } catch {}
    } catch (e) {
      try { socket.emit('stt:dg:status', { ok: false, event: 'send_error', message: e?.message || 'send failed' }); } catch {}
    }
  });

  socket.on('stt:stream:stop', async () => {
    if (!dgConn) return;
    try { await dgConn.finish(); } catch {}
    dgConn = null;
  });

  // Transcript: collect final STT segments per room and broadcast
  socket.on('stt:segment', (payload) => {
    if (!joinedRoom || !payload || typeof payload.text !== 'string' || !payload.text.trim()) return;
    const entry = { userId: user?.id, name: user?.name || 'Guest', text: payload.text.trim(), ts: Date.now() };
    const bag = roomTranscripts.get(joinedRoom) || { segments: [] };
    bag.segments.push(entry);
    roomTranscripts.set(joinedRoom, bag);
    io.to(joinedRoom).emit('stt:segment', entry);
  });
  // Relay interim to room so others also see live text (not persisted)
  socket.on('stt:interim', (payload) => {
    if (!joinedRoom || !payload || typeof payload.text !== 'string') return;
    socket.to(joinedRoom).emit('stt:interim', { text: payload.text });
  });
  socket.on('stt:requestState', () => {
    if (!joinedRoom) return;
    const bag = roomTranscripts.get(joinedRoom) || { segments: [] };
    socket.emit('stt:state', bag);
  });
  socket.on('stt:summary', () => {
    if (!joinedRoom) return;
    const bag = roomTranscripts.get(joinedRoom) || { segments: [] };
    const all = bag.segments.map(s=>s.text).join(' ');
    if (!all.trim()) { socket.emit('stt:summary', { summary: '' }); return; }
    try {
      const sentences = all.split(/(?<=[.!?])\s+/).slice(0, 80);
      const words = all.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      const stop = new Set(['the','and','a','an','to','of','in','is','it','that','for','on','with','as','are','was','be','this','you','i']);
      const freq = new Map();
      for (const w of words) { if (!stop.has(w)) freq.set(w, (freq.get(w)||0)+1); }
      const scored = sentences.map((s) => {
        const sw = s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
        const score = sw.reduce((sum, w) => sum + (freq.get(w)||0), 0) / Math.sqrt(sw.length || 1);
        return { s, score };
      });
      scored.sort((a,b)=> b.score - a.score);
      const top = scored.slice(0, Math.max(2, Math.min(6, Math.ceil(scored.length/3))))
                        .map(x=>x.s.trim()).join(' ');
      socket.emit('stt:summary', { summary: top });
    } catch {
      socket.emit('stt:summary', { summary: '' });
    }
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

  // Media presence: broadcast mic/cam state to the room
  socket.on('presence:media', (payload) => {
    if (!joinedRoom || !user) return;
    try {
      const mic = !!(payload && payload.mic);
      const cam = !!(payload && payload.cam);
      // Persist last known media presence
      try {
        if (!roomPresence.has(joinedRoom)) roomPresence.set(joinedRoom, new Map());
        roomPresence.get(joinedRoom).set(user.id, { mic, cam });
      } catch {}
      io.to(joinedRoom).emit('presence:media', { userId: user.id, mic, cam });
    } catch {}
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

  // Collaborative document editing: simple last-write-wins text sync
  socket.on('doc:requestState', () => {
    if (!joinedRoom) return;
    const doc = roomDocs.get(joinedRoom) || { text: '' };
    socket.emit('doc:state', doc);
  });
  socket.on('doc:update', (payload) => {
    if (!joinedRoom || !payload || typeof payload.text !== 'string') return;
    const current = roomDocs.get(joinedRoom) || { text: '' };
    current.text = payload.text;
    roomDocs.set(joinedRoom, current);
    socket.to(joinedRoom).emit('doc:update', { text: current.text });
  });

  // AI meeting summarization: lightweight extractive summary
  socket.on('ai:summarize', (payload) => {
    if (!payload || typeof payload.text !== 'string') return;
    const text = payload.text.trim();
    if (!text) { socket.emit('ai:summary', { summary: '' }); return; }
    try {
      const sentences = text.split(/(?<=[.!?])\s+/).slice(0, 30);
      const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      const stop = new Set(['the','and','a','an','to','of','in','is','it','that','for','on','with','as','are','was','be']);
      const freq = new Map();
      for (const w of words) { if (!stop.has(w)) freq.set(w, (freq.get(w)||0)+1); }
      const scored = sentences.map((s) => {
        const sw = s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
        const score = sw.reduce((sum, w) => sum + (freq.get(w)||0), 0) / Math.sqrt(sw.length || 1);
        return { s, score };
      });
      scored.sort((a,b)=> b.score - a.score);
      const top = scored.slice(0, Math.max(2, Math.min(5, Math.ceil(scored.length/3))))
                        .map(x=>x.s.trim()).join(' ');
      socket.emit('ai:summary', { summary: top });
    } catch {
      socket.emit('ai:summary', { summary: '' });
    }
  });

  // Media sharing: broadcast newly added files as data URLs to the room
  socket.on('media:add', (payload) => {
    if (!joinedRoom) return;
    const items = (payload && Array.isArray(payload.items)) ? payload.items : [];
    if (!items.length) return;
    const stash = roomMedia.get(joinedRoom) || { items: [] };
    stash.items.push(...items);
    roomMedia.set(joinedRoom, stash);
    const sender = { id: user?.id, name: user?.name };
    io.to(joinedRoom).emit('media:add', { items, user: sender });
  });

  socket.on('media:requestState', () => {
    if (!joinedRoom) return;
    const stash = roomMedia.get(joinedRoom) || { items: [] };
    socket.emit('media:state', stash);
  });

  socket.on('chat:message', (payload) => {
    if (!joinedRoom || !payload) return;
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const text = typeof payload.text === 'string' ? payload.text : '';
    if (!text && attachments.length === 0) return;
    const msg = {
      userId: user?.id,
      name: user?.name || 'Guest',
      text,
      attachments, // each: { name, type, dataUrl }
      ts: Date.now(),
      cid: payload.cid,
    };
    try {
      const chat = roomChats.get(joinedRoom) || { messages: [] };
      chat.messages.push({ userId: msg.userId, name: msg.name, text: msg.text, ts: msg.ts, cid: msg.cid, attachments: msg.attachments });
      roomChats.set(joinedRoom, chat);
    } catch {}
    io.to(joinedRoom).emit('chat:message', msg);
  });

  // Compile and persist transcript when a client ends the meeting
  socket.on('meeting:end', () => {
    if (!joinedRoom) return;
    try {
      const rid = joinedRoom;
      const stt = roomTranscripts.get(rid) || { segments: [] };
      const chat = roomChats.get(rid) || { messages: [] };
      const combined = [];
      for (const s of (stt.segments || [])) combined.push({ kind: 'voice', userId: s.userId, name: s.name, text: s.text, ts: s.ts });
      for (const m of (chat.messages || [])) combined.push({ kind: 'chat', userId: m.userId, name: m.name, text: m.text, ts: m.ts });
      combined.sort((a,b)=> (a.ts||0)-(b.ts||0));
      const participantsMap = new Map();
      for (const ev of combined) { if (ev.userId) participantsMap.set(ev.userId, ev.name || 'Guest'); }
      const participants = Array.from(participantsMap.entries()).map(([id,name])=>({ id, name }));
      const startedAt = combined.length ? combined[0].ts : Date.now();
      const endedAt = Date.now();
      const transcriptText = combined.map(ev => {
        const t = new Date(ev.ts).toISOString();
        return `[${t}] ${ev.name}: ${ev.text}`;
      }).join('\n');
      const payload = { roomId: rid, startedAt, endedAt, participants, events: combined, transcriptText };
      const fname = `${rid}-${endedAt}.json`;
      const fpath = path.join(transcriptsDir, fname);
      try { fs.writeFileSync(fpath, JSON.stringify(payload, null, 2), 'utf8'); } catch {}
      socket.emit('transcript:ready', { roomId: rid, file: fname, ok: true, transcriptText });
    } catch {
      socket.emit('transcript:ready', { roomId: joinedRoom, ok: false });
    }
  });

  // Retrieve a list of saved transcripts for a room
  socket.on('transcript:list', ({ roomId }) => {
    try {
      const files = fs.readdirSync(transcriptsDir).filter(f => f.startsWith(`${roomId}-`) && f.endsWith('.json'));
      files.sort();
      socket.emit('transcript:list', { roomId, files });
    } catch { socket.emit('transcript:list', { roomId, files: [] }); }
  });

  // Fetch a specific saved transcript file
  socket.on('transcript:get', ({ roomId, file }) => {
    try {
      if (!file || !file.startsWith(`${roomId}-`) || !file.endsWith('.json')) { socket.emit('transcript:get', { roomId, error: 'bad_file' }); return; }
      const fpath = path.join(transcriptsDir, file);
      const raw = fs.readFileSync(fpath, 'utf8');
      const data = JSON.parse(raw);
      socket.emit('transcript:get', { roomId, file, data });
    } catch { socket.emit('transcript:get', { roomId, file, error: 'not_found' }); }
  });

  socket.on('disconnect', () => {
    if (joinedRoom && user) {
      socket.to(joinedRoom).emit('presence:leave', user);
      try { const m = roomPresence.get(joinedRoom); if (m) m.delete(user.id); } catch {}
    }
    // Clean up any Deepgram connection for this socket
    try { if (dgConn && typeof dgConn.finish === 'function') { dgConn.finish(); } } catch {}
    dgConn = null;
  });
});

// Optional Mongo-backed login (graceful fallback if mongoose not installed or no MONGO_URI)
try {
  const mongoose = require('mongoose');
  const MONGO_URI = process.env.MONGO_URI;
  if (MONGO_URI) {
    mongoose.set('strictQuery', true);
    mongoose.connect(MONGO_URI, { dbName: process.env.MONGO_DB || 'metaverse' })
      .then(()=> console.log('MongoDB connected'))
      .catch(()=> console.warn('MongoDB connection failed; using in-memory auth'));
    const UserSchema = new mongoose.Schema({
      name: { type: String, required: true },
      specialization: { type: String, required: true },
      createdAt: { type: Date, default: Date.now }
    });
    const User = mongoose.models.User || mongoose.model('User', UserSchema);
    const SummarySchema = new mongoose.Schema({
      roomId: String,
      summary: [String],
      createdAt: { type: Date, default: Date.now }
    });
    const Summary = mongoose.models.Summary || mongoose.model('Summary', SummarySchema);
    app.post('/api/auth/login', async (req, res) => {
      try {
        const { name, specialization } = req.body || {};
        if (!name || !specialization) return res.status(400).json({ ok: false, error: 'Missing fields' });
        const doc = await User.findOneAndUpdate(
          { name },
          { $set: { name, specialization } },
          { upsert: true, new: true }
        );
        return res.json({ ok: true, user: { id: doc._id.toString(), name: doc.name, specialization: doc.specialization } });
      } catch (e) { return res.status(500).json({ ok: false, error: 'DB error' }); }
    });

    // AI summarization endpoint: gathers transcript (by roomId or provided text), filters by medical keywords,
    // calls OpenAI for a focused summary, returns lines, and stores to Mongo.
    app.post('/api/ai/summary', async (req, res) => {
      try {
        const { roomId, text } = req.body || {};
        let base = '';
        if (typeof text === 'string' && text.trim()) base = text.trim();
        else if (roomId) {
          const bag = roomTranscripts.get(roomId) || { segments: [] };
          const chat = roomChats.get(roomId) || { messages: [] };
          const voice = (bag.segments || []).map(s => `${s.name||'User'}: ${s.text}`);
          const msgs = (chat.messages || []).filter(m=> (m && typeof m.text === 'string' && m.text.trim())).map(m => `${m.name||'User'}: ${m.text}`);
          base = [...voice, ...msgs].join('\n');
        }
        base = (base || '').toString();
        if (!base.trim()) return res.json({ ok: true, summary: [] });
        const lines = base.split(/\n+/).filter(Boolean);
        const filtered = lines.filter(l => {
          const low = l.toLowerCase();
          return MED_KEYWORDS.some(k => low.includes(k));
        });
        const focusText = (filtered.length ? filtered.join('\n') : base).slice(0, 8000);
        const apiKey = process.env.OPENAI_API_KEY || '';
        if (!apiKey) return res.status(200).json({ ok: true, summary: [
          'Set OPENAI_API_KEY to enable AI summarization.',
          'Fallback: install a key and retry.'
        ]});
        const prompt = `Summarize the following meeting focusing on: drug effects, side effects, dosage, clinical trial outcomes, and suggestions. Write 5-8 concise bullet points.\n\nText:\n${focusText}`;
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 400
          })
        });
        if (!resp.ok) {
          // Fallback: local extractive summary so the UI never shows an error
          const txt = (filtered.length ? filtered.join(' ') : base);
          const sentences = txt.split(/(?<=[.!?])\s+/).slice(0, 40);
          const words = txt.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
          const stop = new Set(['the','and','a','an','to','of','in','is','it','that','for','on','with','as','are','was','be']);
          const freq = new Map(); for (const w of words) { if (!stop.has(w)) freq.set(w, (freq.get(w)||0)+1); }
          const scored = sentences.map(s=>({ s, score: s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean).reduce((sum,w)=>sum+(freq.get(w)||0),0) / Math.sqrt((s.split(/\s+/).length)||1) }));
          scored.sort((a,b)=>b.score-a.score);
          const items = scored.slice(0,6).map(x=>x.s.trim());
          return res.status(200).json({ ok: true, summary: items });
        }
        const js = await resp.json();
        const content = js?.choices?.[0]?.message?.content || '';
        const items = content.split(/\n+/).map(s=>s.replace(/^[-*\s]+/,'').trim()).filter(Boolean).slice(0, 10);
        try { if (roomId) await Summary.create({ roomId, summary: items }); } catch {}
        return res.json({ ok: true, summary: items });
      } catch (e) {
        // Fallback on any error: local extractive summary from base
        try {
          const txt = (filtered && filtered.length ? filtered.join(' ') : base);
          const sentences = txt.split(/(?<=[.!?])\s+/).slice(0, 40);
          const words = txt.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
          const stop = new Set(['the','and','a','an','to','of','in','is','it','that','for','on','with','as','are','was','be']);
          const freq = new Map(); for (const w of words) { if (!stop.has(w)) freq.set(w, (freq.get(w)||0)+1); }
          const scored = sentences.map(s=>({ s, score: s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean).reduce((sum,w)=>sum+(freq.get(w)||0),0) / Math.sqrt((s.split(/\s+/).length)||1) }));
          scored.sort((a,b)=>b.score-a.score);
          const items = scored.slice(0,6).map(x=>x.s.trim());
          return res.status(200).json({ ok: true, summary: items });
        } catch {
          return res.status(200).json({ ok: true, summary: [] });
        }
      }
    });
  } else {
    app.post('/api/auth/login', (req, res) => {
      const { name, specialization } = req.body || {};
      if (!name || !specialization) return res.status(400).json({ ok: false, error: 'Missing fields' });
      return res.json({ ok: true, user: { id: `mem_${Date.now()}`, name, specialization } });
    });

    app.post('/api/ai/summary', async (req, res) => {
      try {
        const { roomId, text } = req.body || {};
        let base = '';
        if (typeof text === 'string' && text.trim()) base = text.trim();
        else if (roomId) {
          const bag = roomTranscripts.get(roomId) || { segments: [] };
          const chat = roomChats.get(roomId) || { messages: [] };
          const voice = (bag.segments || []).map(s => `${s.name||'User'}: ${s.text}`);
          const msgs = (chat.messages || []).filter(m=> (m && typeof m.text === 'string' && m.text.trim())).map(m => `${m.name||'User'}: ${m.text}`);
          base = [...voice, ...msgs].join('\n');
        }
        base = (base || '').toString();
        if (!base.trim()) return res.json({ ok: true, summary: [] });
        const lines = base.split(/\n+/).filter(Boolean);
        const filtered = lines.filter(l => {
          const low = l.toLowerCase();
          return MED_KEYWORDS.some(k => low.includes(k));
        });
        // No OpenAI key available in memory-mode; return simple extractive summary
        const txt = (filtered.length ? filtered.join(' ') : base);
        const sentences = txt.split(/(?<=[.!?])\s+/).slice(0, 40);
        const words = txt.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
        const stop = new Set(['the','and','a','an','to','of','in','is','it','that','for','on','with','as','are','was','be']);
        const freq = new Map(); for (const w of words) { if (!stop.has(w)) freq.set(w, (freq.get(w)||0)+1); }
        const scored = sentences.map(s=>({ s, score: s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean).reduce((sum,w)=>sum+(freq.get(w)||0),0) / Math.sqrt((s.split(/\s+/).length)||1) }));
        scored.sort((a,b)=>b.score-a.score);
        const items = scored.slice(0,6).map(x=>x.s.trim());
        return res.json({ ok: true, summary: items });
      } catch { return res.json({ ok: true, summary: [] }); }
    });
  }
} catch {
  app.post('/api/auth/login', (req, res) => {
    const { name, specialization } = req.body || {};
    if (!name || !specialization) return res.status(400).json({ ok: false, error: 'Missing fields' });
    return res.json({ ok: true, user: { id: `mem_${Date.now()}`, name, specialization } });
  });
}

server.listen(PORT, () => {
  console.log(`socket.io server listening on http://localhost:${PORT}`);
});
 
