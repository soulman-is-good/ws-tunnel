const { Code } = require("../consts/common");

function wrapBuffer(code, sessionID, buf = Buffer.alloc(0)) {
  const header = Buffer.alloc(5);
  header.writeUInt8(code, 0);
  header.writeUInt32BE(sessionID, 1);
  return Buffer.concat([header, buf]);
}

function ctrlToString(num) {
  return Object.keys(Code).find(name => Code[name] === num);
}

module.exports = {
  wrapBuffer,
  ctrlToString,
};
