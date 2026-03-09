'use strict';

// Shared mutable state between server.js and routes
let n8nAuthCookies = '';

module.exports = {
  getN8NCookies: () => n8nAuthCookies,
  setN8NCookies: (v) => { n8nAuthCookies = v; },
};
