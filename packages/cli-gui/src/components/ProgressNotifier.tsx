/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { WITTY_LOADING_PHRASES, PHRASE_CHANGE_INTERVAL_MS } from '../../../cli/src/ui/hooks/usePhraseCycler';

interface ProgressNotifierProps {
    isActive: boolean;
}

const ProgressNotifier: React.FC<ProgressNotifierProps> = ({ isActive }) => {
    const [currentPhrase, setCurrentPhrase] = useState('');
    const [elapsedTime, setElapsedTime] = useState(0);

    useEffect(() => {
        let phraseIntervalId: NodeJS.Timeout | undefined;
        let timerIntervalId: NodeJS.Timeout | undefined;

        const getRandomPhrase = () => {
            const randomIndex = Math.floor(Math.random() * WITTY_LOADING_PHRASES.length);
            return WITTY_LOADING_PHRASES[randomIndex];
        };

        if (isActive) {
            setCurrentPhrase(getRandomPhrase());
            phraseIntervalId = setInterval(() => {
                setCurrentPhrase(getRandomPhrase());
            }, PHRASE_CHANGE_INTERVAL_MS);

            setElapsedTime(0);
            timerIntervalId = setInterval(() => {
                setElapsedTime(prevTime => prevTime + 1);
            }, 1000);
        }

        return () => {
            if (phraseIntervalId) {
                clearInterval(phraseIntervalId);
            }
            if (timerIntervalId) {
                clearInterval(timerIntervalId);
            }
        };
    }, [isActive]);

    if (!isActive) {
        return null;
    }

    return (
        <div className="progress-notifier">
            <div className="spinner"></div>
            <span className="witty-phrase">{currentPhrase}</span>
            <span className="timer">({elapsedTime}s)</span>
        </div>
    );
};

export default ProgressNotifier;