/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import StatusBar from './StatusBar';
import Message from './Message';
import ToolCallConfirmation from './ToolCallConfirmation';
import ProgressNotifier from './ProgressNotifier';

const ChatView = ({ task }) => {
  const [log, setLog] = useState(task.log);
  const [message, setMessage] = useState('');
  const chatContainerRef = useRef(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isThinking, setIsThinking] = useState(false);
  const [showCheckmark, setShowCheckmark] = useState(false);
  const [toolCall, setToolCall] = useState(null);
  const [acceptingEdits, setAcceptingEdits] = useState(false);

  useEffect(() => {
    setLog(task.log);
  }, [task.log]);

  useEffect(() => {
    const handleStreamChunk = ({ chunk }) => {
      setLog(prevLog => {
        const newLog = [...prevLog];
        const lastMessage = newLog[newLog.length - 1];
        if (lastMessage && lastMessage.sender === 'Gemini') {
          lastMessage.content += chunk;
        }
        return newLog;
      });
    };

    window.electron.on('stream-chunk', handleStreamChunk);

    return () => {
      window.electron.removeAllListeners('stream-chunk');
    };
  }, []);

  useEffect(() => {
    const handleStreamEnd = () => {
      setIsThinking(false);
    };

    window.electron.on('response-received', handleStreamEnd);

    return () => {
      window.electron.removeAllListeners('response-received');
    };
  }, []);

  useEffect(() => {
    const handleToolCall = (toolCall) => {
      setToolCall(toolCall);
    };

    window.electron.on('tool-call', handleToolCall);

    return () => {
      window.electron.removeAllListeners('tool-call');
    };
  }, []);

  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [log, isAtBottom, toolCall]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        setAcceptingEdits(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSendMessage = () => {
    if (message.trim()) {
      const userMessage = { sender: 'You', content: message };
      const geminiPlaceholder = { sender: 'Gemini', content: '' };
      setLog(prevLog => [...prevLog, userMessage, geminiPlaceholder]);
      window.electron.send('send-message', { taskId: task.id, message, acceptingEdits });
      setMessage('');
      setIsThinking(true);
      setIsAtBottom(true); // When sending a new message, we want to auto-scroll
    }
  };

  const handleScroll = () => {
    const container = chatContainerRef.current;
    if (container) {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Check if the user is at the bottom (with a small tolerance)
      const atBottom = scrollHeight - scrollTop <= clientHeight + 10;
      setIsAtBottom(atBottom);
    }
  };

  const handleConfirmToolCall = (outcome) => {
    window.electron.send('tool-call-response', { outcome, toolCall });
    setToolCall(null);
  };

  return (
    <div className="chat-wrapper">
      <div className="chat-header">
        <button onClick={() => window.electron.send('navigate-to-dashboard')} className="back-button">
          ‹ Dashboard
        </button>
        <h1 className="chat-header-title">{task.title}</h1>
        {acceptingEdits && <div className="accepting-edits-indicator">Accepting Edits</div>}
      </div>
      <div className="chat-container" ref={chatContainerRef} onScroll={handleScroll}>
        {log.map((entry, index) => (
          <Message key={index} entry={entry} />
        ))}
        {toolCall && (
          <ToolCallConfirmation
            toolCall={toolCall}
            onConfirm={handleConfirmToolCall}
          />
        )}
      </div>
      <ProgressNotifier isActive={isThinking} />
      <div className="input-area">
        <div className="input-wrapper">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Enter your command..."
            rows="1"
          />
          <button onClick={handleSendMessage} disabled={isThinking}>Send</button>
          {showCheckmark && (
            <svg className="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
              <circle className="checkmark__circle" cx="26" cy="26" r="25" fill="none"/>
              <path className="checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
            </svg>
          )}
        </div>
        <StatusBar />
      </div>
    </div>
  );
};

export default ChatView;