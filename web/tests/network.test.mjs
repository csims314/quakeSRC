import test from 'node:test';
import assert from 'node:assert/strict';
import { frameMessage, MessageDecoder, createQuakeTransport, MAX_MESSAGE } from '../dist/network.js';

test('reliable messages survive arbitrary stream chunk boundaries', () => {
  const messages = [new Uint8Array([1]), Uint8Array.from({ length: 35123 }, (_, i) => i % 251), new Uint8Array([3, 7, 9])];
  const frames = messages.map(frameMessage);
  const wire = new Uint8Array(frames.reduce((sum, frame) => sum + frame.length, 0));
  let offset = 0;
  for (const frame of frames) { wire.set(frame, offset); offset += frame.length; }
  for (const width of [1, 2, 3, 4, 7, 127, 4096, wire.length]) {
    const actual = [];
    const decoder = new MessageDecoder(data => actual.push(data));
    for (let i = 0; i < wire.length; i += width) decoder.push(wire.subarray(i, i + width));
    decoder.finish(); assert.deepEqual(actual, messages);
  }
});

test('invalid, oversized, and truncated reliable frames are rejected', () => {
  for (const length of [0, MAX_MESSAGE + 1, 0xffffffff]) {
    const header = new Uint8Array(4); new DataView(header.buffer).setUint32(0, length, true);
    assert.throws(() => new MessageDecoder(() => {}).push(header), /Invalid/);
  }
  for (const bytes of [new Uint8Array([1]), frameMessage(new Uint8Array([1, 2])).slice(0, -1)]) {
    const decoder = new MessageDecoder(() => {}); decoder.push(bytes);
    assert.throws(() => decoder.finish(), /Truncated/);
  }
  assert.throws(() => frameMessage(new Uint8Array(MAX_MESSAGE + 1)), /Invalid/);
});

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture({ blockWrites = false } = {}) {
  let reliableInput, datagramInput, resolveClosed, closed = false;
  const writes = [], datagrams = [], pending = [];
  const stream = {
    readable: new ReadableStream({ start(c) { reliableInput = c; } }),
    writable: new WritableStream({ write(data) { writes.push(data); if (blockWrites) return new Promise(resolve => pending.push(resolve)); } }),
  };
  const session = {
    closed: new Promise(resolve => { resolveClosed = resolve; }),
    datagrams: {
      maxDatagramSize: 1196,
      readable: new ReadableStream({ start(c) { datagramInput = c; } }),
      writable: new WritableStream({ write(data) { datagrams.push(data); if (blockWrites) return new Promise(resolve => pending.push(resolve)); } }),
    },
    close() {
      if (closed) return; closed = true;
      reliableInput.close(); datagramInput.close(); resolveClosed();
    },
  };
  return {
    stream, session, writes, datagrams,
    reliable(data) { reliableInput.enqueue(data); },
    datagram(sequence, value = 7) {
      const frame = new Uint8Array(5); new DataView(frame.buffer).setUint32(0, sequence, true); frame[4] = value;
      datagramInput.enqueue(frame);
    },
    unblock() { while (pending.length) pending.shift()(); },
  };
}

test('datagrams discard duplicates and stale sequences, including wraparound', async () => {
  const fake = fixture(), network = createQuakeTransport();
  const id = network.attach(fake.session, fake.stream);
  for (const [sequence, data] of [[0xfffffffe, 1], [0xffffffff, 2], [0, 3], [0, 4], [0xffffffff, 5], [1, 6]]) fake.datagram(sequence, data);
  await settle();
  assert.deepEqual([network.receive(id).data[0], network.receive(id).data[0], network.receive(id).data[0], network.receive(id).data[0]], [1, 2, 3, 6]);
  assert.equal(network.receive(id), undefined);
  assert.equal(network.snapshot()[0].dropped, 2);
  network.closeAll(); await settle();
});

test('reliable stream backpressure and bounded datagram writes', async () => {
  const fake = fixture({ blockWrites: true }), network = createQuakeTransport();
  const id = network.attach(fake.session, fake.stream);
  assert.equal(network.send(id, 1, new Uint8Array([9])), 1);
  assert.equal(network.canSend(id), false);
  assert.equal(network.send(id, 1, new Uint8Array([8])), 0);
  assert.equal(network.send(id, 2, new Uint8Array([1])), 1);
  assert.equal(network.send(id, 2, new Uint8Array([2])), 1);
  assert.equal(network.send(id, 2, new Uint8Array([3])), 0);
  await settle(); fake.unblock(); await settle(); fake.unblock(); await settle();
  assert.equal(network.canSend(id), true);
  assert.equal(fake.writes.length, 1);
  assert.equal(fake.datagrams.length, 2);
  network.closeAll(); await settle();
});

test('closing one socket leaves other players intact and clears pending handles', async () => {
  const network = createQuakeTransport(), first = fixture(), second = fixture();
  const one = network.attach(first.session, first.stream, true);
  const two = network.attach(second.session, second.stream, true);
  network.close(one);
  assert.equal(network.accept(), two);
  assert.equal(network.accept(), 0);
  assert.equal(network.alive(one), false);
  assert.equal(network.alive(two), true);
  network.closeAll(); await settle();
  assert.deepEqual(network.snapshot(), []);
});

test('malformed peer frames close only that connection', async () => {
  const network = createQuakeTransport(), fake = fixture();
  const id = network.attach(fake.session, fake.stream);
  fake.reliable(new Uint8Array(4)); await settle();
  assert.equal(network.alive(id), false);
  network.closeAll(); await settle();
});
