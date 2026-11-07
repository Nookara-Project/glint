const Module = require('module');
const os = require('os');
const orig = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { app: { getPath: () => os.tmpdir(), isPackaged: false, getVersion: () => '0.0.0' }, safeStorage: { isEncryptionAvailable: () => false }, shell: {} };
  return orig.call(this, req, ...rest);
};
