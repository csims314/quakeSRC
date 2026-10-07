// Quake's reliable/unreliable interface, with WebTransport preferred and a
// WebSocket compatibility path for browsers or networks that cannot use it.
export const MAX_MESSAGE = 64000;
export const MAX_DATAGRAM = 1024;
const MAX_QUEUE_BYTES = 1024 * 1024;
const MAX_QUEUE_MESSAGES = 256;

export function frameMessage(data) {
  if (!data.length || data.length > MAX_MESSAGE) throw new Error('Invalid reliable message size');
  const frame = new Uint8Array(4 + data.length);
  new DataView(frame.buffer).setUint32(0, data.length, true);
  frame.set(data, 4);
  return frame;
}

// Streams may split either the length or payload, or combine multiple messages.
export class MessageDecoder {
  constructor(onMessage) { this.onMessage = onMessage; this.header = new Uint8Array(4); this.headerUsed = 0; this.data = null; this.used = 0; }
  push(chunk) {
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.data) {
        const count = Math.min(4 - this.headerUsed, chunk.length - offset);
        this.header.set(chunk.subarray(offset, offset + count), this.headerUsed);
        this.headerUsed += count; offset += count;
        if (this.headerUsed !== 4) continue;
        const length = new DataView(this.header.buffer).getUint32(0, true);
        if (!length || length > MAX_MESSAGE) throw new Error('Invalid reliable message length');
        this.data = new Uint8Array(length); this.used = 0;
      }
      const count = Math.min(this.data.length - this.used, chunk.length - offset);
      this.data.set(chunk.subarray(offset, offset + count), this.used);
      this.used += count; offset += count;
      if (this.used === this.data.length) {
        this.onMessage(this.data);
        this.data = null; this.headerUsed = 0; this.used = 0;
      }
    }
  }
  finish() { if (this.headerUsed || this.data) throw new Error('Truncated reliable message'); }
}

class Connection {
  constructor(id, notify, transport) {
    this.id = id; this.notify = notify; this.transport = transport;
    this.open = true; this.writing = false; this.datagramWrites = 0;
    this.reliable = []; this.unreliable = []; this.queuedBytes = 0;
    this.sendSequence = 0; this.receiveSequence = null;
    this.stats = { reliableSent: 0, reliableReceived: 0, datagramsSent: 0, datagramsReceived: 0, dropped: 0 };
  }
  enqueue(kind, data) {
    if (kind === 2 && (this.unreliable.length >= 64 || this.queuedBytes + data.length > MAX_QUEUE_BYTES)) {
      this.stats.dropped++; return;
    }
    if (this.queuedBytes + data.length > MAX_QUEUE_BYTES || this.reliable.length + this.unreliable.length >= MAX_QUEUE_MESSAGES) {
      throw new Error('Incoming message queue exceeded limit');
    }
    (kind === 1 ? this.reliable : this.unreliable).push({ kind, data });
    this.queuedBytes += data.length;
  }
  receive() {
    const message = this.reliable.shift() || this.unreliable.shift();
    if (message) this.queuedBytes -= message.data.length;
    return message;
  }
  receiveDatagram(value) {
    if (value.length < 5 || value.length > MAX_DATAGRAM + 4) { this.stats.dropped++; return; }
    const sequence = new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0, true);
    if (this.receiveSequence !== null) {
      const distance = (sequence - this.receiveSequence) >>> 0;
      if (!distance || distance >= 0x80000000) { this.stats.dropped++; return; }
    }
    this.receiveSequence = sequence;
    this.enqueue(2, value.slice(4)); this.stats.datagramsReceived++;
  }
  canSend() { return this.open && !this.writing; }
  finish(reason) {
    if (!this.open) return;
    this.open = false;
    this.notify({ id: this.id, state: 'closed', transport: this.transport, reason });
    this.closePeer();
  }
  fail(error) { this.finish(error?.message || String(error)); }
  close() { this.finish('Disconnected'); }
}

