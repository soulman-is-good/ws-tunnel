const WebSocket = require('ws');
const net = require('net');
const dgram = require('dgram');
const { Code } = require('./src/consts/common');
const { wrapBuffer, ctrlToString } = require('./src/utils/common');
const config = require('./wclient_config.json');

const connections = [];

config.paths.forEach(pathC => {
  const { path, port, host, proto } = pathC;
  const ws = new WebSocket(`ws://${config.host}:${config.port}${path}`);
  let sock;

  ws.on('open', function open() {
    console.log(`Connected to server on ${path}`);
  });
  ws.on('message', data => {
    const ctrl = data[0];
    const sessionID = data.readUInt32BE(1);
    const msg = data.subarray(5);
    let sock;

    console.log(sessionID, '=>', ctrlToString(ctrl));
    if (ctrl === Code.CONNECT) {
      sock = createClient(port, host, proto);
      connections[sessionID] = sock;

      if (proto === 'tcp') {
        sock.on('data', data => {
          ws.send(wrapBuffer(Code.MSG, sessionID, data), err => err && console.error(err));
        });
        sock.on('close', () => {
          ws.send(wrapBuffer(Code.CLOSE, sessionID));
        });
      } else {
        console.log('INIT DGRAM');
        sock.on('message', data => {
          ws.send(wrapBuffer(Code.MSG, sessionID, data));
        });
      }
      return;
    }
    sock = connections[sessionID];

    if (!sock) {
      console.error('Socket is not opened', sessionID, path);
      return;
    }

    if (proto === 'tcp') {
      if (ctrl === Code.MSG) {
        console.log('sending to tcp');
        sock.write(msg);
      } else {
        console.log('closing tcp');
        sock.end();
      }
    } else {
      sock.send(msg, port, host);
    }
  });
  ws.on('close', () => {
    sock.end();
  });
});

function createClient(port, host, proto) {
  if (proto === 'tcp') {
    return net.createConnection(port, host);
  }

  return dgram.createSocket('udp4');
}
