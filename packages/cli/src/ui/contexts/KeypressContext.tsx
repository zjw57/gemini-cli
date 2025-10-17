/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@google/gemini-cli-core';
import {
  KittySequenceOverflowEvent,
  logKittySequenceOverflow,
} from '@google/gemini-cli-core';
import { useStdin } from 'ink';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import {
  BACKSLASH_ENTER_DETECTION_WINDOW_MS,
  CHAR_CODE_ESC,
  KITTY_CTRL_C,
  KITTY_KEYCODE_BACKSPACE,
  KITTY_KEYCODE_ENTER,
  KITTY_KEYCODE_NUMPAD_ENTER,
  KITTY_KEYCODE_TAB,
  MAX_KITTY_SEQUENCE_LENGTH,
  KITTY_MODIFIER_BASE,
  KITTY_MODIFIER_EVENT_TYPES_OFFSET,
  MODIFIER_SHIFT_BIT,
  MODIFIER_ALT_BIT,
  MODIFIER_CTRL_BIT,
} from '../utils/platformConstants.js';

import { FOCUS_IN, FOCUS_OUT } from '../hooks/useFocus.js';

const ESC = '\u001B';
export const PASTE_MODE_PREFIX = `${ESC}[200~`;
export const PASTE_MODE_SUFFIX = `${ESC}[201~`;
export const DRAG_COMPLETION_TIMEOUT_MS = 100; // Broadcast full path after 100ms if no more input
export const KITTY_SEQUENCE_TIMEOUT_MS = 50; // Flush incomplete kitty sequences after 50ms
export const SINGLE_QUOTE = "'";
export const DOUBLE_QUOTE = '"';

const ALT_KEY_CHARACTER_MAP: Record<string, string> = {
  '\u00E5': 'a',
  '\u222B': 'b',
  '\u00E7': 'c',
  '\u2202': 'd',
  '\u00B4': 'e',
  '\u0192': 'f',
  '\u00A9': 'g',
  '\u02D9': 'h',
  '\u02C6': 'i',
  '\u2206': 'j',
  '\u02DA': 'k',
  '\u00AC': 'l',
  '\u00B5': 'm',
  '\u02DC': 'n',
  '\u00F8': 'o',
  '\u03C0': 'p',
  '\u0153': 'q',
  '\u00AE': 'r',
  '\u00DF': 's',
  '\u2020': 't',
  '\u00A8': 'u',
  '\u221A': 'v',
  '\u2211': 'w',
  '\u2248': 'x',
  '\u00A5': 'y',
  '\u03A9': 'z',
};

export interface Key {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  paste: boolean;
  sequence: string;
  kittyProtocol?: boolean;
}

export type KeypressHandler = (key: Key) => void;

interface KeypressContextValue {
  subscribe: (handler: KeypressHandler) => void;
  unsubscribe: (handler: KeypressHandler) => void;
}

const KeypressContext = createContext<KeypressContextValue | undefined>(
  undefined,
);

export function useKeypressContext() {
  const context = useContext(KeypressContext);
  if (!context) {
    throw new Error(
      'useKeypressContext must be used within a KeypressProvider',
    );
  }
  return context;
}

