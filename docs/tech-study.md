## Metaverse-Style 3D Collaboration Platform — Technical Study

### Vision
Create a browser-based 3D workspace where participants meet as avatars to collaborate on shared content (whiteboards, documents, 3D assets) with real-time voice/video, spatial presence, and optional VR via WebXR.

### Core Stack
- Frontend: React + Vite + TypeScript, Tailwind CSS, Three.js, WebXR
- Realtime: WebRTC (voice/video/data channels), Socket.io (signaling + app events)
- Backend: Node.js (Express/Fastify) + Socket.io server + optional SFU/MCU (e.g., mediasoup/Janus) for multi-party calls
- Persistence: MongoDB (Mongoose) for rooms, users, sessions, assets, and snapshots
- Collaboration: CRDT (Yjs) for shared whiteboard/document editing over WebRTC/Socket.io
- AI: Meeting transcription (Web Speech API client-side or server-side via Whisper), summarization (OpenAI/LLM), action item extraction
- GPU backend: Node cluster for heavy tasks; headless WebGL (via headless-gl) or GPU-enabled workers/K8s nodes

### High-Level Architecture
1. Client initializes: loads scene, connects to signaling (Socket.io), joins a room.
2. Signaling negotiates WebRTC peer connections (or to an SFU) for A/V and datachannels.
3. Three.js scene renders environment + avatars. WebXR activates on capable devices.
4. CRDT documents (Yjs) sync over datachannels/Socket.io for whiteboard/docs.
5. Backend brokers presence, room state, permissions, and persists snapshots to MongoDB.
6. AI pipeline ingests meeting audio/transcripts; generates summaries and tasks stored back to room timeline.

### Frontend Modules
- Scene and Rendering
  - Three.js renderer, scene graph, PBR materials; XRManager to toggle WebXR sessions
  - AvatarSystem: local avatar controller (inputs, IK stubs), remote avatar replication via sockets
  - AssetLoader: GLTF/DRACO loaders; environment map; light probes
- Realtime Comms
  - RTCManager: device selection, media constraints, screen share, spatial audio panning
  - SignalingClient: Socket.io wrapper for offers/answers/candidates
  - DataChannel: reliable/unreliable channels for low-latency interactions (pointers, cursors)
- Collaboration
  - Yjs providers for whiteboard/document states
  - Whiteboard canvas (pointer trails, shapes, images) with CRDT ops
  - Rich-text editor (TipTap/ProseMirror) bound to Yjs document
- UI/UX
  - Layout: panel docking, command palette, room roster, chat, settings
  - Theming: Tailwind + dark mode; accessible focus + keyboard nav

### Backend Services
- API Gateway (Express/Fastify)
  - REST endpoints: auth, rooms, assets, transcripts, summaries
  - WebSocket endpoint: Socket.io namespace per room
- Signaling Service
  - Join/leave, presence, permission checks
  - WebRTC negotiation; optional SFU integration (mediasoup/LiveKit)
- Collaboration Service
  - Persistence layer for CRDT snapshots and room timelines
- AI Service
  - Transcription (streaming or batch) and summarization; enqueue work to a job queue (BullMQ)
- GPU/Rendering Workers
  - Optional: thumbnail generation, server-side baking, physics sim; route via message queue

### Data Model (MongoDB)
- users: { _id, name, avatarUrl, roles, devices }
- rooms: { _id, name, settings, createdBy, participants: [userId], sceneConfig }
- sessions: { _id, roomId, userId, joinedAt, leftAt, mediaState }
- timelines: { _id, roomId, type, payload, createdAt } // messages, summaries, actions
- docs: { _id, roomId, type: whiteboard|richtext, snapshotRef, version }
- assets: { _id, roomId, url, kind: gltf|image|doc|video, meta }

### Realtime Topology
- Small rooms (<= 6): Mesh peer-to-peer via WebRTC + Socket.io signaling. Datachannels used for cursors, whiteboard ops.
- Larger rooms: SFU offload for media; app data via Socket.io rooms. CRDT remains efficient due to partial updates.
- Network resilience: renegotiation, ICE restarts, TURN fallback.

### WebXR and Input
- Enter/exit XR sessions; support hand controllers and basic interactions
- Teleport/locomotion; comfort settings
- Motion capture hooks (MediaPipe/MoveNet) for head/hands driving avatar bones (progressive enhancement)

### Security and Privacy
- Auth: JWT/OAuth; room-level roles (owner, presenter, editor, viewer)
- Permissions: media publish/subscribe control, recording consent gates
- E2E: SRTP for media; HTTPS/WSS; content redaction for AI

### Performance Tactics
- Three.js: frustum culling, LODs, instancing, compressed textures (KTX2/ASTC), DRACO meshes
- WebRTC: simulcast/SVC, bitrate caps, device target FPS; audio only for low bandwidth
- UI: virtualized lists, code-splitting, Suspense
- Persistence: snapshot + delta log; cold storage for recordings

### AI Summarization Flow
1. Capture meeting audio; either client streams to server or record server-side via SFU.
2. Transcribe (e.g., Whisper); detect speakers if possible.
3. Summarize with LLM; produce bullets, action items, decisions.
4. Store to `timelines` and surface in room recap panel.

### Minimal Milestones
1. Room join + presence + chat
2. P2P WebRTC A/V with Socket.io signaling
3. Three.js scene with avatars; nameplates + spatial audio
4. Whiteboard (Yjs) + rich-text doc sync
5. WebXR opt-in; controller pointer
6. AI: upload recording → transcript → summary in timeline
7. SFU scaling path; permissions; recordings

### Open Questions
- Do we require SFU from v1 or enable when > N participants?
- Are summaries on-device (edge) or centralized for cost control?
- Asset storage: S3-compatible? CDN strategy?

### Dev Environment Notes
- Use Vite + React + Tailwind. `npm run dev`.
- Feature gates for XR, SFU, AI to keep fast iteration.


