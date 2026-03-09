'use strict';

beforeEach(() => {
  jest.resetModules();
  delete process.env.N8N_API_KEY;
});

describe('server-state', () => {
  it('getN8NCookies returns empty string initially', () => {
    const state = require('../server-state');
    expect(state.getN8NCookies()).toBe('');
  });

  it('setN8NCookies and getN8NCookies round-trip', () => {
    const state = require('../server-state');
    state.setN8NCookies('session=abc123; n8n-auth=xyz');
    expect(state.getN8NCookies()).toBe('session=abc123; n8n-auth=xyz');
  });

  it('setN8NCookies overwrites previous value', () => {
    const state = require('../server-state');
    state.setN8NCookies('old=value');
    state.setN8NCookies('new=value');
    expect(state.getN8NCookies()).toBe('new=value');
  });

  it('getN8NApiKey returns value from N8N_API_KEY env var', () => {
    process.env.N8N_API_KEY = 'my-api-key-123';
    const state = require('../server-state');
    expect(state.getN8NApiKey()).toBe('my-api-key-123');
  });

  it('getN8NApiKey returns empty string when env var not set', () => {
    const state = require('../server-state');
    expect(state.getN8NApiKey()).toBe('');
  });
});
