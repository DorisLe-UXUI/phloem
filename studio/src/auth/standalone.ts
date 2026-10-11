// Built to studio/dist/auth.js and loaded by the landing page: window.PhloemAuth = the accounts API.
import * as auth from './core';
(window as unknown as { PhloemAuth: typeof auth }).PhloemAuth = auth;
