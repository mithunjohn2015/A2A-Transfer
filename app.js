const $ = s => document.querySelector(s);
const CHUNK = 64 * 1024;               // frame size; matches the max-message-size we advertise
const BLOCK = 1024 * 1024;             // a file is cut into blocks; each block rides on ONE channel
const NDATA = 8;                       // max extra data channels besides the control channel; the speed test picks how many to use
const HIGH = 8 * 1024 * 1024, LOW = 2 * 1024 * 1024;

let pc, dc, data = [], best = 0, benchGot = 0, benchTotal = 0, waiters = {}, stream, scanning = false, sendQueue = Promise.resolve(), incoming = null, wake = null;

const show = id => document.querySelectorAll('main > section').forEach(s => s.hidden = s.id !== id);
const status = (t, cls = '') => {
  $('#status').textContent = t;
  $('#pill').className = 'pill ' + (cls || (/…$/.test(t) ? 'busy' : ''));
};
const steps = n => document.querySelectorAll('.step').forEach(st => st.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < n)));
const platform = () => /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'This phone';
const EMPTY = $('#list').innerHTML;
const fmt = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB'
  : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';

// ---- camera / QR ---------------------------------------------------------
// Camera permission must be granted BEFORE creating the connection: browsers
// only reveal real LAN IPs (instead of mDNS .local aliases) once it is.
async function openCamera() {
  if (stream) return;
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
}
function closeCamera() {
  scanning = false;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
}

function drawQR(text) {
  const qr = qrcode(0, 'L');
  qr.addData(text); qr.make();
  const n = qr.getModuleCount(), px = 6, c = $('#qr');
  c.width = c.height = n * px;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) g.fillRect(x * px, y * px, px, px);
}

