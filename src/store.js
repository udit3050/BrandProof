'use strict';
const fs = require('fs');
const path = require('path');
// Tiny JSON-file store. Atomic write (tmp file + rename). Replaceable by MongoDB later.
class Store {
  constructor(file) { this.file = file; this.data = null; }
  load(seedFn) {
    if (fs.existsSync(this.file)) this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    else { this.data = seedFn(); this.save(); }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
module.exports = { Store };
