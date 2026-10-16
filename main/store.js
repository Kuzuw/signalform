'use strict';
// Small JSON file store in the app's user data folder.
const fs = require('fs');
const path = require('path');

const ALLOWED = new Set(['presets', 'scenes', 'settings']);
let dir = null;

function init(userData) {
  dir = path.join(userData, 'library');
  fs.mkdirSync(dir, { recursive: true });
}

function file(name) {
  if (!ALLOWED.has(name)) throw new Error('Unknown store: ' + name);
  return path.join(dir, name + '.json');
}

function read(name) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); }
  catch { return null; }
}

function write(name, data) {
  const f = file(name);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
  return true;
}

module.exports = { init, read, write };
