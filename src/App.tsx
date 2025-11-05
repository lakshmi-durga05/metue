import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { io, Socket } from "socket.io-client";

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const xrBtnRef = useRef<HTMLDivElement | null>(null);
  const [xrSupported, setXrSupported] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [camEnabled, setCamEnabled] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const userIdRef = useRef<string>(`u_${Math.random().toString(36).slice(2, 10)}`);
  const [displayName, setDisplayName] = useState<string>(`Guest-${Math.floor(Math.random()*1000)}`);
  const [roomCodeInput, setRoomCodeInput] = useState<string>("");
  const nameRef = useRef<string>("");
  const remoteAvatarsRef = useRef<Record<string, THREE.Object3D>>({});
  const sceneRef = useRef<THREE.Scene | null>(null);
  const remoteGroupRef = useRef<THREE.Group | null>(null);
  const [roster, setRoster] = useState<Array<{ id: string; name: string; avatar?: { kind: 'color' | 'image'; value: string } }>>([]);
  const remoteCursorsRef = useRef<Record<string, THREE.Mesh>>({});
  const xrStatusRef = useRef<string>("Checking XR...");
  const peerConnsRef = useRef<Record<string, RTCPeerConnection>>({});
  const remoteStreamsRef = useRef<Record<string, MediaStream>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const remoteAudioRef = useRef<Record<string, { source: MediaStreamAudioSourceNode; panner: PannerNode }>>({});
  const [, forceRerender] = useState(0);
  const [authOpen, setAuthOpen] = useState<boolean>(false);
  const [authedUser, setAuthedUser] = useState<{ id: string; name: string; email: string; avatar: { kind: 'color' | 'image'; value: string } } | null>(null);
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authName, setAuthName] = useState<string>("");
  const [avatarColor, setAvatarColor] = useState<string>("#4f46e5");
  const [sessionReady, setSessionReady] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<'login'|'signup'>('login');
  const avatarGallery: string[] = [
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="%234f46e5"/><circle cx="64" cy="52" r="28" fill="%23fff"/><rect x="24" y="84" width="80" height="28" rx="14" fill="%23fff"/></svg>',
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="%2310b981"/><circle cx="64" cy="50" r="26" fill="%23fef3c7"/><rect x="20" y="82" width="88" height="30" rx="15" fill="%23fef3c7"/></svg>',
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="%23f97316"/><circle cx="64" cy="50" r="26" fill="%23fff"/><rect x="20" y="82" width="88" height="30" rx="15" fill="%23fff"/></svg>'
  ];
  const [avatarImage, setAvatarImage] = useState<string>(avatarGallery[0]);
  const modelCacheRef = useRef<Record<string, { scene: THREE.Group; clips: THREE.AnimationClip[] }>>({});
  const localAvatarRef = useRef<THREE.Object3D | null>(null);
  const localMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const remoteMixersRef = useRef<Record<string, THREE.AnimationMixer>>({});
  const localActionsRef = useRef<{ idle?: THREE.AnimationAction; walk?: THREE.AnimationAction; current?: 'idle'|'walk' }>({});
  const keysRef = useRef<Record<string, boolean>>({});
  const lastEmitRef = useRef<number>(0);
  const moveTargetRef = useRef<THREE.Vector3 | null>(null);
  const micMonitorRef = useRef<{ source: MediaStreamAudioSourceNode; gain: GainNode } | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [summaries, setSummaries] = useState<string[]>([]);
  const [chatOpen, setChatOpen] = useState<boolean>(true);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatLog, setChatLog] = useState<Array<{userId:string; name:string; text:string; ts:number}>>([]);
  const [meetingEnded, setMeetingEnded] = useState<boolean>(false);
  const [medMode, setMedMode] = useState<boolean>(false);
  const chatSeenRef = useRef<Set<string>>(new Set());
  const chatListRef = useRef<HTMLDivElement | null>(null);
  // Whiteboard state
  const [wbOpen, setWbOpen] = useState<boolean>(false);
  const wbCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [wbColor, setWbColor] = useState<string>("#1f2937");
  const [wbSize, setWbSize] = useState<number>(4);
  const wbDrawingRef = useRef<boolean>(false);
  const wbPointsRef = useRef<Array<[number, number]>>([]);
  const wbCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const wbToolRef = useRef<'pencil'|'brush'|'marker'|'eraser'|'airbrush'|'fill'>('pencil');
  const wbLastEmitRef = useRef<number>(0);
  const modelUrls = [
    'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/CesiumMan/glTF-Binary/CesiumMan.glb',
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb'
  ];

  const modelUrlForAvatar = (val: string) => {
    const idx = Math.max(0, avatarGallery.indexOf(val));
    return modelUrls[idx % modelUrls.length];
  };

  const loadModel = async (url: string): Promise<{ group: THREE.Group; clips: THREE.AnimationClip[] }> => {
    if (modelCacheRef.current[url]) {
      const cached = modelCacheRef.current[url];
      return { group: cached.scene.clone(true) as THREE.Group, clips: cached.clips };
    }
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const gltf = await new Promise<any>((resolve, reject) => loader.load(url, resolve, undefined, reject));
      const scene: THREE.Group = gltf.scene || new THREE.Group();
      const clips: THREE.AnimationClip[] = gltf.animations || [];
      modelCacheRef.current[url] = { scene, clips };
      return { group: scene.clone(true) as THREE.Group, clips };
    } catch (e) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.9, 6, 12), new THREE.MeshStandardMaterial({ color: 0x22c55e }));
      body.castShadow = true;
      g.add(body);
      return { group: g, clips: [] };
    }
  };

  const lastPoseRef = useRef<Record<string, { p: [number, number, number]; r: [number, number, number] }>>({});

  useEffect(() => {
    const saved = localStorage.getItem('authUser');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setAuthedUser(parsed);
        setDisplayName(parsed.name || displayName);
      } catch {}
    }
    const session = sessionStorage.getItem('sessionAuthed');
    setSessionReady(session === '1');
    if (session !== '1') setAuthOpen(true);
    const lastRoom = sessionStorage.getItem('lastRoomId');
    if (lastRoom) {
      setRoomCodeInput(lastRoom);
      setRoomId(lastRoom);
    }
    const wasJoined = sessionStorage.getItem('joined') === '1';
    if (wasJoined) setJoined(true);
    if (!mountRef.current) return;

    const container = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f4f6);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(3, 2, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);
    // expose renderer for potential debug
    (renderer.domElement as any).__threeRenderer = renderer;

    // Skip adding VRButton; we run in non-XR by default and optionally show status only

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 7);
    dir.castShadow = true;
    scene.add(dir);

    // Simple virtual room: floor + walls
    const room = new THREE.Group();
    scene.add(room);
    const floorGeo = new THREE.PlaneGeometry(12, 12);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    room.add(floor);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5 });
    const wallGeo = new THREE.PlaneGeometry(12, 3);
    const wall1 = new THREE.Mesh(wallGeo, wallMat);
    wall1.position.set(0, 1.5, -6);
    room.add(wall1);
    const wall2 = new THREE.Mesh(wallGeo, wallMat);
    wall2.position.set(0, 1.5, 6);
    wall2.rotation.y = Math.PI;
    room.add(wall2);
    const wall3 = new THREE.Mesh(wallGeo, wallMat);
    wall3.position.set(-6, 1.5, 0);
    wall3.rotation.y = Math.PI / 2;
    room.add(wall3);
    const wall4 = new THREE.Mesh(wallGeo, wallMat);
    wall4.position.set(6, 1.5, 0);
    wall4.rotation.y = -Math.PI / 2;
    room.add(wall4);

    // Ground + Grid
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(50, 50, 0x94a3b8, 0xe2e8f0); // slate-400 / slate-200
    scene.add(grid);

    // Demo content: spinning box avatar placeholder
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x4f46e5 }) // indigo-600
    );
    box.position.set(0, 0.5, 0);
    box.castShadow = true;
    box.name = 'placeholderBox';
    scene.add(box);

    // Group to hold remote avatars
    const remoteGroup = new THREE.Group();
    scene.add(remoteGroup);
    remoteGroupRef.current = remoteGroup;

    // Orbit controls for non-XR
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.enableDamping = true;

    let rafId = 0;
    const onKey = (e: KeyboardEvent) => {
      const k = (e?.key || '').toLowerCase();
      if (!k) return;
      // Do not capture movement keys when typing in form fields
      const target = e.target as HTMLElement | null;
      const isEditable = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        (target as HTMLElement).isContentEditable ||
        (typeof (target as any).closest === 'function' && !!(target as any).closest('input, textarea, [contenteditable="true"], [contenteditable]'))
      );
      if (isEditable) return;
      const down = e.type === 'keydown';
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) {
        keysRef.current[k] = down;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", onResize);

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = clock.getDelta();
      if (localMixerRef.current) localMixerRef.current.update(dt);
      Object.values(remoteMixersRef.current).forEach((m) => m.update(dt));
      // Local avatar movement (WASD)
      const av = localAvatarRef.current;
      if (av) {
        let vx = 0, vz = 0;
        const k = keysRef.current;
        if (k['w'] || k['arrowup']) vz -= 1;
        if (k['s'] || k['arrowdown']) vz += 1;
        if (k['a'] || k['arrowleft']) vx -= 1;
        if (k['d'] || k['arrowright']) vx += 1;
        // Click-to-move: steer toward target
        if (moveTargetRef.current) {
          const dx = moveTargetRef.current.x - av.position.x;
          const dz = moveTargetRef.current.z - av.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.02) { vx += dx / dist; vz += dz / dist; } else { moveTargetRef.current = null; }
        }
        if (vx !== 0 || vz !== 0) {
          const len = Math.hypot(vx, vz) || 1;
          vx /= len; vz /= len;
          const speed = 1.5; // m/s
          av.position.x += vx * speed * dt;
          av.position.z += vz * speed * dt;
          // animation blend
          const acts = localActionsRef.current;
          if (acts.walk && acts.current !== 'walk') {
            acts.idle?.crossFadeTo(acts.walk, 0.25, false);
            acts.walk.play();
            acts.current = 'walk';
          }
        } else {
          const acts = localActionsRef.current;
          if (acts.idle && acts.current !== 'idle') {
            acts.walk?.crossFadeTo(acts.idle, 0.25, false);
            acts.idle.play();
            acts.current = 'idle';
          }
        }
        // emit pose at 10 Hz
        const now = performance.now();
        if (socketRef.current && now - lastEmitRef.current > 100) {
          lastEmitRef.current = now;
          const r = new THREE.Euler().copy(av.rotation);
          const p: [number, number, number] = [av.position.x, av.position.y, av.position.z];
          const rot: [number, number, number] = [r.x, r.y, r.z];
          socketRef.current.emit('avatar:pose', { userId: userIdRef.current, p, r: rot });
        }
      }
      controls.update();
      renderer.render(scene, camera);
    });

    // Socket listeners are now attached in the room socket effect

    // Detect XR support with retries (helps when emulator extension initializes late)
    let checks = 0;
    const checkXr = () => {
      if ((navigator as any).xr?.isSessionSupported) {
        (navigator as any).xr
          .isSessionSupported("immersive-vr")
          .then((supported: boolean) => setXrSupported(supported))
          .catch(() => setXrSupported(false));
      }
      if (checks++ < 10) setTimeout(checkXr, 1000);
    };
    checkXr();
    xrStatusRef.current = 'XR check running';

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      renderer.setAnimationLoop(null as never);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  // Ensure a 3D avatar is loaded for the local user by default
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (localAvatarRef.current) return;
    const selected = authedUser?.avatar?.value || avatarImage;
    const url = modelUrlForAvatar(selected);
    (async () => {
      const { group: obj, clips } = await loadModel(url);
      obj.traverse((o) => { (o as any).castShadow = true; });
      scene.add(obj);
      localAvatarRef.current = obj;
      if (clips && clips.length) {
        localMixerRef.current = new THREE.AnimationMixer(obj);
        const idle = clips[0];
        const walk = clips[1];
        const idleAct = localMixerRef.current.clipAction(idle);
        idleAct.play();
        const walkAct = walk ? localMixerRef.current.clipAction(walk) : undefined;
        localActionsRef.current = { idle: idleAct, walk: walkAct, current: 'idle' };
      }
      const placeholder = scene.getObjectByName('placeholderBox');
      if (placeholder) placeholder.visible = false;
    })();
  }, [authedUser, avatarImage]);

  // Socket.io: join room and sync avatar pose
  useEffect(() => {
    if (!roomId || !joined) return;
    const socket = io("http://localhost:3001", { transports: ["websocket"], withCredentials: false });
    socketRef.current = socket;
    // Per-tab tag to avoid identical visible names across tabs
    let tabTag = sessionStorage.getItem('tabTag');
    if (!tabTag) { tabTag = Math.random().toString(36).slice(2,5); sessionStorage.setItem('tabTag', tabTag); }
    const baseName = nameRef.current || displayName;
    const nameToUse = `${baseName}-${tabTag}`;
    const avatar = authedUser?.avatar || { kind: 'image', value: avatarGallery[0] };
    socket.emit("room:join", { roomId, userId: userIdRef.current, name: nameToUse, avatar });
    // Ensure new joiners sync the current whiteboard state immediately
    socket.emit('whiteboard:requestState');

    socket.on("presence:roster", (members: Array<{ id: string; name: string; avatar?: { kind: 'color' | 'image'; value: string } }>) => {
      setRoster(members);
      members.forEach((m: { id: string; name: string }) => maybeStartPeer(m.id));
    });
    socket.on("presence:join", (user: any) => {
      setRoster((prev: Array<{ id: string; name: string; avatar?: { kind: 'color' | 'image'; value: string } }>) => {
        const exists = prev.some((m: { id: string; name: string }) => m.id === user.id);
        return exists ? prev : [...prev, user];
      });
      maybeStartPeer(user.id);
    });
    socket.on("presence:update", (user: { id: string; name: string; avatar?: { kind: 'color' | 'image'; value: string } }) => {
      setRoster((prev: Array<{ id: string; name: string; avatar?: { kind: 'color' | 'image'; value: string } }>) =>
        prev.map((m) => (m.id === user.id ? { ...m, avatar: user.avatar, name: user.name } : m))
      );
      if (user.id === userIdRef.current) {
        // Update own profile but do not create a remote avatar for self
        setAuthedUser((prevU) => (prevU ? { ...prevU, avatar: user.avatar || prevU.avatar } : prevU));
        // If an accidental remote avatar for self exists, remove it
        const selfRemote = remoteAvatarsRef.current[user.id];
        if (selfRemote && selfRemote.parent) selfRemote.parent.remove(selfRemote);
        delete remoteAvatarsRef.current[user.id];
        if (remoteMixersRef.current[user.id]) delete remoteMixersRef.current[user.id];
        return;
      }
      const group = remoteGroupRef.current;
      const scene = sceneRef.current;
      if (!group || !scene) return;
      const existing = remoteAvatarsRef.current[user.id];
      if (existing && existing.parent) existing.parent.remove(existing);
      delete remoteAvatarsRef.current[user.id];
      if (remoteMixersRef.current[user.id]) delete remoteMixersRef.current[user.id];
      const url = user?.avatar?.kind === 'image' ? modelUrlForAvatar(user.avatar.value) : modelUrls[0];
      (async () => {
        const { group: obj, clips } = await loadModel(url);
        obj.traverse((o) => { (o as any).castShadow = true; });
        remoteAvatarsRef.current[user.id] = obj;
        group.add(obj);
        if (clips && clips.length) {
          const mixer = new THREE.AnimationMixer(obj);
          remoteMixersRef.current[user.id] = mixer;
          const idle = clips[0];
          mixer.clipAction(idle).play();
        }
        const last = lastPoseRef.current[user.id];
        if (last) {
          obj.position.set(last.p[0], last.p[1], last.p[2]);
          obj.rotation.set(last.r[0], last.r[1], last.r[2]);
        }
      })();
    });
    socket.on("presence:leave", (user: any) => {
      const mesh = remoteAvatarsRef.current[user.id];
      if (mesh && mesh.parent) mesh.parent.remove(mesh);
      delete remoteAvatarsRef.current[user.id];
      setRoster((prev: Array<{ id: string; name: string }>) => prev.filter((m: { id: string; name: string }) => m.id !== user.id));
      teardownPeer(user.id);
    });

    // handle remote avatar poses
    socket.on("avatar:pose", (data: { userId: string; p: [number, number, number]; r: [number, number, number]; }) => {
      if (data.userId === userIdRef.current) return; // never render self as remote
      const scene = sceneRef.current;
      const group = remoteGroupRef.current;
      if (!scene || !group) return;
      const { userId, p, r } = data;
      let mesh = remoteAvatarsRef.current[userId];
      if (!mesh) {
        const member = roster.find((m) => m.id === userId);
        const url = member?.avatar?.kind === 'image' ? modelUrlForAvatar(member.avatar.value) : modelUrls[0];
        (async () => {
          const { group: obj, clips } = await loadModel(url);
          obj.traverse((o) => { (o as any).castShadow = true; });
          remoteAvatarsRef.current[userId] = obj;
          group.add(obj);
          if (clips && clips.length) {
            const mixer = new THREE.AnimationMixer(obj);
            remoteMixersRef.current[userId] = mixer;
            mixer.clipAction(clips[0]).play();
          }
          obj.position.set(p[0], p[1], p[2]);
          obj.rotation.set(r[0], r[1], r[2]);
        })();
        return;
      }
      mesh.position.set(p[0], p[1], p[2]);
      mesh.rotation.set(r[0], r[1], r[2]);
      lastPoseRef.current[userId] = { p, r };
      const audio = remoteAudioRef.current[userId];
      if (audio) audio.panner.positionX.value = p[0], audio.panner.positionY.value = p[1], audio.panner.positionZ.value = p[2];
    });

    // remote cursor positions
    socket.on("cursor:pos", (data: { userId: string; p: [number, number, number]; }) => {
      const scene = sceneRef.current;
      if (!scene) return;
      let cursor = remoteCursorsRef.current[data.userId];
      if (!cursor) {
        cursor = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 16, 16),
          new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 0.5 })
        );
        remoteCursorsRef.current[data.userId] = cursor;
        scene.add(cursor);
      }
      cursor.position.set(data.p[0], data.p[1], data.p[2]);
    });

    // Whiteboard + Chat listeners (registered after connection)
    socket.on('whiteboard:stroke', (s: { color: string; size: number; points: Array<[number,number]>; tool?: string }) => {
      drawStrokeOnCanvas(s);
    });
    socket.on('whiteboard:clear', () => {
      clearWhiteboardCanvas();
    });
    socket.on('whiteboard:fill', (act: { x:number; y:number; color:string }) => {
      floodFillAt(Math.floor(act.x), Math.floor(act.y), act.color);
    });
    socket.on('whiteboard:state', (state: { actions: Array<any> } ) => {
      clearWhiteboardCanvas();
      for (const act of state.actions || []) {
        if (act.type === 'stroke') drawStrokeOnCanvas(act);
        if (act.type === 'fill') floodFillAt(Math.floor(act.x), Math.floor(act.y), act.color);
      }
    });
    socket.on('chat:message', (msg: {userId:string; name:string; text:string; ts:number; cid?: string}) => {
      if (msg.cid) {
        if (chatSeenRef.current.has(msg.cid)) return;
        chatSeenRef.current.add(msg.cid);
      }
      setChatLog((prev) => [...prev, msg]);
    });

    const interval = setInterval(() => {
      if (!localAvatarRef.current) return;
      const p: [number, number, number] = [localAvatarRef.current.position.x, localAvatarRef.current.position.y, localAvatarRef.current.position.z];
      const r: [number, number, number] = [localAvatarRef.current.rotation.x, localAvatarRef.current.rotation.y, localAvatarRef.current.rotation.z];
      socket.emit('avatar:pose', { userId: userIdRef.current, p, r });
    }, 100);

    socket.on("webrtc:signal", async ({ from, data }: any) => {
      if (!from || from === userIdRef.current) return;
      const pc = await ensurePeer(from);
      try {
        if (data?.type === "offer") {
          const offerCollision = pc.signalingState !== "stable";
          const polite = userIdRef.current > from; // deterministic tie-breaker
          if (offerCollision) {
            if (!polite) return; // ignore non-polite collisions
            await pc.setLocalDescription({ type: "rollback" } as any);
          }
          await pc.setRemoteDescription(new RTCSessionDescription(data));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("webrtc:signal", { to: from, from: userIdRef.current, data: pc.localDescription });
        } else if (data?.type === "answer") {
          if (pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
          }
        } else if (data?.candidate) {
          try { await pc.addIceCandidate(new RTCIceCandidate(data)); } catch {}
        }
      } catch {}
    });

    return () => {
      clearInterval(interval);
      socketRef.current?.off('whiteboard:stroke');
      socketRef.current?.off('whiteboard:clear');
      socketRef.current?.off('whiteboard:state');
      socketRef.current?.off('whiteboard:fill');
      socketRef.current?.off('chat:message');
      socketRef.current?.disconnect();
    };
  }, [roomId, joined, authedUser]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    const el = chatListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatLog, chatOpen]);

  const nameForUserId = (uid: string): string => {
    if (uid === userIdRef.current) return authedUser?.name || displayName;
    const m = roster.find(r => r.id === uid);
    return m?.name || 'Guest';
  };

  const avatarForUserId = (uid: string): string => {
    if (uid === userIdRef.current) return authedUser?.avatar?.value || avatarGallery[0];
    const m = roster.find(r => r.id === uid);
    return m?.avatar?.value || avatarGallery[0];
  };

  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Simple speech recognition, deferred until End Meeting now (disabled during meeting)
  useEffect(() => {
    let recognition: any = null;
    let stopRequested = false;
    const SpeechRecognition: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (!meetingEnded) return; // run only after meeting ends
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    let buffer = '';
    recognition.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) buffer += res[0].transcript + ' ';
        else interim += res[0].transcript;
      }
      setTranscript((buffer + ' ' + interim).trim());
    };
    recognition.onend = () => {
      if (!stopRequested) recognition.start();
    };
    try { recognition.start(); } catch {}
    const summarizer = setInterval(() => {
      if (!buffer) return;
      const text = buffer.trim();
      const words = text.split(/\s+/);
      const last = words.slice(-40).join(' ');
      const summary = last.length > 0 ? `Recent: ${last}` : '';
      if (summary) setSummaries((prev) => [...prev, summary].slice(-20));
      buffer = '';
    }, 10000);
    return () => {
      stopRequested = true;
      clearInterval(summarizer);
      try { recognition.stop(); } catch {}
    };
  }, [meetingEnded]);

  // Render remote avatars in the scene
  useEffect(() => {
    // This effect taps into the three scene by creating/looking up a marker object attached to mountRef
    if (!mountRef.current) return;
    const container = mountRef.current;
    const canvas = container.querySelector('canvas');
    if (!canvas) return;

    // @ts-ignore - retrieve renderer from canvas
    const renderer: THREE.WebGLRenderer | undefined = (canvas as any).__threeRenderer;
    // We didn't store it earlier, so we attach a hidden property when creating it. Let's ensure we do that in init.
  }, []);

  const maybeStartPeer = async (peerId: string) => {
    if (peerConnsRef.current[peerId]) return;
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] }
      ]
    });
    peerConnsRef.current[peerId] = pc;
    pc.onicecandidate = (e: RTCPeerConnectionIceEvent) => {
      if (!e.candidate) return;
      socketRef.current?.emit("webrtc:signal", { to: peerId, from: userIdRef.current, data: e.candidate });
    };
    pc.ontrack = (e: RTCTrackEvent) => {
      if (!e.streams[0]) return;
      remoteStreamsRef.current[peerId] = e.streams[0];
      forceRerender((prev: number) => prev + 1);
    };
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => pc.addTrack(track, mediaStreamRef.current as MediaStream));
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit("webrtc:signal", { to: peerId, from: userIdRef.current, data: pc.localDescription });
  };

  const teardownPeer = (peerId: string) => {
    const pc = peerConnsRef.current[peerId];
    if (!pc) return;
    pc.close();
    delete peerConnsRef.current[peerId];
    delete remoteStreamsRef.current[peerId];
    forceRerender((prev: number) => prev + 1);
  };

  const ensurePeer = async (peerId: string) => {
    if (peerConnsRef.current[peerId]) return peerConnsRef.current[peerId];
    await maybeStartPeer(peerId);
    return peerConnsRef.current[peerId];
  };

  // Media helpers used by Settings toggles
  const ensureMediaIfNeeded = async () => {
    if (mediaStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      mediaStreamRef.current = stream;
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      // Local mic monitor (echo to user when mic enabled)
      if (audioCtxRef.current && stream.getAudioTracks()[0]) {
        const src = audioCtxRef.current.createMediaStreamSource(stream);
        const gain = audioCtxRef.current.createGain();
        gain.gain.value = 0.0; // start muted until toggled on
        src.connect(gain).connect(audioCtxRef.current.destination);
        micMonitorRef.current = { source: src, gain };
      }
    } catch (e) {
      setErrorMsg('Failed to access media devices');
    }
  };

  const replaceAudioTrackForAll = async (track: MediaStreamTrack | null) => {
    const conns = peerConnsRef.current;
    for (const pid of Object.keys(conns)) {
      const pc = conns[pid];
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
      if (sender) {
        try { await sender.replaceTrack(track as any); } catch {}
      }
    }
  };

  const replaceVideoTrackForAll = async (track: MediaStreamTrack | null) => {
    const conns = peerConnsRef.current;
    for (const pid of Object.keys(conns)) {
      const pc = conns[pid];
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) {
        try { await sender.replaceTrack(track as any); } catch {}
      }
    }
  };

  // Whiteboard functions (component scope)
  const setupWhiteboardCanvas = () => {
    const canvas = wbCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    wbCtxRef.current = ctx;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
  };

  const clearWhiteboardCanvas = () => {
    const canvas = wbCanvasRef.current;
    if (!canvas) return;
    const ctx = wbCtxRef.current || canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
  };

  const drawStrokeOnCanvas = (s: { color: string; size: number; points: Array<[number, number]>; tool?: string; }) => {
    const canvas = wbCanvasRef.current;
    if (!canvas) return;
    const ctx = wbCtxRef.current || canvas.getContext('2d');
    if (!ctx || s.points.length === 0) return;
    const tool = s.tool || 'pencil';
    if (tool === 'airbrush') {
      const density = 12;
      ctx.fillStyle = s.color;
      for (const [x,y] of s.points) {
        for (let i=0;i<density;i++) {
          const r = s.size * (Math.random()*0.5);
          const ang = Math.random()*Math.PI*2;
          ctx.globalAlpha = 0.15;
          ctx.beginPath();
          ctx.arc(x + Math.cos(ang)*r, y + Math.sin(ang)*r, 1.2, 0, Math.PI*2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1.0;
      return;
    }
    const color = tool==='eraser' ? '#ffffff' : s.color;
    ctx.strokeStyle = color;
    ctx.lineWidth = tool==='brush' || tool==='marker' ? Math.max(6, s.size) : s.size;
    ctx.beginPath();
    const [x0, y0] = s.points[0];
    ctx.moveTo(x0, y0);
    for (let i = 1; i < s.points.length; i++) {
      const [x, y] = s.points[i];
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  const pointerToCanvasXY = (canvas: HTMLCanvasElement, clientX: number, clientY: number): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    return [x, y];
  };

  const handleWbPointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = wbCanvasRef.current; if (!canvas) return;
    if (wbToolRef.current === 'fill') {
      const [x,y] = pointerToCanvasXY(canvas, e.clientX, e.clientY);
      floodFillAt(Math.floor(x), Math.floor(y), wbColor);
      socketRef.current?.emit('whiteboard:fill', { color: wbColor, x: Math.floor(x), y: Math.floor(y) });
      return;
    }
    wbDrawingRef.current = true; wbPointsRef.current = [];
    const [x, y] = pointerToCanvasXY(canvas, e.clientX, e.clientY);
    wbPointsRef.current.push([x, y]);
  };
  const handleWbPointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!wbDrawingRef.current) return;
    const canvas = wbCanvasRef.current; if (!canvas) return;
    const [x, y] = pointerToCanvasXY(canvas, e.clientX, e.clientY);
    const last = wbPointsRef.current[wbPointsRef.current.length - 1];
    wbPointsRef.current.push([x, y]);
    const seg = { color: wbColor, size: wbSize, points: [last, [x, y]] as any, tool: wbToolRef.current };
    drawStrokeOnCanvas(seg);
    const now = performance.now();
    if (now - wbLastEmitRef.current > 30) {
      wbLastEmitRef.current = now;
      socketRef.current?.emit('whiteboard:stroke', seg);
    }
  };
  const handleWbPointerUp = () => {
    if (!wbDrawingRef.current) return;
    wbDrawingRef.current = false;
    const pts = wbPointsRef.current.slice();
    wbPointsRef.current = [];
    if (pts.length <= 2 && pts.length > 0) {
      socketRef.current?.emit('whiteboard:stroke', { color: wbColor, size: wbSize, points: pts, tool: wbToolRef.current });
    }
  };
  const handleWbTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const t = e.touches[0]; if (!t) return; e.preventDefault();
    const canvas = wbCanvasRef.current; if (!canvas) return;
    if (wbToolRef.current === 'fill') {
      const [x,y] = pointerToCanvasXY(canvas, t.clientX, t.clientY);
      floodFillAt(Math.floor(x), Math.floor(y), wbColor);
      socketRef.current?.emit('whiteboard:fill', { color: wbColor, x: Math.floor(x), y: Math.floor(y) });
      return;
    }
    wbDrawingRef.current = true; wbPointsRef.current = [];
    const [x, y] = pointerToCanvasXY(canvas, t.clientX, t.clientY);
    wbPointsRef.current.push([x, y]);
  };
  const handleWbTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const t = e.touches[0]; if (!t || !wbDrawingRef.current) return; e.preventDefault();
    const canvas = wbCanvasRef.current; if (!canvas) return;
    const [x, y] = pointerToCanvasXY(canvas, t.clientX, t.clientY);
    const last = wbPointsRef.current[wbPointsRef.current.length - 1];
    wbPointsRef.current.push([x, y]);
    const seg = { color: wbColor, size: wbSize, points: [last, [x, y]] as any, tool: wbToolRef.current };
    drawStrokeOnCanvas(seg);
    const now = performance.now();
    if (now - wbLastEmitRef.current > 30) {
      wbLastEmitRef.current = now;
      socketRef.current?.emit('whiteboard:stroke', seg);
    }
  };

  const floodFillAt = (sx: number, sy: number, colorHex: string) => {
    const canvas = wbCanvasRef.current; if (!canvas) return;
    const ctx = wbCtxRef.current || canvas.getContext('2d'); if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const img = ctx.getImageData(0, 0, rect.width, rect.height);
    const data = img.data; const w = img.width, h = img.height;
    const idx = (x:number,y:number)=> (y*w + x)*4;
    const target = idx(sx, sy);
    const r0=data[target], g0=data[target+1], b0=data[target+2], a0=data[target+3];
    const hexToRgb = (hex:string)=>{ const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)!; return {r:parseInt(m[1],16),g:parseInt(m[2],16),b:parseInt(m[3],16)}; };
    const {r, g, b} = hexToRgb(colorHex);
    if (r0===r && g0===g && b0===b) return;
    const q: Array<[number,number]> = [[sx,sy]];
    while(q.length){
      const [x,y]=q.pop()!; const i=idx(x,y);
      if (x<0||y<0||x>=w||y>=h) continue;
      if (data[i]===r && data[i+1]===g && data[i+2]===b) continue;
      if (data[i]!==r0 || data[i+1]!==g0 || data[i+2]!==b0 || data[i+3]!==a0) continue;
      data[i]=r; data[i+1]=g; data[i+2]=b; data[i+3]=255;
      q.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    ctx.putImageData(img, 0, 0);
  };


  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white/70 backdrop-blur">
        <div className="container-page h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-indigo-600" />
            <span className="font-semibold">Metaverse Collaboration</span>
            {roomId && (
              <span className="ml-2 text-xs px-2 py-1 rounded bg-indigo-50 text-indigo-700">
                Room: {roomId}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input w-44"
              placeholder="Your name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <input
              className="input w-44"
              placeholder="Room code"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value)}
            />
            <button
              className="btn-secondary"
              onClick={() => {
                const code = roomCodeInput.trim();
                if (code) setRoomId(code);
                if (code) sessionStorage.setItem('lastRoomId', code);
              }}
            >
              Use Code
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                const code = "room-" + Math.random().toString(36).slice(2, 8);
                setRoomId(code);
                setRoomCodeInput(code);
                sessionStorage.setItem('lastRoomId', code);
              }}
            >
              Create Room
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                setErrorMsg(null);
                try {
                  if (!authedUser) { setAuthOpen(true); return; }
                  if (!joined) {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                    mediaStreamRef.current = stream;
                    if (videoRef.current) {
                      videoRef.current.srcObject = stream;
                      await videoRef.current.play().catch(() => {});
                    }
                    setMicEnabled(true);
                    setCamEnabled(true);
                    setJoined(true);
                    sessionStorage.setItem('sessionAuthed', '1');
                    sessionStorage.setItem('joined', '1');
                    nameRef.current = displayName;
                    const url = modelUrlForAvatar(authedUser.avatar.value);
                    const { group: obj, clips } = await loadModel(url);
                    obj.traverse((o) => { (o as any).castShadow = true; });
                    localAvatarRef.current = obj;
                    const scene = sceneRef.current;
                    if (scene) scene.add(obj);
                    if (clips && clips.length) {
                      localMixerRef.current = new THREE.AnimationMixer(obj);
                      const idle = clips[0];
                      const walk = clips[1];
                      const idleAct = localMixerRef.current.clipAction(idle);
                      idleAct.play();
                      const walkAct = walk ? localMixerRef.current.clipAction(walk) : undefined;
                      localActionsRef.current = { idle: idleAct, walk: walkAct, current: 'idle' };
                    }
                  }
                } catch (err: any) {
                  setErrorMsg(err?.message ?? "Failed to access media devices");
                }
              }}
              disabled={joined}
            >
              {joined ? "Joined" : "Join"}
            </button>
            {authedUser && (
              <div className="ml-2 inline-flex items-center gap-2 text-sm">
                <img src={authedUser.avatar?.value || avatarGallery[0]} className="h-6 w-6 rounded-full object-cover" />
                <span>{authedUser.name}</span>
                <button className="btn-ghost" onClick={() => { sessionStorage.removeItem('sessionAuthed'); setSessionReady(false); setJoined(false); }}>Logout</button>
                <button className="btn-ghost" onClick={() => { localStorage.removeItem('authUser'); sessionStorage.removeItem('sessionAuthed'); setAuthedUser(null); setSessionReady(false); setAuthMode('login'); }}>Switch</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-12 gap-4 container-page py-4">
        <aside className="col-span-3 hidden md:block">
          <div className="card">
            <div className="card-body">
              <h3>Roster</h3>
              {roster.length === 0 ? (
                <p className="text-sm text-gray-600">Participants will appear here.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  <li key="self" className="text-indigo-700 flex items-center gap-2">
                    <img src={authedUser?.avatar?.value || avatarGallery[0]} className="h-4 w-4 rounded-full object-cover" />
                    You: {displayName}
                  </li>
                  {roster.map((m) => (
                    <li key={m.id} className="flex items-center gap-2">
                      <img src={m.avatar?.value || avatarGallery[0]} className="h-4 w-4 rounded-full object-cover" />
                      {m.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="card mt-4">
            <div className="card-body">
              <h3>Tools</h3>
              <ul className="mt-2 space-y-2 text-sm">
                <li>
                  <button className="btn-secondary w-full" onClick={() => {
                    setWbOpen((v)=>!v);
                    setTimeout(setupWhiteboardCanvas, 50);
                    if (socketRef.current) socketRef.current.emit('whiteboard:requestState');
                  }}>{wbOpen? 'Hide Whiteboard':'Open Whiteboard'}</button>
                </li>
                <li>
                  <button className="btn-secondary w-full" onClick={() => setChatOpen((v)=>!v)}>{chatOpen? 'Hide Chat':'Open Chat'}</button>
                </li>
                <li>Documents</li>
                <li>Assets</li>
              </ul>
            </div>
          </div>
          {wbOpen && (
            <div className="card mt-4">
              <div className="card-body">
                <div className="flex items-center justify-between">
                  <h3>Whiteboard</h3>
                  <div className="flex items-center gap-2">
                    <select className="input" onChange={(e)=>{ wbToolRef.current = e.target.value as any; }}>
                      <option value="pencil">Pencil</option>
                      <option value="brush">Brush</option>
                      <option value="marker">Marker</option>
                      <option value="airbrush">Airbrush</option>
                      <option value="eraser">Eraser</option>
                      <option value="fill">Fill</option>
                    </select>
                    <input type="color" value={wbColor} onChange={(e)=>setWbColor(e.target.value)} />
                    <input type="range" min={1} max={24} value={wbSize} onChange={(e)=>setWbSize(parseInt(e.target.value))} />
                    <button className="btn-ghost" onClick={() => {
                      clearWhiteboardCanvas();
                      socketRef.current?.emit('whiteboard:clear');
                    }}>Clear</button>
                  </div>
                </div>
                <div className="mt-2 border rounded-md overflow-hidden">
                  <canvas ref={wbCanvasRef} className="w-full h-72 touch-none select-none bg-white" 
                    onMouseDown={(e)=>handleWbPointerDown(e)}
                    onMouseMove={(e)=>handleWbPointerMove(e)}
                    onMouseUp={()=>handleWbPointerUp()}
                    onMouseLeave={()=>handleWbPointerUp()}
                    onTouchStart={(e)=>handleWbTouchStart(e)}
                    onTouchMove={(e)=>handleWbTouchMove(e)}
                    onTouchEnd={()=>handleWbPointerUp()}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2">Tip: choose color/size, draw together in real-time.</p>
              </div>
            </div>
          )}
        </aside>

        <section className="col-span-12 md:col-span-6">
          <div className="card overflow-hidden">
            <div className="relative">
              <div
                ref={mountRef}
                className="h-[60vh] w-full"
                onMouseMove={(e) => {
                  if (!socketRef.current) return;
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                  const scene = sceneRef.current;
                  if (!scene) return;
                  const camera = scene.children.find((c) => (c as any).isCamera) as THREE.PerspectiveCamera | undefined;
                  if (!camera) return;
                  const ray = new THREE.Raycaster();
                  ray.setFromCamera(new THREE.Vector2(x, y), camera);
                  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
                  const point = new THREE.Vector3();
                  ray.ray.intersectPlane(plane, point);
                  socketRef.current.emit("cursor:pos", { userId: userIdRef.current, p: [point.x, 0.05, point.z] });
                }}
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                  const scene = sceneRef.current;
                  if (!scene) return;
                  const camera = scene.children.find((c) => (c as any).isCamera) as THREE.PerspectiveCamera | undefined;
                  if (!camera) return;
                  const ray = new THREE.Raycaster();
                  ray.setFromCamera(new THREE.Vector2(x, y), camera);
                  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
                  const point = new THREE.Vector3();
                  ray.ray.intersectPlane(plane, point);
                  moveTargetRef.current = point.clone();
                }}
              />
              {/* XR UI removed */}
            </div>
          </div>
          {/* XR helper text removed */}
          {errorMsg && (
            <p className="text-sm text-red-600 mt-1">{errorMsg}</p>
          )}
          <div className="mt-4 card">
            <div className="card-body">
              <h3>Participants Video</h3>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3">
                {camEnabled && mediaStreamRef.current && (
                  <div className="relative">
                    <video className="w-full aspect-video rounded-lg bg-black" muted playsInline autoPlay ref={(el: HTMLVideoElement | null) => { if (el && el.srcObject !== mediaStreamRef.current) el.srcObject = mediaStreamRef.current; }} />
                    <div className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">You</div>
                  </div>
                )}
                {(Object.entries(remoteStreamsRef.current) as [string, MediaStream][]).map(([peerId, stream]) => (
                  <div key={peerId} className="relative">
                    <video className="w-full aspect-video rounded-lg bg-black" autoPlay playsInline ref={(el: HTMLVideoElement | null) => { if (el && el.srcObject !== stream) el.srcObject = stream; }} />
                    <div className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">{nameForUserId(peerId)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {chatOpen && (
            <div className="mt-4 card">
              <div className="card-body">
                <div className="flex items-center justify-between">
                  <h3>Chat</h3>
                  <div className="flex items-center gap-2">
                    <label className="text-xs">Medical Mode</label>
                    <button
                      className={`btn-secondary text-xs ${medMode ? 'bg-green-100' : ''}`}
                      onClick={() => {
                        setMedMode((v)=>{
                          const next = !v;
                          if (next && !chatInput.trim()) {
                            setChatInput('Discuss a drug: indications, mechanism of action, dosage, side effects, interactions, contraindications.');
                          }
                          return next;
                        });
                      }}
                    >{medMode ? 'ON' : 'OFF'}</button>
                  </div>
                </div>
                <div ref={chatListRef} className="mt-2 h-56 overflow-y-auto border rounded p-2 bg-white">
                  {chatLog.length === 0 ? (
                    <p className="text-xs text-gray-500">No messages yet.</p>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {chatLog.slice(-200).map((m,i)=> {
                        const isSelf = m.userId === userIdRef.current;
                        return (
                          <li key={m.ts+':'+i} className={`flex items-end ${isSelf ? 'justify-end' : 'justify-start'}`}>
                            {!isSelf && (
                              <img src={avatarForUserId(m.userId)} className="h-6 w-6 rounded-full object-cover mr-2" />
                            )}
                            <div className={`${isSelf ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-900'} rounded-2xl px-3 py-2 max-w-[75%] shadow-sm`}> 
                              {!isSelf && <div className="text-[10px] opacity-80 mb-0.5">{nameForUserId(m.userId)}</div>}
                              <div className="whitespace-pre-wrap break-words">{m.text}</div>
                              <div className={`text-[10px] mt-0.5 ${isSelf ? 'text-indigo-100/90' : 'text-gray-500'}`}>{formatTime(m.ts)}</div>
                            </div>
                            {isSelf && (
                              <img src={avatarForUserId(m.userId)} className="h-6 w-6 rounded-full object-cover ml-2" />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="Type a message"
                    value={chatInput}
                    onChange={(e)=>setChatInput(e.target.value)}
                    onKeyDown={(e)=>{
                      if(e.key==='Enter') {
                        const raw = chatInput.trim();
                        if (!raw) return;
                        const text = medMode ? `[MED] ${raw}` : raw;
                        const cid = `${userIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
                        chatSeenRef.current.add(cid);
                        setChatLog(prev => [...prev, { userId: userIdRef.current, name: authedUser?.name || displayName, text, ts: Date.now() }]);
                        socketRef.current?.emit('chat:message', { text, cid });
                        setChatInput('');
                      }
                    }}
                  />
                  <button
                    className="btn-primary"
                    onClick={()=>{
                      const raw = chatInput.trim();
                      if (!raw) return;
                      const text = medMode ? `[MED] ${raw}` : raw;
                      const cid = `${userIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
                      chatSeenRef.current.add(cid);
                      setChatLog(prev => [...prev, { userId: userIdRef.current, name: authedUser?.name || displayName, text, ts: Date.now() }]);
                      socketRef.current?.emit('chat:message', { text, cid });
                      setChatInput('');
                    }}
                  >Send</button>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="col-span-12 md:col-span-3">
          <div className="card">
            <div className="card-body">
              <h3>Timeline</h3>
              <p className="text-sm text-gray-600">Meeting summary (after End Meeting).</p>
              {summaries.length === 0 ? (
                <p className="text-xs text-gray-500 mt-2">No summary yet.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-xs">
                  {summaries.slice(-6).map((s, i) => (<li key={i} className="text-gray-700">• {s}</li>))}
                </ul>
              )}
              <div className="mt-3 flex gap-2">
                <button className="btn-primary w-full" onClick={() => {
                  // End meeting: stop recognition loop and generate a simple summary from chat + transcript
                  setMeetingEnded(true);
                  const chatSummary = chatLog.slice(-50).map(m=>`${m.name}: ${m.text}`).join(' ');
                  const text = (transcript ? transcript + ' ' : '') + chatSummary;
                  const sentences = text.split(/[.!?]+\s/).filter(Boolean);
                  const bullets = sentences.slice(-6).map(s=>`Recent: ${s.trim()}`);
                  setSummaries(bullets);
                }}>End Meeting</button>
              </div>
            </div>
          </div>
          <div className="card mt-4">
            <div className="card-body">
              <h3>Settings</h3>
              <div className="mt-2 space-y-2">
                <button
                  className="btn-secondary w-full"
                  onClick={async () => {
                    await ensureMediaIfNeeded();
                    const st = mediaStreamRef.current;
                    if (!st) return;
                    const a = st.getAudioTracks()[0];
                    if (a) {
                      if (a.enabled) {
                        // turn OFF: stop sending and mute monitor
                        await replaceAudioTrackForAll(null);
                        a.enabled = false;
                        if (micMonitorRef.current) micMonitorRef.current.gain.gain.value = 0.0;
                        setMicEnabled(false);
                      } else {
                        // turn ON: ensure track exists and send; enable monitor
                        if (a.readyState === 'ended') {
                          try {
                            const anew = (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0];
                            st.addTrack(anew);
                            await replaceAudioTrackForAll(anew);
                          } catch { setErrorMsg('Cannot start microphone'); return; }
                        } else {
                          await replaceAudioTrackForAll(a);
                        }
                        a.enabled = true;
                        if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                        if (micMonitorRef.current) micMonitorRef.current.gain.gain.value = 0.6;
                        setMicEnabled(true);
                      }
                    }
                  }}
                >
                  {micEnabled ? "Mute Mic" : "Unmute Mic"}
                </button>
                <button
                  className="btn-secondary w-full"
                  onClick={async () => {
                    await ensureMediaIfNeeded();
                    const st = mediaStreamRef.current;
                    if (!st) return;
                    const vtrack = st.getVideoTracks()[0];
                    if (camEnabled && vtrack) {
                      await replaceVideoTrackForAll(null);
                      vtrack.stop();
                      st.removeTrack(vtrack);
                      setCamEnabled(false);
                      if (videoRef.current) videoRef.current.srcObject = st;
                    } else if (!camEnabled) {
                      try {
                        const v = await navigator.mediaDevices.getUserMedia({ video: true });
                        const newTrack = v.getVideoTracks()[0];
                        st.addTrack(newTrack);
                        await replaceVideoTrackForAll(newTrack);
                        if (videoRef.current) videoRef.current.srcObject = st;
                        setCamEnabled(true);
                      } catch { setErrorMsg('Cannot start camera'); }
                    }
                  }}
                >
                  {camEnabled ? "Turn Camera Off" : "Turn Camera On"}
                </button>
                <div className="mt-2 h-40 bg-gray-900/90 rounded-md flex items-center justify-center">
                  <video ref={videoRef} className="h-full" muted playsInline autoPlay />
                </div>
                <div className="mt-3">
                  <div className="text-sm mb-1">Quick Avatar</div>
                  <div className="grid grid-cols-5 gap-2">
                    {avatarGallery.map((src) => (
                      <button key={src} className={`rounded-lg p-1 ring-2 ${avatarImage===src? 'ring-indigo-500':'ring-transparent'} bg-gray-100`} onClick={() => setAvatarImage(src)}>
                        <img src={src} className="h-12 w-12 rounded-md object-cover" />
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-end gap-2 mt-2">
                    <button className="btn-secondary" onClick={() => setAvatarImage(avatarGallery[0])}>Reset</button>
                    <button className="btn-primary" onClick={async () => {
                      if (!authedUser) return;
                      const updated = { ...authedUser, avatar: { kind: 'image' as const, value: avatarImage } };
                      setAuthedUser(updated);
                      const accounts = JSON.parse(localStorage.getItem('accounts') || '[]');
                      const idx = accounts.findIndex((a: any) => a.email === updated.email);
                      if (idx >= 0) { accounts[idx] = { ...accounts[idx], avatar: updated.avatar }; localStorage.setItem('accounts', JSON.stringify(accounts)); }
                      localStorage.setItem('authUser', JSON.stringify(updated));
                      socketRef.current?.emit('avatar:update', { avatar: updated.avatar });
                      setRoster((prev) => prev.map((m) => (m.id === userIdRef.current ? { ...m, avatar: updated.avatar } : m)));
                      const scene = sceneRef.current;
                      if (scene && localAvatarRef.current) { scene.remove(localAvatarRef.current); localAvatarRef.current = null; }
                      const url = modelUrlForAvatar(updated.avatar.value);
                      const { group: obj, clips } = await loadModel(url);
                      if (scene) { scene.add(obj); localAvatarRef.current = obj; }
                      if (clips && clips.length) {
                        localMixerRef.current = new THREE.AnimationMixer(obj);
                        const idle = clips[0];
                        const walk = clips[1];
                        const idleAct = localMixerRef.current.clipAction(idle);
                        idleAct.play();
                        const walkAct = walk ? localMixerRef.current.clipAction(walk) : undefined;
                        localActionsRef.current = { idle: idleAct, walk: walkAct, current: 'idle' };
                      }
                    }}>Save Avatar</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </main>

      <footer className="border-t">
        <div className="container-page h-12 flex items-center justify-between text-sm text-gray-500">
          <span>Three.js + WebXR scaffold</span>
          <span>Vite + React + Tailwind</span>
        </div>
      </footer>

      {!sessionReady && (
        <div className="fixed inset-0 flex items-center justify-center p-0">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-cyan-500 to-sky-400" />
          <div className="relative w-full max-w-md mx-auto">
            <div className="card rounded-2xl shadow-2xl backdrop-blur bg-white/95">
              <div className="card-body">
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-bold tracking-tight text-gray-900">{authMode === 'login' ? 'Login' : 'Sign Up'}</h3>
                  <div className="text-sm">
                    {authMode === 'login' ? (
                      <button className="btn-ghost" onClick={() => setAuthMode('signup')}>Create account</button>
                    ) : (
                      <button className="btn-ghost" onClick={() => setAuthMode('login')}>Have an account? Login</button>
                    )}
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <input className="input focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400" placeholder="Email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
                  <input className="input focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400" placeholder="Password" type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
                  <input className="input focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400" placeholder="Display name" value={authName} onChange={(e) => setAuthName(e.target.value)} />
                  <div>
                    <div className="text-sm mb-1 text-gray-700">Choose avatar</div>
                    <div className="grid grid-cols-5 gap-2">
                      {avatarGallery.map((src) => (
                        <button key={src} className={`rounded-lg p-1 ring-2 transition-all ${avatarImage===src? 'ring-indigo-500 shadow-md':'ring-transparent'} bg-gray-100 hover:bg-gray-200`} onClick={() => setAvatarImage(src)}>
                          <img src={src} className="h-12 w-12 rounded-md object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                  {authMode === 'signup' && (
                    <button className="btn-primary w-full" onClick={() => {
                      const accounts = JSON.parse(localStorage.getItem('accounts') || '[]');
                      const exists = accounts.find((a: any) => a.email === authEmail);
                      if (exists) { setErrorMsg('Account already exists'); return; }
                      const profile = { id: `u_${Math.random().toString(36).slice(2,10)}`, name: authName || 'User', email: authEmail, password: authPassword, avatar: { kind: 'image' as const, value: avatarImage } };
                      accounts.push(profile);
                      localStorage.setItem('accounts', JSON.stringify(accounts));
                      setErrorMsg(null);
                      setAuthMode('login');
                    }}>Create Account</button>
                  )}
                  {authMode === 'login' && (
                    <button className="btn-primary w-full" onClick={() => {
                      const accounts = JSON.parse(localStorage.getItem('accounts') || '[]');
                      const found = accounts.find((a: any) => a.email === authEmail && a.password === authPassword);
                      if (!found) { setErrorMsg('Invalid credentials'); return; }
                      found.name = authName || found.name;
                      if (avatarImage) found.avatar = { kind: 'image', value: avatarImage };
                      localStorage.setItem('accounts', JSON.stringify(accounts));
                      localStorage.setItem('authUser', JSON.stringify(found));
                      setAuthedUser(found);
                      setDisplayName(found.name);
                      sessionStorage.setItem('sessionAuthed','1');
                      setSessionReady(true);
                      setAuthOpen(false);
                      setErrorMsg(null);
                    }}>Login</button>
                  )}
                  {errorMsg && <div className="text-sm text-red-600">{errorMsg}</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Whiteboard helpers (component scope)
function getCanvasCtx(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!canvas) return null;
  return canvas.getContext('2d');
}

// Speech recognition for simple transcript and summary
// Hook it to micEnabled changes
// Note: This must be inside component; append below export default function content if needed.