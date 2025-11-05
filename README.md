# Metaverse Collaboration Platform

A Metaverse-style browser workspace with:

- Immersive 3D virtual environments (Three.js/WebXR)
- Real-time voice and video chat (WebRTC)
- Shared whiteboard and document editing (CRDT/Yjs)
- AI meeting summaries and action items
- Custom avatars and motion tracking (progressive enhancement)

## Tech Study

See the full architecture and stack study:

- docs/tech-study.md

## Stack (High-Level)

- Frontend: React + Vite + TypeScript, Tailwind CSS, Three.js, WebXR
- Realtime: WebRTC + Socket.io (signaling and app events)
- Backend: Node.js (Express/Fastify), optional SFU (mediasoup/Janus)
- Storage: MongoDB (rooms, users, timelines, docs, assets)
- Collaboration: Yjs for CRDT-based whiteboard and rich text
- AI: Transcription (Whisper/Web Speech), LLM summarization

## Getting Started

1. Install deps: `npm install`
2. Start dev server: `npm run dev`
3. Open the app at the printed local URL

Tailwind is configured; base styles and UI helpers are in `src/index.css`.
