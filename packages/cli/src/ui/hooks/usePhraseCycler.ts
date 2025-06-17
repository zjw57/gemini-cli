/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';

export const WITTY_LOADING_PHRASES = [
  "I'm Feeling Lucky",
  "Don't panic...",
  "Don't rush perfection (or my code)...",
  "Greasin' the cogs of the machine...",
  "Hold tight, I'm crafting a masterpiece...",
  "I'm Giving Her all she's got Captain!",
  "I'm going the distance, I'm going for speed...",
  "I've got a good feeling about this...",
  "I've seen things you people wouldn't believe... like a user who reads loading messages.",
  "It's not a bug, it's a feature... of this loading screen.",
  "Just a jiffy, I'm debugging the universe...",
  "Just a moment, I'm aligning the pixels...",
  "Just a moment, I'm finding the right meme...",
  "Just a moment, I'm in the zone...",
  "Just a moment, I'm tuning the algorithms...",
  "Just a sec, I'm debugging reality...",
  "Just a sec, I'm optimizing the humor...",
  "Just a tick, I'm polishing my wit...",
  "Pressing 'A' to continue...",
  "Pretty sure there's a cat walking on the keyboard somewhere...",
  "Swapping bits... don't tell the bytes...",
  "That's not a bug, it's an undocumented feature...",
  "The cake is not a lie, it's just still loading...",
  "What can you do with a broken pencil? Nothing, it's pointless...",
  "What's a computer's favorite snack? Microchips.",
  "Why do Java developers wear glasses? Because they don't C#.",
  "Why don't programmers like nature? It has too many bugs...",
  'Aligning the stars for optimal response...',
  'Almost there... probably...',
  'Applying percussive maintenance...',
  'Are you not entertained? (Working on it!)',
  'Asking the magic conch shell...',
  'Assembling the interwebs...',
  'Blowing on the cartridge...',
  'Brewing fresh bytes...',
  'Buffering... because even AIs need a moment.',
  'Caching the essentials (mostly cat memes)...',
  'Calibrating the flux capacitor...',
  'Channeling the Force...',
  'Charging the laser... pew pew!',
  'Checking for syntax errors in the universe...',
  'Communing with the machine spirit...',
  'Compiling brilliance...',
  'Compiling the 1s and 0s...',
  'Confuzzling the options...',
  'Consulting the digital spirits...',
  'Converting coffee into code...',
  'Counting electrons...',
  'Crafting a response worthy of your patience...',
  'Defragmenting memories... both RAM and personal...',
  'Distracting you with this witty phrase...',
  'Dividing by zero... just kidding!',
  'Doing research on the latest memes...',
  'Engage.',
  'Engaging cognitive processors...',
  'Engaging the improbability drive...',
  'Enhancing... Enhancing... Still loading.',
  'Ensuring the magic smoke stays inside the wires...',
  'Entangling quantum particles for a faster response...',
  'Fiddling with the character creation screen...',
  'Figuring out how to make this more witty...',
  'Finding a suitable loading screen pun...',
  'Finishing the Kessel Run in less than 12 parsecs...',
  'Following the white rabbit...',
  'Garbage collecting... be right back...',
  'Generating witty retort...',
  'Giving Cloudy a pat on the head...',
  'Have you tried turning it off and on again? (The loading screen, not me.)',
  'Herding digital cats...',
  'Hmmm... let me think...',
  'Initiating thoughtful gaze...',
  'Is this the real life? Is this just fantasy?...',
  'Just remembered where I put my keys...',
  'Just waiting for the dial-up tone to finish...',
  'Letting the thoughts marinate...',
  'Loading the next great idea...',
  'Loading wit.exe...',
  'Loading... Do a barrel roll!',
  'Looking for a misplaced semicolon...',
  'Looking for an adult superviso... I mean, processing.',
  'Looking for the princess in another castle...',
  'Making it go beep boop.',
  'Mining for more Dilithium crystals...',
  'My other loading screen is even funnier.',
  'My other process is a TARDIS...',
  'Navigating the slime mold...',
  'Never gonna give you up, never gonna let you down...',
  'One moment, optimizing humor...',
  'Optimizing for ludicrous speed',
  'Our hamsters are working as fast as they can...',
  'Painting the serifs back on...',
  'Petting the cat...',
  'Poking the bear...',
  'Polishing the algorithms...',
  'Polishing the chrome... on the algorithms.',
  'Polishing the pixels...',
  'Pondering the orb...',
  'Pre-heating the servers...',
  'Preparing a witty response...',
  'Preparing to dazzle you with brilliance...',
  'Pushing to production (and hoping for the best)...',
  'Rebooting the humor module...',
  'Recalibrating the humor-o-meter.',
  'Resolving dependencies... and existential crises...',
  'Reticulating splines...',
  'Rewiring the synapses...',
  'Rewriting in Rust for no particular reason...',
  'Running sudo make me a sandwich...',
  'Searching for the correct USB orientation...',
  'Shuffling punchlines...',
  'So say we all...',
  'Spinning up the hamster wheel...',
  'Summoning the cloud of wisdom...',
  'Summoning the code gremlins... to help, of course.',
  'Tasting the snozberries...',
  'The truth is in here... somewhere...',
  'Trying to exit Vim...',
  'Tuning the cosmic frequencies...',
  'Untangling neural nets...',
  'Updating the syntax for reality...',
  'Waiting for the respawn...',
  'Warming up the AI hamsters...',
  'Warp speed engaged...',
  'What do you call a fish with no eyes? A fsh...',
  'Why did the computer go to therapy? It had too many bytes...',
  'Why did the developer go broke? Because he used up all his cache...',
  'Why do programmers prefer dark mode? Because light attracts bugs...',
];

export const PHRASE_CHANGE_INTERVAL_MS = 15000;

/**
 * Custom hook to manage cycling through loading phrases.
 * @param isActive Whether the phrase cycling should be active.
 * @param isWaiting Whether to show a specific waiting phrase.
 * @returns The current loading phrase.
 */
export const usePhraseCycler = (isActive: boolean, isWaiting: boolean) => {
  const [currentLoadingPhrase, setCurrentLoadingPhrase] = useState(
    WITTY_LOADING_PHRASES[0],
  );
  const phraseIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isWaiting) {
      setCurrentLoadingPhrase('Waiting for user confirmation...');
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
    } else if (isActive) {
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
      }
      // Select an initial random phrase
      const initialRandomIndex = Math.floor(
        Math.random() * WITTY_LOADING_PHRASES.length,
      );
      setCurrentLoadingPhrase(WITTY_LOADING_PHRASES[initialRandomIndex]);

      phraseIntervalRef.current = setInterval(() => {
        // Select a new random phrase
        const randomIndex = Math.floor(
          Math.random() * WITTY_LOADING_PHRASES.length,
        );
        setCurrentLoadingPhrase(WITTY_LOADING_PHRASES[randomIndex]);
      }, PHRASE_CHANGE_INTERVAL_MS);
    } else {
      // Idle or other states, clear the phrase interval
      // and reset to the first phrase for next active state.
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
      setCurrentLoadingPhrase(WITTY_LOADING_PHRASES[0]);
    }

    return () => {
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
    };
  }, [isActive, isWaiting]);

  return currentLoadingPhrase;
};
