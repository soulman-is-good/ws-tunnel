const WebSocket = require('ws');
const net = require('net');
const dgram = require('dgram');
const url = require('url');
const log4js = require('log4js');
const { HttpProxyAgent } = require('http-proxy-agent');
const { Code } = require('./src/consts/common');
const { wrapBuffer, ctrlToString } = require('./src/utils/common');
const config = require('./wclient_config.json');

// Allow wss connestion to self-signed certificate on server
// WARNING: This make MitM attack possible. Dev only purpose
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

log4js.configure(config.log.config);

const logger = log4js.getLogger("Client");
const connections = [];
const options = {};

logger.level = config.log.level;

if (process.env.HTTP_PROXY) {
  // TODO: replace deprecated parse
  options.agent = new HttpProxyAgent(url.parse(process.env.HTTP_PROXY));
}

config.paths.forEach(pathC => {
  const { path, port, host, proto } = pathC;
  const ws = new WebSocket(`wss://${config.host}:${config.port}${path}`, options);
  let sock;

  ws.on('open', function open() {
    logger.info(`Connected to server on ${path}`);
  });
  ws.on('message', data => {
    const ctrl = data[0];
    const sessionID = data.readUInt32BE(1);
    const msg = data.subarray(5);
    let sock;

    logger.trace(sessionID, '=>', ctrlToString(ctrl));
    if (ctrl === Code.CONNECT) {
      sock = createClient(port, host, proto);
      connections[sessionID] = sock;

      if (proto === 'tcp') {
        sock.on('data', data => {
          ws.send(wrapBuffer(Code.MSG, sessionID, data), err => err && logger.error(err));
        });
        sock.on('close', () => {
          ws.send(wrapBuffer(Code.CLOSE, sessionID));
        });
      } else {
        logger.debug('INIT DGRAM');
        sock.on('message', data => {
          ws.send(wrapBuffer(Code.MSG, sessionID, data));
        });
      }
      return;
    }
    sock = connections[sessionID];

    if (!sock) {
      logger.error('Socket is not opened', sessionID, path);
      return;
    }

    if (proto === 'tcp') {
      if (ctrl === Code.MSG) {
        logger.debug('sending to tcp');
        sock.write(msg);
      } else {
        logger.debug('closing tcp');
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
