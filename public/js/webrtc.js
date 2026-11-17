const WebRTCManager = {
  peers: new Map(),
  localStream: null,
  screenStream: null,
  screenTrack: null,
  cameraTrack: null,
  currentRoomId: null,
  livekitRoom: null,
  sfuMode: false,
  micOn: true,
  camOn: false,
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  iceTransportPolicy: 'all',
  audioContext: null,
  analysers: new Map(),
  animationFrame: null,
  showCallStage(roomName) {
    document.getElementById('webrtc-stage')?.classList.remove('hidden');
    document.getElementById('webrtc-stage')?.classList.add('flex');
    document.getElementById('voice-status-bar')?.classList.remove('hidden');
    const label = document.getElementById('voice-channel-label'); if (label) label.textContent = roomName;
    const title = document.getElementById('hc-call-room-title'); if (title) title.textContent = roomName;
    const status = document.getElementById('rtc-turn-status'); if (status) { status.textContent = 'Conectando ao LiveKit…'; status.className = 'text-violet-300 font-medium'; }
  },
  async joinRoom(roomId, roomName, withVideo = false) {
    if (!API.socket?.connected) return UI.toast('Conectando ao servidor. Tente novamente em instantes.', 'error');
    const voiceChannel = App.state.servers.flatMap(server => server.channels).find(channel => channel.id === roomId);
    roomName = roomName || voiceChannel?.name || 'Canal de voz';
    if (this.currentRoomId === roomId) return;
    if (this.currentRoomId) await this.leaveRoom(true);
    this.currentRoomId = roomId; this.micOn = true; this.camOn = Boolean(withVideo);
    this.showCallStage(roomName);
    // Atualiza a presença imediatamente; não espera o handshake de mídia.
    API.socket.emit('rtc:sfu-presence-join', { roomId });
    if (await this.joinLiveKit(roomId, roomName, withVideo)) return;
    // O modo P2P continua disponível como contingência, mas informa claramente o estado.
    this.currentRoomId = roomId;
    try {
      const [configResult, audioResult, videoResult] = await Promise.allSettled([
        API.get('/api/rtc-config'),
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }),
        withVideo ? navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } }) : Promise.resolve(null)
      ]);
      if (configResult.status === 'fulfilled') {
        const config = configResult.value; this.iceServers = config.iceServers || this.iceServers; this.iceTransportPolicy = config.transportPolicy || 'all';
        const turnStatus = document.getElementById('rtc-turn-status');
        if (turnStatus) { turnStatus.textContent = config.turnConfigured ? 'WebRTC • TURN configurado' : 'WebRTC • STUN somente (TURN não configurado)'; turnStatus.className = config.turnConfigured ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'; }
      }
      this.localStream = new MediaStream();
      if (audioResult.status === 'fulfilled') audioResult.value.getAudioTracks().forEach(track => this.localStream.addTrack(track));
      else { this.micOn = false; UI.toast('Microfone indisponível: ' + audioResult.reason.message, 'error'); }
      if (withVideo && videoResult.status === 'fulfilled' && videoResult.value) videoResult.value.getVideoTracks().forEach(track => this.localStream.addTrack(track));
      else if (withVideo) this.camOn = false;
      this.cameraTrack = this.localStream.getVideoTracks()[0] || null;
      this.attachLocalVideo(Boolean(this.cameraTrack));
      this.startAnalyser('local', this.localStream, 'local-video-card');
      await this.populateDevices().catch(err => console.warn('[webrtc] lista de dispositivos:', err));
    } catch (err) { this.localStream = new MediaStream(); this.micOn = false; this.camOn = false; UI.toast('Não foi possível iniciar os dispositivos: ' + err.message, 'error'); }
    const result = await new Promise(resolve => API.socket.emit('rtc:join-room', { roomId }, resolve));
    if (!result?.ok) { await this.leaveRoom(true); return UI.toast(result?.error || 'Não foi possível entrar no canal.', 'error'); }
    this.playUiSound('join'); this.refreshCallControls();
    navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
  },

  async joinLiveKit(roomId, roomName, withVideo = false) {
    const sdk = window.LivekitClient;
    if (!sdk?.Room || !sdk?.RoomEvent || !sdk?.Track || typeof sdk.createLocalAudioTrack !== 'function') {
      console.error('[livekit] SDK não carregado ou incompatível:', sdk);
      return false;
    }
    const status = document.getElementById('rtc-turn-status');
    if (status) { status.textContent = 'Preparando microfone e LiveKit…'; status.className = 'text-violet-300 font-medium'; }
    let room = null, micTrack = null, cameraTrack = null;
    try {
      // Permissão/captura do microfone ocorre em paralelo à emissão do token.
      const [config, micResult, cameraResult] = await Promise.all([
        API.get('/api/sfu/config?roomId=' + encodeURIComponent(roomId)),
        sdk.createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }).then(track => ({ track })).catch(error => ({ error })),
        withVideo && typeof sdk.createLocalVideoTrack === 'function'
          ? sdk.createLocalVideoTrack({ resolution: { width: 1280, height: 720 }, frameRate: 30 }).then(track => ({ track })).catch(error => ({ error }))
          : Promise.resolve(null)
      ]);
      if (!config?.sfuConfigured || !config.url || !config.token) {
        micResult.track?.stop(); cameraResult?.track?.stop();
        return false;
      }
      micTrack = micResult.track || null; cameraTrack = cameraResult?.track || null;
      if (!micTrack) UI.toast('Não foi possível abrir o microfone: ' + (micResult.error?.message || 'permissão negada'), 'error');
      if (withVideo && !cameraTrack) UI.toast('Câmera indisponível: ' + (cameraResult?.error?.message || 'verifique a permissão.'), 'error');

      room = new sdk.Room({ adaptiveStream: true, dynacast: true, stopLocalTrackOnUnpublish: true });
      this.livekitRoom = room;
      room.on(sdk.RoomEvent.LocalTrackPublished, publication => {
        if (publication.kind === sdk.Track.Kind.Video && publication.videoTrack) this.renderLiveKitVideo(room.localParticipant, publication.videoTrack);
        if (publication.source === sdk.Track.Source.ScreenShare) this.screenTrack = true;
        this.refreshCallControls();
      });
      room.on(sdk.RoomEvent.LocalTrackUnpublished, publication => {
        if (publication.source === sdk.Track.Source.ScreenShare) this.screenTrack = null;
        const camera = room.localParticipant.getTrackPublication(sdk.Track.Source.Camera);
        if (camera?.videoTrack) this.renderLiveKitVideo(room.localParticipant, camera.videoTrack);
        else if (publication.kind === sdk.Track.Kind.Video) {
          document.getElementById('local-video')?.classList.add('hidden');
          document.getElementById('local-avatar-placeholder')?.classList.remove('hidden');
        }
        this.refreshCallControls();
      });
      room.on(sdk.RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === sdk.Track.Kind.Audio) {
          const audio = track.attach(); audio.autoplay = true; audio.setAttribute('playsinline', '');
          audio.dataset.livekitParticipant = participant.identity; document.body.appendChild(audio);
          audio.play?.().catch(() => this.promptLiveKitAudioUnlock(room));
        } else if (track.kind === sdk.Track.Kind.Video) this.renderLiveKitVideo(participant, track);
      });
      room.on(sdk.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        track.detach().forEach(element => element.remove());
        if (track.kind === sdk.Track.Kind.Video) {
          const local = participant === room.localParticipant;
          const card = document.getElementById(local ? 'local-video-card' : 'peer-card-' + participant.identity);
          card?.querySelector('video')?.classList.add('hidden');
          (local ? document.getElementById('local-avatar-placeholder') : card?.querySelector('.rtc-peer-avatar'))?.classList.remove('hidden');
        }
      });
      room.on(sdk.RoomEvent.ParticipantConnected, participant => this.ensureLiveKitTile(participant));
      room.on(sdk.RoomEvent.ParticipantDisconnected, participant => document.getElementById('peer-card-' + participant.identity)?.remove());
      room.on(sdk.RoomEvent.ActiveSpeakersChanged, speakers => {
        document.querySelectorAll('#local-video-card, [id^="peer-card-"]').forEach(card => card.classList.remove('speaking-ring'));
        speakers.forEach(participant => {
          const id = participant.identity === room.localParticipant.identity ? 'local-video-card' : 'peer-card-' + participant.identity;
          document.getElementById(id)?.classList.add('speaking-ring');
        });
      });
      room.on(sdk.RoomEvent.MediaDevicesError, error => UI.toast('Falha no microfone/câmera: ' + (error?.message || 'verifique as permissões.'), 'error'));
      room.on(sdk.RoomEvent.AudioPlaybackStatusChanged, () => { if (!room.canPlaybackAudio) this.promptLiveKitAudioUnlock(room); else document.getElementById('hc-livekit-audio-unlock')?.remove(); });

      await room.connect(config.url, config.token, { autoSubscribe: true });
      this.sfuMode = true; this.micOn = false; this.camOn = false;
      this.ensureLiveKitTile(room.localParticipant, true);
      // Publica as tracks já capturadas: não abre o microfone depois do handshake.
      if (micTrack) { await room.localParticipant.publishTrack(micTrack, { source: sdk.Track.Source.Microphone }); this.micOn = true; }
      if (cameraTrack) { await room.localParticipant.publishTrack(cameraTrack, { source: sdk.Track.Source.Camera }); this.camOn = true; this.cameraTrack = cameraTrack; this.renderLiveKitVideo(room.localParticipant, cameraTrack); }
      room.remoteParticipants.forEach(participant => this.ensureLiveKitTile(participant));
      const liveStatus = document.getElementById('rtc-turn-status');
      if (liveStatus) { liveStatus.textContent = 'LiveKit • conectado'; liveStatus.className = 'text-emerald-400 font-medium'; }
      await room.startAudio().catch(() => {});
      if (!room.canPlaybackAudio) this.promptLiveKitAudioUnlock(room);
      this.playUiSound('join'); this.refreshCallControls();
      navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
      return true;
    } catch (error) {
      console.error('[livekit] falha ao entrar:', error);
      try { micTrack?.stop(); cameraTrack?.stop(); room?.disconnect(); } catch {}
      this.livekitRoom = null; this.sfuMode = false;
      const liveStatus = document.getElementById('rtc-turn-status');
      if (liveStatus) { liveStatus.textContent = 'Falha no LiveKit'; liveStatus.className = 'text-red-400 font-medium'; }
      UI.toast('LiveKit não conseguiu iniciar: ' + (error?.message || 'erro de conexão'), 'error');
      return false;
    }
  },
  promptLiveKitAudioUnlock(room) {
    if (document.getElementById('hc-livekit-audio-unlock')) return;
    const stage = document.getElementById('webrtc-stage'); if (!stage) return;
    const button = document.createElement('button');
    button.id = 'hc-livekit-audio-unlock';
    button.type = 'button';
    button.className = 'absolute top-4 left-1/2 -translate-x-1/2 z-30 rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white shadow-xl';
    button.textContent = 'Ativar áudio da chamada';
    button.addEventListener('click', async () => {
      try { await room.startAudio(); button.remove(); }
      catch (error) { UI.toast('O navegador bloqueou o áudio. Clique novamente ou confira a saída de som.', 'error'); }
    });
    stage.appendChild(button);
  },
  ensureLiveKitTile(participant, local = false) {
    const id = local ? 'local-video-card' : 'peer-card-' + participant.identity;
    let card = document.getElementById(id);
    if (!card && !local) {
      const grid = document.getElementById('video-grid'); if (!grid) return null;
      card = document.createElement('div'); card.id = id;
      card.className = 'relative aspect-video rounded-2xl bg-[#12151f] border border-purple-500/20 overflow-hidden flex items-center justify-center';
      const avatar = document.createElement('div'); avatar.className = 'rtc-peer-avatar absolute inset-0 flex items-center justify-center pointer-events-none';
      const name = participant.name || participant.identity || 'Participante';
      let avatarUrl = null;
      try { avatarUrl = JSON.parse(participant.metadata || '{}').avatarUrl || null; } catch {}
      avatar.innerHTML = avatarUrl
        ? '<img src="' + this.escapeAttr(avatarUrl) + '" class="w-16 h-16 rounded-full object-cover border-2 border-purple-400/60" alt="">'
        : '<span class="w-16 h-16 rounded-full bg-purple-600/30 text-purple-200 flex items-center justify-center text-xl font-bold">' + this.escapeHTML(name.slice(0,2).toUpperCase()) + '</span>';
      const label = document.createElement('span'); label.className = 'absolute bottom-2 left-2 px-2.5 py-0.5 rounded bg-black/75 text-xs'; label.textContent = name;
      card.append(avatar, label); grid.appendChild(card);
    }
    return card;
  },
  renderLiveKitVideo(participant, track) {
    const local = participant === this.livekitRoom?.localParticipant;
    const card = this.ensureLiveKitTile(participant, local); if (!card) return;
    const video = local ? document.getElementById('local-video') : document.createElement('video');
    if (!video) return;
    video.autoplay = true; video.playsInline = true;
    if (!local) video.className = 'absolute inset-0 w-full h-full object-cover';
    track.attach(video); if (!local && !video.isConnected) card.prepend(video);
    video.classList.remove('hidden');
    (local ? document.getElementById('local-avatar-placeholder') : card.querySelector('.rtc-peer-avatar'))?.classList.add('hidden');
  },
  onDeviceChange() { WebRTCManager.populateDevices().catch(console.warn); },
  async populateDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mic = document.getElementById('mic-select');
    const cam = document.getElementById('cam-select');
    if (!mic || !cam) return;
    const selectedMic = this.localStream?.getAudioTracks()[0]?.getSettings().deviceId;
    const selectedCam = this.cameraTrack?.getSettings().deviceId;
    mic.innerHTML = devices.filter(d => d.kind === 'audioinput').map(d => `<option value="${this.escapeAttr(d.deviceId)}" ${d.deviceId === selectedMic ? 'selected' : ''}>${this.escapeHTML(d.label || 'Microfone')}</option>`).join('');
    cam.innerHTML = devices.filter(d => d.kind === 'videoinput').map(d => `<option value="${this.escapeAttr(d.deviceId)}" ${d.deviceId === selectedCam ? 'selected' : ''}>${this.escapeHTML(d.label || 'Câmera')}</option>`).join('');
    mic.onchange = () => this.switchMicrophone(mic.value).catch(err => UI.toast(err.message, 'error'));
    cam.onchange = () => this.switchCamera(cam.value).catch(err => UI.toast(err.message, 'error'));
  },
  escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  escapeAttr(value) { return this.escapeHTML(value); },
  attachLocalVideo(showVideo) {
    const video = document.getElementById('local-video');
    const placeholder = document.getElementById('local-avatar-placeholder');
    if (!video || !placeholder) return;
    if (showVideo && this.localStream) { video.srcObject = this.screenStream || this.localStream; video.classList.remove('hidden'); placeholder.classList.add('hidden'); }
    else { video.srcObject = null; video.classList.add('hidden'); placeholder.classList.remove('hidden'); }
  },
  createPeerConnection(remoteSocketId, remoteName, remoteAvatarUrl = null, remoteUserId = null) {
    if (this.peers.has(remoteSocketId)) return this.peers.get(remoteSocketId).pc;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, iceTransportPolicy: this.iceTransportPolicy, bundlePolicy: 'max-bundle' });
    const state = { pc, name: remoteName || 'Participante', avatarUrl: remoteAvatarUrl, userId: remoteUserId, makingOffer: false, ignoreOffer: false, settingRemoteAnswerPending: false, candidateQueue: [], polite: String(API.socket.id).localeCompare(String(remoteSocketId)) > 0 };
    this.peers.set(remoteSocketId, state);
    if (this.localStream) this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
    pc.onicecandidate = event => { if (event.candidate) API.socket.emit('rtc:signal', { to: remoteSocketId, signal: { type: 'candidate', candidate: event.candidate } }); };
    pc.ontrack = event => {
      const stream = event.streams?.[0] || new MediaStream([event.track]);
      this.renderRemoteTile(remoteSocketId, state.name, stream, state.avatarUrl);
      if (event.track.kind === 'audio') this.startAnalyser(remoteSocketId, stream, `peer-card-${remoteSocketId}`);
    };
    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true;
        await pc.setLocalDescription();
        API.socket.emit('rtc:signal', { to: remoteSocketId, signal: { type: pc.localDescription.type, sdp: pc.localDescription } });
      } catch (err) { console.error('[webrtc] negotiationneeded:', err); }
      finally { state.makingOffer = false; }
    };
    pc.oniceconnectionstatechange = () => {
      const ice = pc.iceConnectionState;
      if (ice === 'failed') this.restartIce(remoteSocketId).catch(console.error);
      if (ice === 'disconnected') {
        const card = document.getElementById(`peer-card-${remoteSocketId}`);
        card?.classList.add('connection-warning');
        setTimeout(() => { if (pc.iceConnectionState === 'disconnected') this.restartIce(remoteSocketId).catch(console.error); }, 2500);
      }
      if (ice === 'connected' || ice === 'completed') document.getElementById(`peer-card-${remoteSocketId}`)?.classList.remove('connection-warning');
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.removeRemoteTile(remoteSocketId);
    };
    return pc;
  },
  async handleSignal({ from, fromUserId, fromName, fromAvatarUrl, signal }) {
    let state = this.peers.get(from);
    if (!state) { this.createPeerConnection(from, fromName, fromAvatarUrl, fromUserId); state = this.peers.get(from); }
    const pc = state.pc;
    if (signal.type === 'candidate') {
      if (state.ignoreOffer) return;
      if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      else state.candidateQueue.push(signal.candidate);
      return;
    }
    const readyForOffer = !state.makingOffer && (pc.signalingState === 'stable' || state.settingRemoteAnswerPending);
    const offerCollision = signal.type === 'offer' && !readyForOffer;
    state.ignoreOffer = !state.polite && offerCollision;
    if (state.ignoreOffer) return;
    if (offerCollision && state.polite) await pc.setLocalDescription({ type: 'rollback' });
    state.settingRemoteAnswerPending = signal.type === 'answer';
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    state.settingRemoteAnswerPending = false;
    for (const candidate of state.candidateQueue.splice(0)) await pc.addIceCandidate(new RTCIceCandidate(candidate));
    if (signal.type === 'offer') {
      await pc.setLocalDescription();
      API.socket.emit('rtc:signal', { to: from, signal: { type: 'answer', sdp: pc.localDescription } });
    }
  },
  async restartIce(socketId) {
    const state = this.peers.get(socketId);
    if (!state || state.pc.signalingState === 'closed') return;
    try {
      state.makingOffer = true;
      await state.pc.setLocalDescription(await state.pc.createOffer({ iceRestart: true }));
      API.socket.emit('rtc:signal', { to: socketId, signal: { type: 'offer', sdp: state.pc.localDescription } });
    } catch (err) { console.warn('[webrtc] ICE restart falhou:', err); }
    finally { state.makingOffer = false; }
  },
  renderRemoteTile(socketId, name, stream, avatarUrl = null) {
    const grid = document.getElementById('video-grid');
    let card = document.getElementById(`peer-card-${socketId}`);
    if (!card) {
      card = document.createElement('div'); card.id = `peer-card-${socketId}`;
      card.className = 'relative aspect-video rounded-2xl bg-[#12151f] border border-purple-500/20 overflow-hidden flex items-center justify-center';
      const video = document.createElement('video'); video.autoplay = true; video.playsInline = true; video.className = 'w-full h-full object-cover';
      const avatar = document.createElement('div'); avatar.className = 'rtc-peer-avatar absolute inset-0 flex items-center justify-center pointer-events-none'; avatar.innerHTML = UI.safeAvatar(avatarUrl) ? `<img src="${UI.escapeHTML(avatarUrl)}" class="w-16 h-16 rounded-full object-cover border-2 border-purple-400/60" alt="">` : `<span class="w-16 h-16 rounded-full bg-purple-600/30 text-purple-200 flex items-center justify-center text-xl font-bold">${UI.escapeHTML((name || '?').slice(0,2).toUpperCase())}</span>`;
      const label = document.createElement('span'); label.className = 'absolute bottom-2 left-2 px-2.5 py-0.5 rounded bg-black/75 text-xs'; label.textContent = name;
      card.append(video, avatar, label); grid.appendChild(card);
    }
    const video = card.querySelector('video');
    video.srcObject = stream;
    const avatarLayer = card.querySelector('.rtc-peer-avatar');
    const hasVideo = stream.getVideoTracks().some(track => track.readyState === 'live' && track.enabled);
    avatarLayer?.classList.toggle('hidden', hasVideo);
    const outputId = localStorage.getItem('hippo_settings-output');
    if (outputId && typeof video.setSinkId === 'function') video.setSinkId(outputId).catch(err => console.warn('[audio] setSinkId:', err));
  },
  updatePeerProfile(user) {
    for (const [socketId, state] of this.peers) {
      if (state.userId !== user.id) continue;
      state.name = user.name;
      state.avatarUrl = user.avatarUrl || null;
      const card = document.getElementById(`peer-card-${socketId}`);
      const label = card?.querySelector('span.absolute');
      if (label) label.textContent = user.name;
      const avatar = card?.querySelector('.rtc-peer-avatar');
      if (avatar) avatar.innerHTML = UI.safeAvatar(user.avatarUrl) ? `<img src=\"${UI.escapeHTML(user.avatarUrl)}\" class=\"w-16 h-16 rounded-full object-cover border-2 border-purple-400/60\" alt=\"\">` : `<span class=\"w-16 h-16 rounded-full bg-purple-600/30 text-purple-200 flex items-center justify-center text-xl font-bold\">${UI.escapeHTML((user.name || '?').slice(0,2).toUpperCase())}</span>`;
    }
  },
  startAnalyser(key, stream, elementId) {
    try {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack || this.analysers.has(key)) return;
      this.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioContext.state === 'suspended') this.audioContext.resume().catch(() => {});
      const source = this.audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
      const analyser = this.audioContext.createAnalyser(); analyser.fftSize = 256; source.connect(analyser);
      this.analysers.set(key, { analyser, source, elementId });
      const tick = () => {
        let active = false;
        for (const item of this.analysers.values()) {
          const data = new Uint8Array(item.analyser.frequencyBinCount); item.analyser.getByteFrequencyData(data);
          const average = data.reduce((a, b) => a + b, 0) / data.length;
          const el = document.getElementById(item.elementId);
          if (el) { const speaking = average > 18; el.classList.toggle('speaking-ring', speaking); if (speaking) active = true; }
        }
        if (this.analysers.size) this.animationFrame = requestAnimationFrame(tick);
      };
      if (!this.animationFrame) this.animationFrame = requestAnimationFrame(tick);
    } catch (err) { console.warn('[webrtc] analyser indisponível:', err); }
  },
  async switchMicrophone(deviceId) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true }, video: false });
    const newTrack = stream.getAudioTracks()[0];
    const oldTrack = this.localStream?.getAudioTracks()[0];
    this.localStream ||= new MediaStream();
    if (oldTrack) { this.localStream.removeTrack(oldTrack); oldTrack.stop(); }
    this.localStream.addTrack(newTrack); newTrack.enabled = this.micOn;
    const oldAnalyser = this.analysers.get('local');
    if (oldAnalyser) { oldAnalyser.source.disconnect(); this.analysers.delete('local'); }
    await this.replaceTrack('audio', newTrack);
    this.startAnalyser('local', this.localStream, 'local-video-card');
  },
  async switchCamera(deviceId) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const track = stream.getVideoTracks()[0];
    this.localStream ||= new MediaStream();
    if (this.cameraTrack) { this.localStream.removeTrack(this.cameraTrack); this.cameraTrack.stop(); }
    this.localStream.addTrack(track);
    await this.replaceTrack('video', track);
    this.cameraTrack = track; this.camOn = true; this.attachLocalVideo(true);
  },
  async replaceTrack(kind, track) {
    const senders = [...this.peers.values()].map(v => v.pc.getSenders().find(s => s.track?.kind === kind || (!s.track && s._hippoKind === kind))).filter(Boolean);
    await Promise.all(senders.map(async sender => { sender._hippoKind = kind; await sender.replaceTrack(track); }));
    for (const state of this.peers.values()) {
      const hasSender = state.pc.getSenders().some(s => s.track?.kind === kind || s._hippoKind === kind);
      if (!hasSender && track) state.pc.addTrack(track, this.localStream || new MediaStream([track]));
    }
  },
  playUiSound(kind) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.uiAudioContext ||= new AudioCtx();
      const ctx = this.uiAudioContext;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const patterns = {
        join: [[523.25,0],[659.25,.11],[783.99,.22]],
        share: [[659.25,0],[880,.09]],
        mute: [[440,0],[329.63,.08]],
        unmute: [[392,0],[587.33,.08]],
        hangup: [[587.33,0],[440,.12],[293.66,.24]],
        camera: [[523.25,0],[659.25,.08]]
      };
      const notes = patterns[kind] || patterns.camera;
      const now = ctx.currentTime;
      notes.forEach(([frequency, delay]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, now + delay);
        gain.gain.setValueAtTime(0.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.075, now + delay + .018);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + .14);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + delay); osc.stop(now + delay + .15);
      });
    } catch (error) { console.debug('[sound] efeito sonoro indisponível:', error); }
  },
  refreshCallControls() {
    const mic = document.getElementById('hc-mic-control');
    const cam = document.getElementById('hc-cam-control');
    const screen = document.getElementById('hc-screen-control');
    if (mic) { mic.classList.toggle('is-off', !this.micOn); mic.querySelector('small').textContent = this.micOn ? 'Microfone' : 'Silenciado'; mic.setAttribute('aria-label', this.micOn ? 'Desligar microfone' : 'Ligar microfone'); }
    if (cam) { cam.classList.toggle('is-off', !this.camOn); cam.querySelector('small').textContent = this.camOn ? 'Câmera' : 'Câmera off'; cam.setAttribute('aria-label', this.camOn ? 'Desligar câmera' : 'Ligar câmera'); }
    if (screen) { const active = Boolean(this.screenTrack); screen.classList.toggle('is-active', active); screen.querySelector('small').textContent = active ? 'Parar tela' : 'Compartilhar'; screen.setAttribute('aria-label', active ? 'Parar compartilhamento' : 'Compartilhar tela'); }
  },
  async toggleMic() {
    try {
      if (this.sfuMode && this.livekitRoom) { const next = !this.micOn; await this.livekitRoom.localParticipant.setMicrophoneEnabled(next); this.micOn = next; this.playUiSound(next ? 'unmute' : 'mute'); this.refreshCallControls(); UI.toast(next ? 'Microfone ativado' : 'Microfone silenciado'); return; }
      let track = this.localStream?.getAudioTracks()[0];
      if (!track) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
        track = stream.getAudioTracks()[0];
        this.localStream ||= new MediaStream(); this.localStream.addTrack(track);
        await this.replaceTrack('audio', track);
        this.startAnalyser('local', this.localStream, 'local-video-card');
        await this.populateDevices().catch(() => {});
        this.micOn = true;
      } else {
        this.micOn = !this.micOn;
        track.enabled = this.micOn;
      }
      this.playUiSound(this.micOn ? 'unmute' : 'mute');
      this.refreshCallControls();
      UI.toast(this.micOn ? 'Microfone ativado' : 'Microfone silenciado');
    } catch (err) { this.micOn = false; UI.toast(`Não foi possível ativar o microfone: ${err.message}`, 'error'); }
  },
  async toggleCamera() {
    try {
      if (this.sfuMode && this.livekitRoom) { const next = !this.camOn; await this.livekitRoom.localParticipant.setCameraEnabled(next); this.camOn = next; this.playUiSound('camera'); this.refreshCallControls(); return; }
      if (this.camOn) {
        await this.replaceTrack('video', null);
        if (this.cameraTrack) { this.localStream.removeTrack(this.cameraTrack); this.cameraTrack.stop(); this.cameraTrack = null; }
        this.camOn = false; this.attachLocalVideo(false); this.playUiSound('camera'); this.refreshCallControls(); return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      this.localStream ||= new MediaStream(); this.localStream.addTrack(track);
      await this.replaceTrack('video', track);
      this.cameraTrack = track; this.camOn = true; this.attachLocalVideo(true);
      track.onended = () => { this.camOn = false; this.attachLocalVideo(false); };
      await this.populateDevices(); this.playUiSound('camera'); this.refreshCallControls();
    } catch (err) { UI.toast(`Não foi possível alterar a câmera: ${err.message}`, 'error'); }
  },
  async shareScreen() {
    if (this.sfuMode && this.livekitRoom) { try { const next = !Boolean(this.screenTrack); await this.livekitRoom.localParticipant.setScreenShareEnabled(next); this.screenTrack = next ? true : null; this.playUiSound('share'); this.refreshCallControls(); } catch (err) { if (err.name !== 'NotAllowedError') UI.toast('Compartilhamento indisponível: ' + err.message, 'error'); } return; }
    if (this.screenTrack) { await this.stopScreenShare(); this.refreshCallControls(); this.playUiSound('share'); return; }
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      const track = this.screenStream.getVideoTracks()[0];
      this.localStream ||= new MediaStream(); this.localStream.addTrack(track); this.screenTrack = track;
      await this.replaceTrack('video', track);
      const video = document.getElementById('local-video'); video.srcObject = this.screenStream; video.classList.remove('hidden');
      document.getElementById('local-avatar-placeholder').classList.add('hidden');
      track.onended = () => this.stopScreenShare().then(() => this.refreshCallControls()).catch(console.error);
      this.playUiSound('share'); this.refreshCallControls();
    } catch (err) { if (err.name !== 'NotAllowedError') UI.toast(`Compartilhamento indisponível: ${err.message}`, 'error'); }
  },
  async stopScreenShare() {
    if (this.sfuMode && this.livekitRoom) { await this.livekitRoom.localParticipant.setScreenShareEnabled(false); this.screenTrack = null; this.refreshCallControls(); return; }
    if (this.screenTrack) { this.localStream?.removeTrack(this.screenTrack); this.screenTrack.stop(); }
    this.screenTrack = null; this.screenStream = null;
    if (this.cameraTrack && this.camOn) { await this.replaceTrack('video', this.cameraTrack); this.attachLocalVideo(true); }
    else { await this.replaceTrack('video', null); this.attachLocalVideo(false); }
    this.refreshCallControls();
  },
  resetPeersForReconnect() {
    if (this.sfuMode) return;
    [...this.peers.keys()].forEach(socketId => this.removeRemoteTile(socketId));
    const grid = document.getElementById('video-grid');
    grid?.querySelectorAll('[id^=\"peer-card-\"]').forEach(el => el.remove());
  },
  removeRemoteTile(socketId) {
    const state = this.peers.get(socketId);
    if (state) { state.pc.ontrack = null; state.pc.close(); this.peers.delete(socketId); }
    const analyser = this.analysers.get(socketId);
    if (analyser) { analyser.source.disconnect(); this.analysers.delete(socketId); }
    document.getElementById(`peer-card-${socketId}`)?.remove();
  },
  async leaveRoom(silent = false) {
    if (!silent && this.currentRoomId) this.playUiSound('hangup');
    if (this.sfuMode) { if (API.socket?.connected) API.socket.emit('rtc:sfu-presence-leave'); try { this.livekitRoom?.disconnect(); } catch (error) { console.warn('[livekit] disconnect:', error); } this.livekitRoom = null; this.sfuMode = false; document.querySelectorAll('[id^="peer-card-"]').forEach(card => card.remove()); document.querySelectorAll('audio[data-livekit-participant]').forEach(audio => audio.remove()); }
    if (this.currentRoomId && API.socket?.connected) API.socket.emit('rtc:leave-room');
    this.peers.forEach((_, sid) => this.removeRemoteTile(sid));
    this.localStream?.getTracks().forEach(t => t.stop());
    this.screenStream?.getTracks().forEach(t => t.stop());
    this.localStream = null; this.screenStream = null; this.screenTrack = null; this.cameraTrack = null; this.currentRoomId = null; this.sfuMode = false; this.camOn = false; this.micOn = true;
    this.analysers.forEach(a => a.source.disconnect()); this.analysers.clear();
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame); this.animationFrame = null;
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    document.getElementById('webrtc-stage').classList.add('hidden');
    document.getElementById('webrtc-stage').classList.remove('flex');
    document.getElementById('voice-status-bar').classList.add('hidden');
    document.getElementById('hc-call-room-title') && (document.getElementById('hc-call-room-title').textContent = 'Chamada em andamento');
    document.getElementById('local-video').srcObject = null;
    document.getElementById('local-video').classList.add('hidden');
    document.getElementById('local-avatar-placeholder').classList.remove('hidden');
    if (!silent) UI.toast('Chamada encerrada');
  }
};
