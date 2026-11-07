// Compact SDP <-> short string, so a whole WebRTC handshake fits in one QR code.
// Only what a data-channel-only, host-candidate connection needs is kept.
(function (root) {
  const hex = s => s.replace(/:/g, '');
  const unhex = s => s.match(/../g).join(':').toUpperCase();

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
    if (!cands.length) throw new Error('No local network address found. Join a Wi-Fi or hotspot first.');
    return 'LD1' + JSON.stringify([ufrag, pwd, hex(fp), { actpass: 'o', active: 'a', passive: 'p' }[setup], cands.map(([ip, p]) => ip + '/' + p)]);
  }

  function unpack(str) {
    if (!str.startsWith('LD1')) throw new Error('Not a LocalDrop code');
    const [ufrag, pwd, fp, s, cands] = JSON.parse(str.slice(3));
    const setup = { o: 'actpass', p: 'passive', a: 'active' }[s];
    const lines = [
      'v=0', 'o=- 1 1 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
      'a=ice-ufrag:' + ufrag, 'a=ice-pwd:' + pwd, 'a=fingerprint:sha-256 ' + unhex(fp),
      'a=setup:' + setup, 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144',
    ];
    cands.forEach((c, i) => {
      const [ip, port] = c.split('/');
      lines.push(`a=candidate:${i + 1} 1 udp ${2113937151 - i} ${ip} ${port} typ host`);
    });
    return lines.join('\r\n') + '\r\n';
  }

  root.Signal = { pack, unpack };
  if (typeof module !== 'undefined') module.exports = root.Signal;
})(typeof self !== 'undefined' ? self : globalThis);
