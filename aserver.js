const http = require('http');
const net = require('net');
const dgram = require('dgram');
const url = require('url');
const WebSocket = require('ws');
const { Code } = require('./src/consts/common');
const { wrapBuffer, ctrlToString } = require('./src/utils/common');
const config = require('./wserver_config.json');

const connections = [];
const data = {};
const findFreeSessionID = () => {
  const idx = connections.findIndex(conn => conn == null);

  return idx === -1 ? connections.length : idx;
};

const server = http.createServer();

// init ports
config.ports.forEach(portC => {
  const path = `/${portC.port}${portC.proto[0]}`;
  const port = portC.port;

  data[path] = {
    toWebSocket: buf => {
      if (data[path].websocket) {
        data[path].websocket.send(buf);
      }
    },
  };
  data[path].path = path;
  data[path].proto = portC.proto;
  data[path].port = port;
  data[path].wssrv = createWebSocketServer(data[path]);
  data[path].server = createServer(portC.proto, port, data[path]);
});

// Setup main server
server.on('upgrade', (request, socket, head) => {
  const pathname = url.parse(request.url).pathname;
  const conf = data[pathname];

  if (!conf) {
    return;
  }
  conf.wssrv.handleUpgrade(request, socket, head, function done(ws) {
    conf.wssrv.emit('connection', ws, request);
  });
});

server.listen(config.port, config.host, () => {
  console.log('Websocket tunnel server is listening on port', server.address().port);
  console.log(' Following tunnels were created:');
  Object.keys(data).forEach(path => {
    const conf = data[path];
    console.log(`    => ${conf.proto} server on ${conf.port} port listeing web socket path ${server.address().address}:${server.address().port}${path}`);
  });
});

// Helper functions
function createServer(proto, port, conf) {
  let server;

  if (proto === 'tcp') {
    server = net.createServer();
    server.listen(port, '127.0.0.1');
    server.on('error', console.error);
    server.on('connection', sock => {
      const sessionID = findFreeSessionID();
      connections[sessionID] = sock;
      conf.toWebSocket(wrapBuffer(Code.CONNECT, sessionID));
      sock.on('data', msg => {
        conf.toWebSocket(wrapBuffer(Code.MSG, sessionID, msg));
      });
      sock.on('close', () => {
        conf.toWebSocket(wrapBuffer(Code.CLOSE, sessionID));
      });
    });
  } else {
    server = dgram.createSocket('udp4');
    server.bind(port, '127.0.0.1');
    server.on('error', console.error);
    const sessionID = findFreeSessionID();
    connections[sessionID] = server;
    server.on('message', (buf, rinfo) => {
      connections[sessionID].host = rinfo.address;
      connections[sessionID].port = rinfo.port;
      conf.toWebSocket(wrapBuffer(Code.MSG, sessionID, buf));
    });
  }

  return server;

}

function createWebSocketServer(conf) {
  const srv = new WebSocket.Server({ noServer: true });

  srv.on('connection', (sock, req) => {
    conf.websocket = sock;
    conf.request = req;

    if (req.url.endsWith('u')) {
      initDatagramm(sock);
    }
    sock.on('message', msg => {
      const ctrl = msg[0];
      const sessionID = msg.readUInt32BE(1);
      const cli = connections[sessionID];

      if (!cli) {
        console.error('Wrong session ID, no connection there', sessionID, 'from', sock.url);
        return;
      }
      const data = msg.subarray(5);
      console.log(sessionID, '=>', ctrlToString(ctrl));

      if (ctrl === Code.MSG) {
        if (conf.proto === 'tcp') {
          cli.write(data);
        } else {
          cli.send(data, cli.port, cli.host);
        }
      } else if (ctrl === Code.CLOSE) {
        console.log('Closing conn')
        cli.end();
        connections[sessionID] = null;
      } else {
        console.error('Unknown control byte', ctrl, 'from', sock.url);
      }
    });
  });

  return srv;
}

function initDatagramm(sock) {
  connections.forEach((conn, sessionID) => {
    if (conn instanceof dgram.Socket) {
      sock.send(wrapBuffer(Code.CONNECT, sessionID));
    }
  })
}
