// Direct WebTransport driver for Quake's reliable/unreliable message interface.
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
  constructor(id, session, stream, notify) {
    this.id = id; this.session = session; this.notify = notify;
    this.open = true; this.writing = false; this.datagramWrites = 0;
    this.reliable = []; this.unreliable = []; this.queuedBytes = 0;
    this.sendSequence = 0; this.receiveSequence = null;
    this.stats = { reliableSent: 0, reliableReceived: 0, datagramsSent: 0, datagramsReceived: 0, dropped: 0 };
    this.writer = stream.writable.getWriter();
    this.datagramWriter = session.datagrams.writable.getWriter();
    this.reader = stream.readable.getReader();
    this.datagramReader = session.datagrams.readable.getReader();
    session.closed.then(info => this.finish(info?.reason || 'Connection closed'), error => this.finish(error.message));
    this.readReliable().catch(error => this.fail(error));
    this.readDatagrams().catch(error => this.fail(error));
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
        if (value.length < 5 || value.length > MAX_DATAGRAM + 4) { this.stats.dropped++; continue; }
        const sequence = new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0, true);
        if (this.receiveSequence !== null) {
          const distance = (sequence - this.receiveSequence) >>> 0;
          if (!distance || distance >= 0x80000000) { this.stats.dropped++; continue; }
        }
        this.receiveSequence = sequence;
        this.enqueue(2, value.slice(4)); this.stats.datagramsReceived++;
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
  finish(reason) {
    if (!this.open) return;
    this.open = false;
    this.notify({ id: this.id, state: 'closed', reason });
    this.session.close({ closeCode: 0, reason: 'Quake connection closed' });
  }
  fail(error) { this.finish(error?.message || String(error)); }
  close() {
    this.finish('Disconnected');
    // Closing the session closes its streams. Cancelling the library's datagram
    // reader first double-closes its controller when QUIC later reports closure.
  }
}

export function createQuakeTransport(notify = () => {}) {
  const connections = new Map();
  const pending = [];
  let nextId = 1, preparedId = 0;
  return {
    attach(session, stream, server = false) {
      const id = nextId++;
      const connection = new Connection(id, session, stream, notify);
      connections.set(id, connection);
      if (server) pending.push(id);
      else { if (preparedId) this.close(preparedId); preparedId = id; }
      notify({ id, state: 'ready' });
      return id;
    },
    prepared() { const id = preparedId; preparedId = 0; return id; },
    accept() {
      while (pending.length) { const id = pending.shift(); if (this.alive(id)) return id; this.close(id); }
      return 0;
    },
    alive(id) { return connections.get(id)?.open || false; },
    canSend(id) { const c = connections.get(id); return Boolean(c?.open && !c.writing); },
    receive(id) { return connections.get(id)?.receive(); },
    send(id, kind, data) { return connections.get(id)?.send(kind, data) ?? -1; },
    close(id) { connections.get(id)?.close(); connections.delete(id); if (preparedId === id) preparedId = 0; },
    closeAll() { for (const id of connections.keys()) this.close(id); pending.length = 0; },
    snapshot() { return [...connections.values()].map(c => ({ id: c.id, open: c.open, queuedBytes: c.queuedBytes, ...c.stats })); },
  };
}

export async function connectQuake(transport, config) {
  if (!globalThis.WebTransport) throw new Error('This browser does not support WebTransport. Use a current Chrome, Edge, Firefox, or Safari.');
  const url = new URL(config.url);
  if (url.protocol !== 'https:') throw new Error('A multiplayer server needs an HTTPS WebTransport URL.');
  const options = { requireUnreliable: true, congestionControl: 'low-latency' };
  if (config.certificateHash) {
    options.serverCertificateHashes = [{ algorithm: 'sha-256', value: Uint8Array.from(config.certificateHash.match(/.{2}/g), hex => parseInt(hex, 16)) }];
  }
  const session = new WebTransport(url.href, options);
  // Attach a rejection handler immediately, including before ready resolves.
  session.closed.catch(() => {});
  const timeout = setTimeout(() => session.close({ closeCode: 1, reason: 'Connection timed out' }), 10000);
  try {
    await session.ready;
    const stream = await session.createBidirectionalStream();
    return transport.attach(session, stream);
  } catch (error) {
    session.close();
    throw new Error(`Could not connect to the multiplayer server: ${error.message}`);
  } finally { clearTimeout(timeout); }
}
