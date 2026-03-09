'use strict';

// Shared mutable state between server.js and routes
let n8nAuthCookies = '';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

module.exports = {
  getN8NCookies: () => n8nAuthCookies,
  setN8NCookies: (v) => { n8nAuthCookies = v; },
  getN8NApiKey: () => N8N_API_KEY,
};