class WebTransportConnection extends Connection {
  constructor(id, session, stream, notify) {
    super(id, notify, 'webtransport');
    this.session = session;
    this.writer = stream.writable.getWriter();
    this.datagramWriter = session.datagrams.writable.getWriter();
    this.reader = stream.readable.getReader();
    this.datagramReader = session.datagrams.readable.getReader();
    session.closed.then(info => this.finish(info?.reason || 'Connection closed'), error => this.finish(error.message));
    this.readReliable().catch(error => this.fail(error));
    this.readDatagrams().catch(error => this.fail(error));
  }
  async readReliable() {
    const decoder = new MessageDecoder(data => { this.enqueue(1, data); this.stats.reliableReceived++; });
    try {
      while (this.open) {
        const { value, done } = await this.reader.read();
        if (done) { decoder.finish(); this.finish('Reliable stream closed'); break; }
        decoder.push(value);
      }
    } finally { this.reader.releaseLock(); }
  }
  async readDatagrams() {
    try {
      while (this.open) {
        const { value, done } = await this.datagramReader.read();
        if (done) break;
        this.receiveDatagram(value);
      }
    } finally { this.datagramReader.releaseLock(); }
  }
  send(kind, data) {
    if (!this.open) return -1;
    if (kind === 1) {
      if (this.writing) return 0;
      this.writing = true;
      this.writer.write(frameMessage(data)).then(() => {
        this.writing = false; this.stats.reliableSent++;
      }, error => { this.writing = false; this.fail(error); });
      return 1;
    }
    // Never queue a growing backlog of stale game updates under congestion.
    if (this.datagramWrites >= 2 || data.length > MAX_DATAGRAM) { this.stats.dropped++; return 0; }
    const frame = new Uint8Array(data.length + 4);
    if (frame.length > (this.session.datagrams.maxDatagramSize || 1200)) { this.stats.dropped++; return 0; }
    new DataView(frame.buffer).setUint32(0, this.sendSequence++ >>> 0, true);
    frame.set(data, 4); this.datagramWrites++;
    this.datagramWriter.write(frame).then(() => {
      this.datagramWrites--; this.stats.datagramsSent++;
    }, error => { this.datagramWrites--; this.fail(error); });
    return 1;
  }
  closePeer() {
    // The session owns its streams; cancelling the native datagram reader
    // separately can double-close its controller when QUIC reports closure.
    this.session.close({ closeCode: 0, reason: 'Quake connection closed' });
  }
}

export const SOCKET_PROTOCOL = 'quake-v1';
const MAX_SOCKET_BUFFER = 64 * 1024;
class WebSocketConnection extends Connection {
  constructor(id, socket, notify) {
    super(id, notify, 'websocket');
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    this.onMessage = ({ data }) => {
      if (!this.open) return;
      try {
        if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) throw new Error('Expected a binary game message');
        const frame = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        if (frame.length < 2 || frame.length > MAX_MESSAGE + 1) throw new Error('Invalid game message size');
        if (frame[0] === 1) { this.enqueue(1, frame.slice(1)); this.stats.reliableReceived++; }
        else if (frame[0] === 2) this.receiveDatagram(frame.subarray(1));
        else throw new Error('Invalid game message type');
      } catch (error) { this.fail(error); }
    };
    socket.addEventListener('message', this.onMessage);
    socket.addEventListener('close', event => this.finish(event.reason || 'Connection closed'), { once: true });
    socket.addEventListener('error', () => this.finish('Multiplayer connection lost'), { once: true });
  }
  canSend() { return this.open && this.socket.readyState === 1 && this.socket.bufferedAmount < MAX_SOCKET_BUFFER; }
  send(kind, data) {
    if (!this.open || this.socket.readyState !== 1) return -1;
    if (kind !== 1 && kind !== 2) return -1;
    if (!data.length || data.length > (kind === 1 ? MAX_MESSAGE : MAX_DATAGRAM)) return -1;
    if (kind === 1 && !this.canSend()) return 0;
    // TCP cannot discard bytes already sent. Drop new updates before send()
    // when it is congested, rather than build an unbounded stale-update queue.
    if (kind === 2 && this.socket.bufferedAmount > 2 * MAX_DATAGRAM) { this.stats.dropped++; return 0; }
    const frame = new Uint8Array(data.length + (kind === 1 ? 1 : 5));
    frame[0] = kind;
    if (kind === 2) new DataView(frame.buffer).setUint32(1, this.sendSequence++ >>> 0, true);
    frame.set(data, kind === 1 ? 1 : 5);
    try {
      this.socket.send(frame);
      if (kind === 1) this.stats.reliableSent++; else this.stats.datagramsSent++;
      return 1;
    } catch (error) { this.fail(error); return -1; }
  }
  closePeer() {
    this.socket.removeEventListener('message', this.onMessage);
    this.socket.close(1000, 'Quake connection closed');
  }
}

