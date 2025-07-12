/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from 'http';
import * as net from 'net';
import url from 'url';

const HTTP_REDIRECT = 301;
const SIGN_IN_SUCCESS_URL =
  'https://developers.google.com/gemini-code-assist/auth_success_gemini';
const SIGN_IN_FAILURE_URL =
  'https://developers.google.com/gemini-code-assist/auth_failure_gemini';

/**
 * The data returned by the local auth server helper.
 */
export interface LocalAuthServerResult {
  /** The full redirect URI the local server is listening on. */
  redirectUri: string;
  /** A promise that resolves with the authorization code when the redirect is received. */
  codePromise: Promise<string>;
  /** The HTTP server instance, allowing the caller to close it if needed (e.g., on cancellation). */
  server: http.Server;
}

/**
 * Starts a local HTTP server on an available port to listen for an OAuth2 redirect.
 * This function encapsulates all client-side server logic for the web auth flow.
 *
 * It is a "dumb" listener, meaning it must be provided with the `state` parameter
 * to use for CSRF validation.
 *
 * @param state The unique state string provided by the core runtime for CSRF protection.
 * @param port The specific port number for the server to listen on.
 * @returns A promise that resolves with an object containing the redirect URI, the server
 * instance, and a promise for the authorization code.
 */
export async function listenForOauthCode(
  state: string,
  port: number,
): Promise<LocalAuthServerResult> {
  const redirectUri = `http://localhost:${port}/oauth2callback`;

  let server: http.Server;

  const codePromise = new Promise<string>((resolve, reject) => {
    server = http.createServer((req, res) => {
      // Ensure the server stops listening after handling one request by closing it
      // in all possible resolution/rejection paths.
      const cleanupAndClose = () => {
        server.close();
      };

      try {
        if (!req.url || req.url.indexOf('/oauth2callback') === -1) {
          res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_FAILURE_URL });
          res.end();
          cleanupAndClose();
          return reject(new Error(`Unexpected auth request: ${req.url}`));
        }

        const qs = new url.URL(req.url, 'http://localhost').searchParams;
        const receivedState = qs.get('state');
        const receivedCode = qs.get('code');
        const error = qs.get('error');

        // Validate the state received in the redirect against the state provided by the core runtime.
        if (receivedState !== state) {
          res.end('State mismatch. Possible CSRF attack.');
          cleanupAndClose();
          return reject(new Error('State mismatch. Possible CSRF attack.'));
        }

        if (error) {
          res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_FAILURE_URL });
          res.end();
          cleanupAndClose();
          return reject(new Error(`OAuth Error: ${error}`));
        }

        if (!receivedCode) {
          res.end('No authorization code found in redirect.');
          cleanupAndClose();
          return reject(new Error('No authorization code in redirect.'));
        }

        // Success path: Redirect the user's browser to a success page and resolve the promise.
        res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_SUCCESS_URL });
        res.end();
        cleanupAndClose();
        resolve(receivedCode);
      } catch (e) {
        cleanupAndClose();
        reject(e);
      }
    });

    server.on('error', (e) => reject(e));
    server.listen(port);
  });

  return { redirectUri, codePromise, server: server! };
}

/**
 * Finds and returns an available TCP port on the local machine.
 * This is now exported so the client can reserve a port before constructing
 * the auth URL.
 */
export async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = 0;
    try {
      const server = net.createServer();
      server.listen(0, () => {
        const address = server.address()! as net.AddressInfo;
        port = address.port;
      });
      server.on('listening', () => {
        server.close();
        server.unref();
      });
      server.on('error', (e) => reject(e));
      server.on('close', () => resolve(port));
    } catch (e) {
      reject(e);
    }
  });
}