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
    thought: { subject: string; description: string } | null;
}

const ProgressNotifier: React.FC<ProgressNotifierProps> = ({ isActive, elapsedTime, thought }) => {
    const [currentPhrase, setCurrentPhrase] = useState('');

    useEffect(() => {
        let phraseIntervalId: NodeJS.Timeout | undefined;

        const getRandomPhrase = () => {
            const randomIndex = Math.floor(Math.random() * WITTY_LOADING_PHRASES.length);
            return WITTY_LOADING_PHRASES[randomIndex];
        };

        if (isActive && !thought) {
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
    }, [isActive, thought]);

    if (!isActive) {
        return null;
    }

    return (
        <div className="progress-notifier">
            <div className="spinner"></div>
            {thought ? (
                <span className="witty-phrase">{thought.subject}</span>
            ) : (
                <span className="witty-phrase">{currentPhrase}</span>
            )}
            <span className="timer">({elapsedTime}s)</span>
        </div>
    );
};

export default ProgressNotifier;