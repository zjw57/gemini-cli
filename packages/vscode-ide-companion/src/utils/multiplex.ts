/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Writable } from 'stream';

type WriteCallback = (data: string) => void;

/**
 * Creates a writable stream that multiplexes data to multiple destinations.
 *
 * @param destinations A list of callbacks to be called with the data.
 * @returns A writable stream.
 */
export function multiplex(...destinations: WriteCallback[]): Writable {
  return new Writable({
    write(chunk, encoding, callback) {
      const data = chunk.toString();
      for (const destination of destinations) {
        destination(data);
      }
      callback();
    },
  });
}
