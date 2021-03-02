# WebSocket tunnel Node.JS app

This project aim it to provide a tunnel connection via websocket in order to reuse http proxy

## How this works

TBD diagram
## How to use

Let's say you want to be able to connect to remote RDP server behind the proxy.
RDP server by default listening on 3389 port on TCP and UDP protocols.

**First** you need to create certificates for the server unless you already have them.
If not, just run `npm run generate:keys`. This will run `openssl` command to generate _cert_ and _key_ files under _keys_ folder.

Then provide configs files (there are _.example.json_ files in the root).

On remote public server `wserver_config.json`:
```json
{
  "host": "0.0.0.0",
  "port": 9999,
  "key": "./keys/server.key",
  "cert": "./keys/server.cert",
  "ports": [
    {
      "port": 3389,
      "proto": "tcp"
    },
    {
      "port": 3389,
      "proto": "udp"
    }
  ]
}
```
Then run on server `npm run server`

On client machine where RDP server is running `wclient_config.json`:
```json
{
  "host": "some.remote.server",
  "port": 8888,
  "paths": [
    {
      "path": "/3389t",
      "host": "127.0.0.1",
      "port": 3389,
      "proto": "tcp"
    },
    {
      "path": "/3389u",
      "host": "127.0.0.1",
      "port": 3389,
      "proto": "udp"
    }
  ]
}
```
And then run on client `npm run client`

After that you will be able to connect to client machine's RDP Server via 
