/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { WITTY_LOADING_PHRASES, PHRASE_CHANGE_INTERVAL_MS } from '../../../cli/src/ui/hooks/usePhraseCycler';

interface ProgressNotifierProps {
    isActive: boolean;
    elapsedTime: number;
}

const ProgressNotifier: React.FC<ProgressNotifierProps> = ({ isActive, elapsedTime }) => {
    const [currentPhrase, setCurrentPhrase] = useState('');

    useEffect(() => {
        let phraseIntervalId: NodeJS.Timeout | undefined;

        const getRandomPhrase = () => {
            const randomIndex = Math.floor(Math.random() * WITTY_LOADING_PHRASES.length);
            return WITTY_LOADING_PHRASES[randomIndex];
        };

        if (isActive) {
            setCurrentPhrase(getRandomPhrase());
            phraseIntervalId = setInterval(() => {
                setCurrentPhrase(getRandomPhrase());
            }, PHRASE_CHANGE_INTERVAL_MS);
        }

        return () => {
            if (phraseIntervalId) {
                clearInterval(phraseIntervalId);
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