function scanQR(prompt) {
  return new Promise(async (resolve, reject) => {
    try { await openCamera(); } catch (e) { return reject(new Error('Camera access is needed to scan the code.')); }
    $('#scanHelp').textContent = prompt;
    show('scan');
    const v = $('#vid'); v.srcObject = stream; await v.play();
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    scanning = true;
    const tick = () => {
      if (!scanning) return reject(new Error('cancelled'));
      if (v.videoWidth) {
        cv.width = v.videoWidth; cv.height = v.videoHeight;
        cx.drawImage(v, 0, 0);
        const img = cx.getImageData(0, 0, cv.width, cv.height);
        const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (r && r.data.startsWith('LD1')) { scanning = false; return resolve(r.data); }
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

// ---- WebRTC (no STUN, no signaling server: LAN host candidates only) -----
function newPC() {
  pc = new RTCPeerConnection({ iceServers: [] });
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') fail('Connection failed. Are both phones on the same Wi-Fi/hotspot?');
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') disconnected();
  };
}
function gathered() {
  return new Promise(res => {
    if (pc.iceGatheringState === 'complete') return res();
    const done = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', done); res(); } };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(res, 4000);
  });
}
// 'ctl' carries JSON control frames (and is the single-channel fallback for data);
// 'd0'..'dN' carry only binary block frames.
function attach(ch) {
  ch.binaryType = 'arraybuffer'; ch.bufferedAmountLowThreshold = LOW;
  ch.onmessage = onMessage;
  if (ch.label !== 'ctl') { data.push(ch); return; }
  dc = ch;
  dc.onopen = () => {
    closeCamera(); show('xfer'); status('Connected', 'ok');
    $('#list').innerHTML = EMPTY; $('#meName').textContent = platform();
    dc.send(JSON.stringify({ t: 'hello', p: platform() }));
    navigator.wakeLock?.request('screen').then(l => wake = l).catch(() => {});
  };
  dc.onclose = disconnected;
}
function createChannels() {
  attach(pc.createDataChannel('ctl', { ordered: true }));
  for (let i = 0; i < NDATA; i++) {
    try { attach(pc.createDataChannel('d' + i, { ordered: true })); } catch {}   // optional: ignore failures
  }
}
function fail(msg) { teardown(); show('home'); status(msg, 'bad'); }
function disconnected() { if (!pc) return; teardown(); show('home'); status('Disconnected'); }
function teardown() {
  closeCamera();
  try { dc?.close(); pc?.close(); } catch {}
  dc = pc = null; data = []; best = 0; benchGot = benchTotal = 0; incoming = null;
  Object.values(waiters).forEach(w => w.rej(new Error('disconnected'))); waiters = {};
  wake?.release?.().catch(() => {}); wake = null;
}

async function host() {
  try {
    status('Allow camera access…'); await openCamera();
    newPC(); createChannels();
    await pc.setLocalDescription(await pc.createOffer());
    await gathered();
    drawQR(Signal.pack(pc.localDescription.sdp));
    $('#showHelp').textContent = 'Step 1: on the other phone tap “Receive” and scan this code.';
    $('#btnScanReply').hidden = false;
    steps(1); show('show'); status('Waiting for the other phone…');
  } catch (e) { fail(e.message); }
}
async function scanReply() {
  try {
    steps(2);
    const code = await scanQR('Step 2: point the camera at the code shown on the other phone.');
    await pc.setRemoteDescription({ type: 'answer', sdp: Signal.unpack(code) });
    status('Connecting…'); closeCamera(); show('show'); $('#btnScanReply').hidden = true;
    $('#showHelp').textContent = 'Connecting…';
  } catch (e) { if (e.message !== 'cancelled') fail(e.message); }
}
async function join() {
  try {
    steps(1);
    const code = await scanQR('Point the camera at the code shown on the other phone.');
    newPC(); pc.ondatachannel = e => attach(e.channel);
    await pc.setRemoteDescription({ type: 'offer', sdp: Signal.unpack(code) });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered();
    drawQR(Signal.pack(pc.localDescription.sdp));
    $('#btnScanReply').hidden = true;
    $('#showHelp').textContent = 'Last step: hold this code in front of the first phone’s camera. Tap “Next” on that phone.';
    steps(2); show('show'); status('Waiting for the first phone to scan…');
  } catch (e) { if (e.message !== 'cancelled') fail(e.message); }
}
function cancel() { teardown(); show('home'); status('Offline transfer'); }

// ---- file transfer ---------------------------------------------------------
// Wire protocol is described just above sendFile() below. Files go one at a time per direction.
const TYPES = [
  [/\.(jpe?g|png|gif|webp|heic|heif|bmp|svg)$/i, '🖼️', 't-img'], [/\.(mp4|mov|mkv|avi|webm|3gp)$/i, '🎬', 't-vid'],
  [/\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i, '🎵', 't-aud'], [/\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|rtf)$/i, '📄', 't-doc'],
  [/\.(zip|rar|7z|tar|gz)$/i, '🗜️', 't-zip'], [/\.apk$/i, '🤖', 't-zip'],
];
function addItem(name, size, dir) {
  const list = $('#list');
  if (!list.querySelector('.item')) list.textContent = '';
  const sys = name === 'Speed test';
  const [, icon, cls] = TYPES.find(t => t[0].test(name)) || [0, sys ? '⚡' : '📦', sys ? 't-sys' : 't-zip'];
  const el = document.createElement('div'); el.className = 'item ' + dir;
  el.innerHTML = `<div class="ic ${cls}">${icon}<em>${dir === 'up' ? '↑' : '↓'}</em></div>` +
    '<div class="n"><span></span><small></small><div class="bar"><i></i></div></div>';
  el.querySelector('span').textContent = name;
  list.prepend(el);
  const small = el.querySelector('small'), bar = el.querySelector('i');
  return {
    el, progress(done) { small.textContent = fmt(done) + ' / ' + fmt(size); bar.style.width = (size ? done / size * 100 : 100) + '%'; },
    done(msg) { small.textContent = msg; bar.parentNode.remove(); el.classList.add(msg.startsWith('Failed') ? 'bad' : 'done'); },
  };
}

function drain(ch) {
  return new Promise(res => { ch.addEventListener('bufferedamountlow', res, { once: true }); });
}
const expect = type => new Promise((res, rej) => { waiters[type] = { res, rej }; });
const BENCH = 0xFFFFFFFF;               // block index reserved for speed-test frames
const open = () => {
  const o = data.filter(c => c.readyState === 'open').slice(0, best || 1);
  return o.length ? o : [dc];
};


// Speed test, run once per connection before the first send: push the same payload over 1, 2, 4, 8
// channels and keep the smallest count within 10% of the fastest. Receiver just counts bytes.
async function benchRun(n, total) {
  const chans = data.filter(c => c.readyState === 'open').slice(0, n);
  const done = expect('benchdone');
  dc.send(JSON.stringify({ t: 'bench', total }));
  const fr = new Uint8Array(4 + CHUNK); new DataView(fr.buffer).setUint32(0, BENCH);
  const t0 = performance.now();
  for (let sent = 0, i = 0; sent < total; sent += CHUNK, i++) {
    const ch = chans[i % chans.length];
    if (ch.readyState !== 'open') throw new Error('disconnected');
    if (ch.bufferedAmount > HIGH) await drain(ch);
    ch.send(fr);
  }
  await done;
  return total / ((performance.now() - t0) / 1000);
}
async function tune() {
  const avail = data.filter(c => c.readyState === 'open').length;
  if (avail < 2) return best = 1;               // no extra channels: single-channel fallback
  const item = addItem('Speed test', 0, 'up');
  try {
    let total = 4 * 1024 * 1024;
    const res = [];
    await benchRun(avail, total);                 // warm-up (SCTP slow start), result discarded
    for (const n of [1, 2, 4, 8].filter(n => n <= avail)) {
      const bps = await benchRun(n, total);
      res.push([n, bps]);
      if (n === 1) total = Math.max(total, Math.min(48 * 1024 * 1024, bps * 0.6 | 0));   // ~0.6 s per run
      else if (bps < res[res.length - 2][1] * 1.05) break;                              // no gain: stop
    }
    const top = Math.max(...res.map(r => r[1]));
    best = res.find(r => r[1] >= top * 0.9)[0];
    item.done(`Best: ${best} channel${best > 1 ? 's' : ''} · ${(top / 1048576).toFixed(1)} MB/s  (` +
      res.map(r => r[0] + 'ch ' + (r[1] / 1048576).toFixed(0)).join(', ') + ')');
  } catch (e) { best = 1; item.done('Speed test failed, using 1 channel'); }
}

// Protocol (control = JSON on 'ctl'; data = binary on any channel):
//   sender -> {t:'meta', name, size, type}    receiver opens its sink, replies {t:'ready'}
//   sender -> frames: [u32 block index][payload <= 64 KiB]; one block always stays on one channel,
//             so within a block order is guaranteed; blocks may arrive in any order
//   receiver writes each completed block at index*BLOCK, then replies {t:'ack', ok, err}
function sendFile(file) {
  sendQueue = sendQueue.then(async () => {
    const item = addItem(file.name, file.size, 'up');
    try {
      if (!best) await tune();
      const ready = expect('ready'), ack = expect('ack');
      dc.send(JSON.stringify({ t: 'meta', name: file.name, size: file.size, type: file.type }));
      await ready;
      const used = new Set();
      for (let idx = 0; idx * BLOCK < file.size; idx++) {
        const buf = await file.slice(idx * BLOCK, (idx + 1) * BLOCK).arrayBuffer();
        const chans = open();
        const ch = chans.reduce((a, b) => b.bufferedAmount < a.bufferedAmount ? b : a);
        used.add(ch);
        for (let p = 0; p < buf.byteLength; p += CHUNK) {
          if (ch.readyState !== 'open') throw new Error('disconnected');
          if (ch.bufferedAmount > HIGH) await drain(ch);
          const n = Math.min(CHUNK, buf.byteLength - p), fr = new Uint8Array(4 + n);
          new DataView(fr.buffer).setUint32(0, idx);
          fr.set(new Uint8Array(buf, p, n), 4);
          ch.send(fr);
        }
        item.progress(Math.min(file.size, (idx + 1) * BLOCK));
      }
      await ack;
      item.progress(file.size); item.done(`Sent · ${fmt(file.size)} · ${used.size} channel${used.size > 1 ? 's' : ''}`);
    } catch (e) { item.done('Failed: ' + e.message); }
  });
}

// Received data is streamed to the browser's private on-disk storage (OPFS) when available,
// so memory use stays flat for big files. Browsers without it fall back to in-memory blocks.
async function openSink() {
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('incoming', { create: true });
    const fh = await dir.getFileHandle(crypto.randomUUID(), { create: true });
    return { fh, w: await fh.createWritable() };
  } catch { return null; }
}
async function wipeIncoming() {
  try { await (await navigator.storage.getDirectory()).removeEntry('incoming', { recursive: true }); } catch {}
}

function onMessage(ev) {
  if (typeof ev.data === 'string') {
    const m = JSON.parse(ev.data);
    if (m.t === 'hello') $('#youName').textContent = m.p === 'This phone' ? 'Other phone' : m.p;
    else if (m.t === 'meta') startReceive(m);
    else if (m.t === 'bench') { benchTotal = m.total; checkBench(); }
    else if (m.t === 'benchdone') waiters.benchdone?.res();
    else if (m.t === 'ready') waiters.ready?.res();
    else if (m.t === 'ack') m.ok ? waiters.ack?.res() : waiters.ack?.rej(new Error(m.err));
  } else if (new DataView(ev.data).getUint32(0) === BENCH) {
    benchGot += ev.data.byteLength - 4; checkBench();
  } else if (incoming) {
    const f = incoming, buf = ev.data, idx = new DataView(buf).getUint32(0), len = buf.byteLength - 4;
    const need = Math.min(BLOCK, f.size - idx * BLOCK);
    const blk = f.blocks.get(idx) || { parts: [], bytes: 0 };
    f.blocks.set(idx, blk);
    blk.parts.push(new Uint8Array(buf, 4)); blk.bytes += len;
    f.got += len;
    if (blk.bytes > need) f.err = new Error('corrupt block');
    else if (blk.bytes === need) {
      f.blocks.delete(idx);
      const blob = new Blob(blk.parts);
      f.chain = f.chain.then(async () => {
        if (f.sink) await f.sink.w.write({ type: 'write', position: idx * BLOCK, data: blob });
        else f.mem[idx] = blob;
        f.written += need;
        if (f.written === f.size) await finishReceive(f);
      }).catch(e => { f.err = e; return failReceive(f, e); });
    }
    if ((f.got / CHUNK | 0) % 16 === 0) f.item.progress(f.got);
  }
}

function checkBench() {
  if (benchTotal && benchGot >= benchTotal) { benchGot = benchTotal = 0; dc.send(JSON.stringify({ t: 'benchdone' })); }
}

async function startReceive(m) {
  const f = incoming = { ...m, got: 0, written: 0, blocks: new Map(), mem: [], err: null, sink: null,
    item: addItem(m.name, m.size, 'down') };
  f.chain = openSink().then(s => { f.sink = s; });
  await f.chain;
  if (!m.size) await finishReceive(f);          // empty file: nothing will arrive
  dc.send(JSON.stringify({ t: 'ready' }));
}
async function finishReceive(f) {
  if (incoming === f) incoming = null;
  let file;
  if (f.sink) { await f.sink.w.close(); file = await f.sink.fh.getFile(); }
  else file = new File(f.mem, f.name, { type: f.type || 'application/octet-stream' });
  f.mem = null;
  finishDownload(f, file);
  dc.send(JSON.stringify({ t: 'ack', ok: true }));
}
function failReceive(f, e) {
  if (incoming === f) incoming = null;
  f.item.done('Failed: ' + e.message);
  try { dc.send(JSON.stringify({ t: 'ack', ok: false, err: e.message })); } catch {}
}

function finishDownload(f, file) {
  f.item.progress(f.size); f.item.done('Received · ' + fmt(f.size));
  const row = f.item.el;
  const add = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; row.append(b); };
  add('Save', () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = f.name;
    document.body.append(a); a.click(); a.remove();
  });
  if (navigator.canShare?.({ files: [file] }))
    add('Share', () => navigator.share({ files: [file] }).catch(() => {}));   // iOS: "Save to Files / Photos"
}

// ---- wiring ---------------------------------------------------------------
$('#btnHost').onclick = host;
$('#btnJoin').onclick = join;
$('#btnScanReply').onclick = scanReply;
$('#btnCancel1').onclick = cancel;
$('#btnCancel2').onclick = cancel;
$('#btnDisc').onclick = cancel;
$('#btnPick').onclick = () => $('#file').click();
$('#file').onchange = e => { [...e.target.files].forEach(sendFile); e.target.value = ''; };

wipeIncoming();
if (!window.RTCPeerConnection || !navigator.mediaDevices) status('This browser is not supported.', 'bad');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