export function createQuakeTransport(notify = () => {}) {
  const connections = new Map();
  const pending = [];
  let nextId = 1, preparedId = 0;
  const register = (connection, server) => {
    const id = connection.id;
    connections.set(id, connection);
    if (server) pending.push(id);
    else { if (preparedId) { connections.get(preparedId)?.close(); connections.delete(preparedId); } preparedId = id; }
    notify({ id, state: 'ready', transport: connection.transport });
    return id;
  };
  return {
    attach(session, stream, server = false) {
      const id = nextId++;
      return register(new WebTransportConnection(id, session, stream, notify), server);
    },
    attachSocket(socket, server = false) { return register(new WebSocketConnection(nextId++, socket, notify), server); },
    prepared() { const id = preparedId; preparedId = 0; return id; },
    accept() {
      while (pending.length) { const id = pending.shift(); if (this.alive(id)) return id; this.close(id); }
      return 0;
    },
    alive(id) { return connections.get(id)?.open || false; },
    canSend(id) { return Boolean(connections.get(id)?.canSend()); },
    receive(id) { return connections.get(id)?.receive(); },
    send(id, kind, data) { return connections.get(id)?.send(kind, data) ?? -1; },
    close(id) { connections.get(id)?.close(); connections.delete(id); if (preparedId === id) preparedId = 0; },
    closeAll() { for (const id of connections.keys()) this.close(id); pending.length = 0; },
    snapshot() { return [...connections.values()].map(c => ({ id: c.id, open: c.open, transport: c.transport, queuedBytes: c.queuedBytes, ...c.stats })); },
  };
}

async function connectWebTransport(transport, config, timeoutMs, onProgress) {
  const url = new URL(config.url);
  if (url.protocol !== 'https:') throw new Error('A multiplayer server needs an HTTPS WebTransport URL.');
  const options = { requireUnreliable: true, congestionControl: 'low-latency' };
  if (config.certificateHash) {
    if (!/^[a-f\d]{64}$/i.test(config.certificateHash)) throw new Error('Invalid multiplayer certificate fingerprint');
    options.serverCertificateHashes = [{ algorithm: 'sha-256', value: Uint8Array.from(config.certificateHash.match(/.{2}/g), hex => parseInt(hex, 16)) }];
  }
  const session = new WebTransport(url.href, options);
  // Attach a rejection handler immediately, including before ready resolves.
  session.closed.catch(() => {});
  let stage = 'WebTransport handshake', timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${stage} timed out`)), timeoutMs); });
  const closed = session.closed.then(info => { throw new Error(info?.reason || 'Connection closed during joining'); });
  try {
    await Promise.race([session.ready, timeout, closed]);
    stage = 'WebTransport game channel'; onProgress('Opening the multiplayer game channel…');
    const stream = await Promise.race([session.createBidirectionalStream(), timeout, closed]);
    return transport.attach(session, stream);
  } catch (error) {
    session.close();
    throw new Error(`Could not connect to the multiplayer server: ${error.message}`);
  } finally { clearTimeout(timer); }
}

async function connectWebSocket(transport, url, timeoutMs) {
  const target = new URL(url);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname);
  if (target.protocol !== 'wss:' && !(target.protocol === 'ws:' && local)) throw new Error('A multiplayer connection needs a secure WSS URL');
  const socket = new WebSocket(target.href, SOCKET_PROTOCOL);
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); socket.removeEventListener('open', open); socket.removeEventListener('error', error); socket.removeEventListener('close', close); };
      const open = () => { cleanup(); socket.protocol === SOCKET_PROTOCOL ? resolve() : reject(new Error('Incompatible multiplayer server')); };
      const error = () => { cleanup(); reject(new Error('Could not reach the multiplayer server. Please try joining again.')); };
      const close = event => { cleanup(); reject(new Error(event.reason || 'Multiplayer server closed the connection')); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Multiplayer connection timed out. Please try joining again.')); }, timeoutMs);
      socket.addEventListener('open', open); socket.addEventListener('error', error); socket.addEventListener('close', close);
    });
    return transport.attachSocket(socket);
  } catch (error) {
    // CONNECTING sockets may report an asynchronous error when closed.
    socket.addEventListener('error', () => {}, { once: true }); socket.close();
    throw error;
  }
}

export async function connectQuake(transport, config, { timeoutMs = 10000, onProgress = () => {}, onFallback = () => {}, forceWebSocket = false } = {}) {
  if (!forceWebSocket && typeof globalThis.WebTransport === 'function') {
    onProgress('Connecting to multiplayer…');
    try { return await connectWebTransport(transport, config, timeoutMs, onProgress); }
    catch (error) {
      if (!config.websocketUrl || typeof globalThis.WebSocket !== 'function') throw error;
      onFallback(error.message);
    }
  }
  if (config.websocketUrl && typeof globalThis.WebSocket === 'function') {
    onProgress('Trying a compatible multiplayer connection…');
    return connectWebSocket(transport, config.websocketUrl, timeoutMs);
  }
  throw new Error('This server needs WebTransport support. This browser has no compatible multiplayer connection.');
}
