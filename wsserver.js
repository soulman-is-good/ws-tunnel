const https = require("https");
const net = require("net");
const dgram = require("dgram");
const url = require("url");
const fs = require("fs");
const {parseArgs} = require("util");
const WebSocket = require("ws");
const log4js = require("log4js");
const { Code } = require("./src/consts/common");
const { wrapBuffer, ctrlToString } = require("./src/utils/common");

const logger = log4js.getLogger("Server");
const connections = [];
const data = {};
const findFreeSessionID = () => {
  const idx = connections.findIndex((conn) => conn == null);

  return idx === -1 ? connections.length : idx;
};

function main() {
  const cmd = parseArgs({
    strict: true,
    allowPositionals: false,
    args: process.argv.slice(2),
    options: {
      config: {
        type: "string",
        short: "c",
        default: "./wserver_config.json",
      },
    },
  });
  const config = JSON.parse(fs.readFileSync(cmd.values.config, "utf8"));
  log4js.configure(config.log.config);

  const server = https.createServer({
    key: fs.readFileSync(config.key),
    cert: fs.readFileSync(config.cert),
  });

  logger.level = config.log.level;

  // init ports
  config.ports.forEach((portC) => {
    const path = `/${portC.port}${portC.proto[0]}`;
    const port = portC.port;

    data[path] = {
      /**
       * @returns boolean true - when connection is established false - no client listenting
       */
      toWebSocket: (buf) => {
        if (data[path].websocket) {
          data[path].websocket.send(buf);
          return true;
        }
        return false;
      },
    };
    data[path].path = path;
    data[path].proto = portC.proto;
    data[path].port = port;
    data[path].wssrv = createWebSocketServer(data[path]);
    data[path].server = createServer(portC.proto, port, data[path]);
  });

  server.on("connection", (sock) =>
    logger.debug("Connection from", sock.address())
  );

  // Setup main server
  server.on("upgrade", (request, socket, head) => {
    const pathname = url.parse(request.url).pathname;
    const conf = data[pathname];

    if (!conf) {
      return;
    }
    conf.wssrv.handleUpgrade(request, socket, head, function done(ws) {
      conf.wssrv.emit("connection", ws, request);
    });
  });

  server.listen(config.port, config.host, () => {
    logger.info(
      "Websocket tunnel server is listening on port",
      server.address().port
    );
    logger.info(" Following tunnels were created:");
    Object.keys(data).forEach((path) => {
      const conf = data[path];
      logger.info(
        `    => ${conf.proto} server on ${
          conf.port
        } port listeing web socket path ${server.address().address}:${
          server.address().port
        }${path}`
      );
    });
  });
}
// Helper functions
function createServer(proto, port, conf) {
  let server;

  if (proto === "tcp") {
    server = net.createServer();
    // TODO: Make listening host configurable1
    server.listen(port, "0.0.0.0");
    server.on("error", logger.error);
    server.on("connection", (sock) => {
      const sessionID = findFreeSessionID();
      connections[sessionID] = sock;
      // If corresponding ws exists - send data there and receive
      if (conf.toWebSocket(wrapBuffer(Code.CONNECT, sessionID))) {
        sock.on("data", (msg) => {
          conf.toWebSocket(wrapBuffer(Code.MSG, sessionID, msg));
        });
        sock.on("close", () => {
          conf.toWebSocket(wrapBuffer(Code.CLOSE, sessionID));
        });
      } else {
        // Can't conntect to ws - terminate
        sock.destroy();
        connections[sessionID] = null;
      }
    });
  } else {
    server = dgram.createSocket("udp4");
    server.bind(port, "0.0.0.0");
    server.on("error", logger.error);
    const sessionID = findFreeSessionID();
    connections[sessionID] = server;
    server.on("message", (buf, rinfo) => {
      connections[sessionID].host = rinfo.address;
      connections[sessionID].port = rinfo.port;
      conf.toWebSocket(wrapBuffer(Code.MSG, sessionID, buf));
    });
  }

  return server;
}

function createWebSocketServer(conf) {
  const srv = new WebSocket.Server({ noServer: true });

  srv.on("connection", (sock, req) => {
    conf.websocket = sock;
    conf.request = req;

    if (req.url.endsWith("u")) {
      initDatagramm(sock);
    }
    sock.on("message", (msg) => {
      const ctrl = msg[0];
      const sessionID = msg.readUInt32BE(1);
      const cli = connections[sessionID];

      if (!cli) {
        logger.error(
          "Wrong session ID, no connection there",
          sessionID,
          "from",
          sock.url
        );
        return;
      }
      const data = msg.subarray(5);
      logger.trace(sessionID, "=>", ctrlToString(ctrl));

      if (ctrl === Code.MSG) {
        if (conf.proto === "tcp") {
          cli.write(data);
        } else {
          cli.send(data, cli.port, cli.host);
        }
      } else if (ctrl === Code.CLOSE) {
        logger.debug("Closing connection");
        cli.end();
        connections[sessionID] = null;
      } else {
        logger.error("Unknown control byte", ctrl, "from", sock.url);
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
  });
}

main();