export function KeypressProvider({
  children,
  kittyProtocolEnabled,
  config,
  debugKeystrokeLogging,
}: {
  children: React.ReactNode;
  kittyProtocolEnabled: boolean;
  config?: Config;
  debugKeystrokeLogging?: boolean;
}) {
  const { stdin, setRawMode } = useStdin();
  const subscribers = useRef<Set<KeypressHandler>>(new Set()).current;
  const isDraggingRef = useRef(false);
  const dragBufferRef = useRef('');
  const draggingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const subscribe = useCallback(
    (handler: KeypressHandler) => {
      subscribers.add(handler);
    },
    [subscribers],
  );

  const unsubscribe = useCallback(
    (handler: KeypressHandler) => {
      subscribers.delete(handler);
    },
    [subscribers],
  );

  useEffect(() => {
    const clearDraggingTimer = () => {
      if (draggingTimerRef.current) {
        clearTimeout(draggingTimerRef.current);
        draggingTimerRef.current = null;
      }
    };

    const wasRaw = stdin.isRaw;
    if (wasRaw === false) {
      setRawMode(true);
    }

    const keypressStream = new PassThrough();
    let usePassthrough = false;
    const nodeMajorVersion = parseInt(process.versions.node.split('.')[0], 10);
    if (
      nodeMajorVersion < 20 ||
      process.env['PASTE_WORKAROUND'] === '1' ||
      process.env['PASTE_WORKAROUND'] === 'true'
    ) {
      usePassthrough = true;
    }

    let isPaste = false;
    let pasteBuffer = Buffer.alloc(0);
    let kittySequenceBuffer = '';
    let kittySequenceTimeout: NodeJS.Timeout | null = null;
    let backslashTimeout: NodeJS.Timeout | null = null;
    let waitingForEnterAfterBackslash = false;

    // Check if a buffer could potentially be a valid kitty sequence or its prefix
    const couldBeKittySequence = (buffer: string): boolean => {
      // Kitty sequences always start with ESC[.
      if (buffer.length === 0) return true;
      if (buffer === ESC || buffer === `${ESC}[`) return true;

      if (!buffer.startsWith(`${ESC}[`)) return false;

      // Check for known kitty sequence patterns:
      // 1. ESC[<digit> - could be CSI-u or tilde-coded
      // 2. ESC[1;<digit> - parameterized functional
      // 3. ESC[<letter> - legacy functional keys
      // 4. ESC[Z - reverse tab
      const afterCSI = buffer.slice(2);

      // Check if it starts with a digit (could be CSI-u or parameterized)
      if (/^\d/.test(afterCSI)) return true;

      // Check for known single-letter sequences
      if (/^[ABCDHFPQRSZ]/.test(afterCSI)) return true;

      // Check for 1; pattern (parameterized sequences)
      if (/^1;\d/.test(afterCSI)) return true;

      // Anything else starting with ESC[ that doesn't match our patterns
      // is likely not a kitty sequence we handle
      return false;
    };

    // Parse a single complete kitty sequence from the start (prefix) of the
    // buffer and return both the Key and the number of characters consumed.
    // This lets us "peel off" one complete event when multiple sequences arrive
    // in a single chunk, preventing buffer overflow and fragmentation.
    // Parse a single complete kitty/parameterized/legacy sequence from the start
    // of the buffer and return both the parsed Key and the number of characters
    // consumed. This enables peel-and-continue parsing for batched input.
    const parseKittyPrefix = (
      buffer: string,
    ): { key: Key; length: number } | null => {
      // In older terminals ESC [ Z was used as Cursor Backward Tabulation (CBT)
      // In newer terminals the same functionality of key combination for moving
      // backward through focusable elements is Shift+Tab, hence we will
      // map ESC [ Z to Shift+Tab
      // 0) Reverse Tab (legacy): ESC [ Z
      //    Treat as Shift+Tab for UI purposes.
      //    Regex parts:
      //    ^     - start of buffer
      //    ESC [ - CSI introducer
      //    Z     - legacy reverse tab
      const revTabLegacy = new RegExp(`^${ESC}\\[Z`);
      let m = buffer.match(revTabLegacy);
      if (m) {
        return {
          key: {
            name: 'tab',
            ctrl: false,
            meta: false,
            shift: true,
            paste: false,
            sequence: buffer.slice(0, m[0].length),
            kittyProtocol: true,
          },
          length: m[0].length,
        };
      }

      // 1) Reverse Tab (parameterized): ESC [ 1 ; <mods> Z
      //    Parameterized reverse Tab: ESC [ 1 ; <mods> Z
      const revTabParam = new RegExp(`^${ESC}\\[1;(\\d+)Z`);
      m = buffer.match(revTabParam);
      if (m) {
        let mods = parseInt(m[1], 10);
        if (mods >= KITTY_MODIFIER_EVENT_TYPES_OFFSET) {
          mods -= KITTY_MODIFIER_EVENT_TYPES_OFFSET;
        }
        const bits = mods - KITTY_MODIFIER_BASE;
        const alt = (bits & MODIFIER_ALT_BIT) === MODIFIER_ALT_BIT;
        const ctrl = (bits & MODIFIER_CTRL_BIT) === MODIFIER_CTRL_BIT;
        return {
          key: {
            name: 'tab',
            ctrl,
            meta: alt,
            // Reverse tab implies Shift behavior; force shift regardless of mods
            shift: true,
            paste: false,
            sequence: buffer.slice(0, m[0].length),
            kittyProtocol: true,
          },
          length: m[0].length,
        };
      }

      // 2) Parameterized functional: ESC [ 1 ; <mods> (A|B|C|D|H|F|P|Q|R|S)
      // 2) Parameterized functional: ESC [ 1 ; <mods> (A|B|C|D|H|F|P|Q|R|S)
      //    Arrows, Home/End, F1–F4 with modifiers encoded in <mods>.
      const arrowPrefix = new RegExp(`^${ESC}\\[1;(\\d+)([ABCDHFPQSR])`);
      m = buffer.match(arrowPrefix);
      if (m) {
        let mods = parseInt(m[1], 10);
        if (mods >= KITTY_MODIFIER_EVENT_TYPES_OFFSET) {
          mods -= KITTY_MODIFIER_EVENT_TYPES_OFFSET;
        }
        const bits = mods - KITTY_MODIFIER_BASE;
        const shift = (bits & MODIFIER_SHIFT_BIT) === MODIFIER_SHIFT_BIT;
        const alt = (bits & MODIFIER_ALT_BIT) === MODIFIER_ALT_BIT;
        const ctrl = (bits & MODIFIER_CTRL_BIT) === MODIFIER_CTRL_BIT;
        const sym = m[2];
        const symbolToName: { [k: string]: string } = {
          A: 'up',
          B: 'down',
          C: 'right',
          D: 'left',
          H: 'home',
          F: 'end',
          P: 'f1',
          Q: 'f2',
          R: 'f3',
          S: 'f4',
        };
        const name = symbolToName[sym] || '';
        if (!name) return null;
        return {
          key: {
            name,
            ctrl,
            meta: alt,
            shift,
            paste: false,
            sequence: buffer.slice(0, m[0].length),
            kittyProtocol: true,
          },
          length: m[0].length,
        };
      }

      // 3) CSI-u form: ESC [ <code> ; <mods> (u|~)
      // 3) CSI-u and tilde-coded functional keys: ESC [ <code> ; <mods> (u|~)
      //    'u' terminator: Kitty CSI-u; '~' terminator: tilde-coded function keys.
      const csiUPrefix = new RegExp(`^${ESC}\\[(\\d+)(;(\\d+))?([u~])`);
      m = buffer.match(csiUPrefix);
      if (m) {
        const keyCode = parseInt(m[1], 10);
        let modifiers = m[3] ? parseInt(m[3], 10) : KITTY_MODIFIER_BASE;
        if (modifiers >= KITTY_MODIFIER_EVENT_TYPES_OFFSET) {
          modifiers -= KITTY_MODIFIER_EVENT_TYPES_OFFSET;
        }
        const modifierBits = modifiers - KITTY_MODIFIER_BASE;
        const shift =
          (modifierBits & MODIFIER_SHIFT_BIT) === MODIFIER_SHIFT_BIT;
        const alt = (modifierBits & MODIFIER_ALT_BIT) === MODIFIER_ALT_BIT;
        const ctrl = (modifierBits & MODIFIER_CTRL_BIT) === MODIFIER_CTRL_BIT;
        const terminator = m[4];

        // Tilde-coded functional keys (Delete, Insert, PageUp/Down, Home/End)
        if (terminator === '~') {
          let name: string | null = null;
          switch (keyCode) {
            case 1:
              name = 'home';
              break;
            case 2:
              name = 'insert';
              break;
            case 3:
              name = 'delete';
              break;
            case 4:
              name = 'end';
              break;
            case 5:
              name = 'pageup';
              break;
            case 6:
              name = 'pagedown';
              break;
            default:
              break;
          }
          if (name) {
            return {
              key: {
                name,
                ctrl,
                meta: alt,
                shift,
                paste: false,
                sequence: buffer.slice(0, m[0].length),
                kittyProtocol: true,
              },
              length: m[0].length,
            };
          }
        }

        const kittyKeyCodeToName: { [key: number]: string } = {
          [CHAR_CODE_ESC]: 'escape',
          [KITTY_KEYCODE_TAB]: 'tab',
          [KITTY_KEYCODE_BACKSPACE]: 'backspace',
          [KITTY_KEYCODE_ENTER]: 'return',
          [KITTY_KEYCODE_NUMPAD_ENTER]: 'return',
        };

        const name = kittyKeyCodeToName[keyCode];
        if (name) {
          return {
            key: {
              name,
              ctrl,
              meta: alt,
              shift,
              paste: false,
              sequence: buffer.slice(0, m[0].length),
              kittyProtocol: true,
            },
            length: m[0].length,
          };
        }

        // Ctrl+letters and Alt+letters
        if (
          (ctrl || alt) &&
          keyCode >= 'a'.charCodeAt(0) &&
          keyCode <= 'z'.charCodeAt(0)
        ) {
          const letter = String.fromCharCode(keyCode);
          return {
            key: {
              name: letter,
              ctrl,
              meta: alt,
              shift,
              paste: false,
              sequence: buffer.slice(0, m[0].length),
              kittyProtocol: true,
            },
            length: m[0].length,
          };
        }
      }

      // 4) Legacy function keys (no parameters): ESC [ (A|B|C|D|H|F)
      //    Arrows + Home/End without modifiers.
      const legacyFuncKey = new RegExp(`^${ESC}\\[([ABCDHF])`);
      m = buffer.match(legacyFuncKey);
      if (m) {
        const sym = m[1];
        const nameMap: { [key: string]: string } = {
          A: 'up',
          B: 'down',
          C: 'right',
          D: 'left',
          H: 'home',
          F: 'end',
        };
        const name = nameMap[sym]!;
        return {
          key: {
            name,
            ctrl: false,
            meta: false,
            shift: false,
            paste: false,
            sequence: buffer.slice(0, m[0].length),
            kittyProtocol: true,
          },
          length: m[0].length,
        };
      }

      return null;
    };

    const broadcast = (key: Key) => {
      for (const handler of subscribers) {
        handler(key);
      }
    };

    const flushKittyBufferOnInterrupt = (reason: string) => {
      if (kittySequenceBuffer) {
        if (debugKeystrokeLogging) {
          console.log(
            `[DEBUG] Kitty sequence flushed due to ${reason}:`,
            JSON.stringify(kittySequenceBuffer),
          );
        }
        broadcast({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: false,
          sequence: kittySequenceBuffer,
        });
        kittySequenceBuffer = '';
      }
      if (kittySequenceTimeout) {
        clearTimeout(kittySequenceTimeout);
        kittySequenceTimeout = null;
      }
    };

    const handleKeypress = (_: unknown, key: Key) => {
      if (key.sequence === FOCUS_IN || key.sequence === FOCUS_OUT) {
        flushKittyBufferOnInterrupt('focus event');
        return;
      }
      if (key.name === 'paste-start') {
        flushKittyBufferOnInterrupt('paste start');
        isPaste = true;
        return;
      }
      if (key.name === 'paste-end') {
        isPaste = false;
        broadcast({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: true,
          sequence: pasteBuffer.toString(),
        });
        pasteBuffer = Buffer.alloc(0);
        return;
      }

      if (isPaste) {
        pasteBuffer = Buffer.concat([pasteBuffer, Buffer.from(key.sequence)]);
        return;
      }

      if (
        key.sequence === SINGLE_QUOTE ||
        key.sequence === DOUBLE_QUOTE ||
        isDraggingRef.current
      ) {
        isDraggingRef.current = true;
        dragBufferRef.current += key.sequence;

        clearDraggingTimer();
        draggingTimerRef.current = setTimeout(() => {
          isDraggingRef.current = false;
          const seq = dragBufferRef.current;
          dragBufferRef.current = '';
          if (seq) {
            broadcast({ ...key, name: '', paste: true, sequence: seq });
          }
        }, DRAG_COMPLETION_TIMEOUT_MS);

        return;
      }

      const mappedLetter = ALT_KEY_CHARACTER_MAP[key.sequence];
      if (mappedLetter && !key.meta) {
        broadcast({
          name: mappedLetter,
          ctrl: false,
          meta: true,
          shift: false,
          paste: isPaste,
          sequence: key.sequence,
        });
        return;
      }

      if (key.name === 'return' && waitingForEnterAfterBackslash) {
        if (backslashTimeout) {
          clearTimeout(backslashTimeout);
          backslashTimeout = null;
        }
        waitingForEnterAfterBackslash = false;
        broadcast({
          ...key,
          shift: true,
          sequence: '\r', // Corrected escaping for newline
        });
        return;
      }

      if (key.sequence === '\\' && !key.name) {
        // Corrected escaping for backslash
        waitingForEnterAfterBackslash = true;
        backslashTimeout = setTimeout(() => {
          waitingForEnterAfterBackslash = false;
          backslashTimeout = null;
          broadcast(key);
        }, BACKSLASH_ENTER_DETECTION_WINDOW_MS);
        return;
      }

      if (waitingForEnterAfterBackslash && key.name !== 'return') {
        if (backslashTimeout) {
          clearTimeout(backslashTimeout);
          backslashTimeout = null;
        }
        waitingForEnterAfterBackslash = false;
        broadcast({
          name: '',
          sequence: '\\',
          ctrl: false,
          meta: false,
          shift: false,
          paste: false,
        });
      }

      if (['up', 'down', 'left', 'right'].includes(key.name)) {
        broadcast(key);
        return;
      }

      if (
        (key.ctrl && key.name === 'c') ||
        key.sequence === `${ESC}${KITTY_CTRL_C}`
      ) {
        if (kittySequenceBuffer && debugKeystrokeLogging) {
          console.log(
            '[DEBUG] Kitty buffer cleared on Ctrl+C:',
            kittySequenceBuffer,
          );
        }
        kittySequenceBuffer = '';
        if (kittySequenceTimeout) {
          clearTimeout(kittySequenceTimeout);
          kittySequenceTimeout = null;
        }
        if (key.sequence === `${ESC}${KITTY_CTRL_C}`) {
          broadcast({
            name: 'c',
            ctrl: true,
            meta: false,
            shift: false,
            paste: false,
            sequence: key.sequence,
            kittyProtocol: true,
          });
        } else {
          broadcast(key);
        }
        return;
      }

      if (kittyProtocolEnabled) {
        // Clear any pending timeout when new input arrives
        if (kittySequenceTimeout) {
          clearTimeout(kittySequenceTimeout);
          kittySequenceTimeout = null;
        }

        // Check if this could start a kitty sequence
        const startsWithEsc = key.sequence.startsWith(ESC);
        const isExcluded = [
          PASTE_MODE_PREFIX,
          PASTE_MODE_SUFFIX,
          FOCUS_IN,
          FOCUS_OUT,
        ].some((prefix) => key.sequence.startsWith(prefix));

        if (kittySequenceBuffer || (startsWithEsc && !isExcluded)) {
          kittySequenceBuffer += key.sequence;

          if (debugKeystrokeLogging) {
            console.log(
              '[DEBUG] Kitty buffer accumulating:',
              JSON.stringify(kittySequenceBuffer),
            );
          }

          // Try immediate parsing
          let remainingBuffer = kittySequenceBuffer;
          let parsedAny = false;

          while (remainingBuffer) {
            const parsed = parseKittyPrefix(remainingBuffer);

            if (parsed) {
              if (debugKeystrokeLogging) {
                const parsedSequence = remainingBuffer.slice(0, parsed.length);
                console.log(
                  '[DEBUG] Kitty sequence parsed successfully:',
                  JSON.stringify(parsedSequence),
                );
              }
              broadcast(parsed.key);
              remainingBuffer = remainingBuffer.slice(parsed.length);
              parsedAny = true;
            } else {
              // If we can't parse a sequence at the start, check if there's
              // another ESC later in the buffer. If so, the data before it
              // is garbage/incomplete and should be dropped so we can
              // process the next sequence.
              const nextEscIndex = remainingBuffer.indexOf(ESC, 1);
              if (nextEscIndex !== -1) {
                const garbage = remainingBuffer.slice(0, nextEscIndex);
                if (debugKeystrokeLogging) {
                  console.log(
                    '[DEBUG] Dropping incomplete sequence before next ESC:',
                    JSON.stringify(garbage),
                  );
                }
                // Drop garbage and continue parsing from next ESC
                remainingBuffer = remainingBuffer.slice(nextEscIndex);
                // We made progress, so we can continue the loop to parse the next sequence
                continue;
              }

              // Check if buffer could become a valid kitty sequence
              const couldBeValid = couldBeKittySequence(remainingBuffer);

              if (!couldBeValid) {
                // Not a kitty sequence - flush as regular input immediately
                if (debugKeystrokeLogging) {
                  console.log(
                    '[DEBUG] Not a kitty sequence, flushing:',
                    JSON.stringify(remainingBuffer),
                  );
                }
                broadcast({
                  name: '',
                  ctrl: false,
                  meta: false,
                  shift: false,
                  paste: false,
                  sequence: remainingBuffer,
                });
                remainingBuffer = '';
                parsedAny = true;
              } else if (remainingBuffer.length > MAX_KITTY_SEQUENCE_LENGTH) {
                // Buffer overflow - log and clear
                if (debugKeystrokeLogging) {
                  console.log(
                    '[DEBUG] Kitty buffer overflow, clearing:',
                    JSON.stringify(remainingBuffer),
                  );
                }
                if (config) {
                  const event = new KittySequenceOverflowEvent(
                    remainingBuffer.length,
                    remainingBuffer,
                  );
                  logKittySequenceOverflow(config, event);
                }
                // Flush as regular input
                broadcast({
                  name: '',
                  ctrl: false,
                  meta: false,
                  shift: false,
                  paste: false,
                  sequence: remainingBuffer,
                });
                remainingBuffer = '';
                parsedAny = true;
              } else {
                if (config?.getDebugMode() || debugKeystrokeLogging) {
                  console.warn(
                    'Kitty sequence buffer has content:',
                    JSON.stringify(kittySequenceBuffer),
                  );
                }
                // Could be valid but incomplete - set timeout
                kittySequenceTimeout = setTimeout(() => {
                  if (kittySequenceBuffer) {
                    if (debugKeystrokeLogging) {
                      console.log(
                        '[DEBUG] Kitty sequence timeout, flushing:',
                        JSON.stringify(kittySequenceBuffer),
                      );
                    }
                    broadcast({
                      name: '',
                      ctrl: false,
                      meta: false,
                      shift: false,
                      paste: false,
                      sequence: kittySequenceBuffer,
                    });
                    kittySequenceBuffer = '';
                  }
                  kittySequenceTimeout = null;
                }, KITTY_SEQUENCE_TIMEOUT_MS);
                break;
              }
            }
          }

          kittySequenceBuffer = remainingBuffer;
          if (parsedAny || kittySequenceBuffer) return;
        }
      }

      if (key.name === 'return' && key.sequence === `${ESC}\r`) {
        key.meta = true;
      }
      broadcast({ ...key, paste: isPaste });
    };

    const handleRawKeypress = (data: Buffer) => {
      const pasteModePrefixBuffer = Buffer.from(PASTE_MODE_PREFIX);
      const pasteModeSuffixBuffer = Buffer.from(PASTE_MODE_SUFFIX);

      let pos = 0;
      while (pos < data.length) {
        const prefixPos = data.indexOf(pasteModePrefixBuffer, pos);
        const suffixPos = data.indexOf(pasteModeSuffixBuffer, pos);
        const isPrefixNext =
          prefixPos !== -1 && (suffixPos === -1 || prefixPos < suffixPos);
        const isSuffixNext =
          suffixPos !== -1 && (prefixPos === -1 || suffixPos < prefixPos);

        let nextMarkerPos = -1;
        let markerLength = 0;

        if (isPrefixNext) {
          nextMarkerPos = prefixPos;
        } else if (isSuffixNext) {
          nextMarkerPos = suffixPos;
        }
        markerLength = pasteModeSuffixBuffer.length;

        if (nextMarkerPos === -1) {
          keypressStream.write(data.slice(pos));
          return;
        }

        const nextData = data.slice(pos, nextMarkerPos);
        if (nextData.length > 0) {
          keypressStream.write(nextData);
        }
        const createPasteKeyEvent = (
          name: 'paste-start' | 'paste-end',
        ): Key => ({
          name,
          ctrl: false,
          meta: false,
          shift: false,
          paste: false,
          sequence: '',
        });
        if (isPrefixNext) {
          handleKeypress(undefined, createPasteKeyEvent('paste-start'));
        } else if (isSuffixNext) {
          handleKeypress(undefined, createPasteKeyEvent('paste-end'));
        }
        pos = nextMarkerPos + markerLength;
      }
    };

    let rl: readline.Interface;
    if (usePassthrough) {
      rl = readline.createInterface({
        input: keypressStream,
        escapeCodeTimeout: 0,
      });
      readline.emitKeypressEvents(keypressStream, rl);
      keypressStream.on('keypress', handleKeypress);
      stdin.on('data', handleRawKeypress);
    } else {
      rl = readline.createInterface({ input: stdin, escapeCodeTimeout: 0 });
      readline.emitKeypressEvents(stdin, rl);
      stdin.on('keypress', handleKeypress);
    }

    return () => {
      if (usePassthrough) {
        keypressStream.removeListener('keypress', handleKeypress);
        stdin.removeListener('data', handleRawKeypress);
      } else {
        stdin.removeListener('keypress', handleKeypress);
      }

      rl.close();

      // Restore the terminal to its original state.
      if (wasRaw === false) {
        setRawMode(false);
      }

      if (backslashTimeout) {
        clearTimeout(backslashTimeout);
        backslashTimeout = null;
      }

      if (kittySequenceTimeout) {
        clearTimeout(kittySequenceTimeout);
        kittySequenceTimeout = null;
      }

      // Flush any pending kitty sequence data to avoid data loss on exit.
      if (kittySequenceBuffer) {
        broadcast({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: false,
          sequence: kittySequenceBuffer,
        });
        kittySequenceBuffer = '';
      }

      // Flush any pending paste data to avoid data loss on exit.
      if (isPaste) {
        broadcast({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: true,
          sequence: pasteBuffer.toString(),
        });
        pasteBuffer = Buffer.alloc(0);
      }

      if (draggingTimerRef.current) {
        clearTimeout(draggingTimerRef.current);
        draggingTimerRef.current = null;
      }
      if (isDraggingRef.current && dragBufferRef.current) {
        broadcast({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: true,
          sequence: dragBufferRef.current,
        });
        isDraggingRef.current = false;
        dragBufferRef.current = '';
      }
    };
  }, [
    stdin,
    setRawMode,
    kittyProtocolEnabled,
    config,
    subscribers,
    debugKeystrokeLogging,
  ]);

  return (
    <KeypressContext.Provider value={{ subscribe, unsubscribe }}>
      {children}
    </KeypressContext.Provider>
  );
}
