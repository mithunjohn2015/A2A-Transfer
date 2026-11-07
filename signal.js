// Compact SDP <-> short string, so a whole WebRTC handshake fits in one QR code.
// Only what a data-channel-only, host-candidate connection needs is kept.
(function (root) {
  const hex = s => s.replace(/:/g, '');
  const unhex = s => s.match(/../g).join(':').toUpperCase();

  const b64 = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = t => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const isV4 = ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip);
  const isPrivate = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(ip);
  const SETUP = { actpass: 0, active: 1, passive: 2 }, SETUPN = ['actpass', 'active', 'passive'];

  // LD2: compact binary (IPv4 only) -> base64url, roughly 25% smaller than LD1, so the QR has bigger modules.
  function packBin(ufrag, pwd, fpHex, setup, cands) {
    const te = new TextEncoder(), u = te.encode(ufrag), p = te.encode(pwd);
    const out = [SETUP[setup], u.length, ...u, p.length, ...p];
    for (let i = 0; i < 64; i += 2) out.push(parseInt(fpHex.substr(i, 2), 16));
    out.push(cands.length);
    for (const [ip, port] of cands) out.push(...ip.split('.').map(Number), port >> 8, port & 255);
    return 'LD2' + b64(Uint8Array.from(out));
  }
  function unpackBin(str) {
    const d = unb64(str.slice(3)), td = new TextDecoder();
    let i = 0;
    const setup = SETUPN[d[i++]];
    const ul = d[i++], ufrag = td.decode(d.slice(i, i += ul));
    const pl = d[i++], pwd = td.decode(d.slice(i, i += pl));
    const fp = [...d.slice(i, i += 32)].map(b => b.toString(16).padStart(2, '0')).join('');
    const n = d[i++], cands = [];
    for (let k = 0; k < n; k++, i += 6) cands.push([d.slice(i, i + 4).join('.'), (d[i + 4] << 8) | d[i + 5]]);
    return { ufrag, pwd, fp, setup, cands };
  }

  function pack(sdp) {
    const g = re => (sdp.match(re) || [])[1];
    const ufrag = g(/a=ice-ufrag:(\S+)/), pwd = g(/a=ice-pwd:(\S+)/);
    const fp = g(/a=fingerprint:sha-256 (\S+)/), setup = g(/a=setup:(\S+)/);
    if (!ufrag || !pwd || !fp || !setup) throw new Error('SDP is missing ICE/DTLS fields');
    let cands = [...sdp.matchAll(/a=candidate:\S+ \d+ udp \d+ (\S+) (\d+) typ host/gi)]
      .map(m => [m[1], +m[2]])
      .filter(([ip]) => !/^fe80:/i.test(ip));
    const v4 = cands.filter(([ip]) => !ip.includes(':'));
    if (v4.length) cands = v4;               // IPv6 only if there is no IPv4
    const priv = cands.filter(([ip]) => isPrivate(ip));
    if (priv.length) cands = priv.slice(0, 2);   // LAN addresses only; fewer addresses = smaller QR
    if (!cands.length) throw new Error('No local network address found. Join a Wi-Fi or hotspot first.');
    if (cands.every(([ip]) => isV4(ip))) return packBin(ufrag, pwd, hex(fp).toLowerCase(), setup, cands);
    return 'LD1' + JSON.stringify([ufrag, pwd, hex(fp), { actpass: 'o', active: 'a', passive: 'p' }[setup], cands.map(([ip, p]) => ip + '/' + p)]);
  }

  function unpack(str) {
    let ufrag, pwd, fp, setup, cands;
    if (str.startsWith('LD2')) {
      ({ ufrag, pwd, fp, setup, cands } = unpackBin(str));
      cands = cands.map(([ip, port]) => ip + '/' + port);
      fp = fp.toUpperCase();
    } else if (str.startsWith('LD1')) {
      let s; [ufrag, pwd, fp, s, cands] = JSON.parse(str.slice(3));
      setup = { o: 'actpass', p: 'passive', a: 'active' }[s];
    } else throw new Error('Not a LocalDrop code');
    const lines = [
      'v=0', 'o=- 1 1 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
      'a=ice-ufrag:' + ufrag, 'a=ice-pwd:' + pwd, 'a=fingerprint:sha-256 ' + unhex(fp.toUpperCase()),
      'a=setup:' + setup, 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144',
    ];
    cands.forEach((c, i) => {
      const [ip, port] = c.split('/');
      lines.push(`a=candidate:${i + 1} 1 udp ${2113937151 - i} ${ip} ${port} typ host`);
    });
    return lines.join('\r\n') + '\r\n';
  }

  const addrs = str => str.startsWith('LD2')
    ? unpackBin(str).cands.map(([ip, p]) => ip + '/' + p).join(', ')
    : JSON.parse(str.slice(3))[4].join(', ');
  root.Signal = { pack, unpack, addrs };
  if (typeof module !== 'undefined') module.exports = root.Signal;
})(typeof self !== 'undefined' ? self : globalThis);
