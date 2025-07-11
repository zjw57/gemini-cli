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
import { ContextSummaryDisplay } from './ContextSummaryDisplay';

const ChatView = ({ task }) => {
  const [log, setLog] = useState(task.log);
  const [message, setMessage] = useState('');
  const chatContainerRef = useRef(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showCheckmark, setShowCheckmark] = useState(false);
  const [toolCall, setToolCall] = useState(task.pendingToolCall || null);
  const [acceptingEdits, setAcceptingEdits] = useState(false);
  const [terminalMode, setTerminalMode] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let interval;
    if (task.isThinking) {
      const start = new Date(task.startTime);
      const now = new Date();
      setElapsedTime(Math.round((now.getTime() - start.getTime()) / 1000));
      interval = setInterval(() => {
        const start = new Date(task.startTime);
        const now = new Date();
        setElapsedTime(Math.round((now.getTime() - start.getTime()) / 1000));
      }, 1000);
    } else {
      setElapsedTime(0);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [task.isThinking, task.startTime]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setLog(task.log);
  }, [task.log]);

  useEffect(() => {
    const handleStreamEnd = ({ taskId }) => {
      if (taskId !== task.id) return;
      // The isThinking state is now derived from task.isThinking,
      // so we don't need to set it here.
    };

    window.electron.on('response-received', handleStreamEnd);

    return () => {
      window.electron.removeAllListeners('response-received');
    };
  }, [task.id]);

  useEffect(() => {
    const handleToolCall = ({ taskId, toolCall }) => {
      if (taskId !== task.id) return;
      setToolCall(toolCall);
    };

    window.electron.on('tool-call', handleToolCall);

    return () => {
      window.electron.removeAllListeners('tool-call');
    };
  }, [task.id]);

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
      if (e.shiftKey && e.key === '!') {
        e.preventDefault();
        setTerminalMode(prev => {
          const newMode = !prev;
          if (newMode) {
            setMessage('!');
          } else {
            if (message === '!') {
              setMessage('');
            }
          }
          return newMode;
        });
        inputRef.current?.focus();
      } else if (e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        setAcceptingEdits(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [message]);

  const handleMessageChange = (e) => {
    const text = e.target.value;
    setMessage(text);
  };

  const handleSendMessage = () => {
    if (message.trim()) {
      if (terminalMode) {
        const command = message.trim().substring(1);
        if (command.startsWith('cd ')) {
          const directory = command.substring(3);
          window.electron.send('change-directory', { taskId: task.id, directory, command: `cd ${directory}` });
        } else {
          window.electron.send('execute-shell-command', { taskId: task.id, command });
        }
        setMessage('!');
        return;
      }

      const userMessage = { sender: 'You', content: message };
      const geminiPlaceholder = { sender: 'Gemini', content: '' };
      setLog(prevLog => [...prevLog, userMessage, geminiPlaceholder]);
      window.electron.send('send-message', { taskId: task.id, message, acceptingEdits });
      setMessage(terminalMode ? '!' : '');
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
        {terminalMode && <div className="shell-mode-indicator">Shell Mode</div>}
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
      <ProgressNotifier isActive={task.isThinking} elapsedTime={elapsedTime} thought={task.thought} />
      <div className="input-area">
        <ContextSummaryDisplay
          geminiMdFileCount={task.config.geminiMdFileCount}
          contextFileNames={task.config.contextFileNames}
          mcpServers={task.config.mcpServers}
        />
        <div className={`input-wrapper ${terminalMode ? 'terminal-mode' : ''}`}>
          <textarea
            ref={inputRef}
            value={message}
            onChange={handleMessageChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Enter your command..."
            rows="1"
          />
          <button onClick={handleSendMessage} disabled={task.isThinking}>Send</button>
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