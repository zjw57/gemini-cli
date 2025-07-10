/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';

const Message = ({ entry }) => {
  if (entry.sender === 'system') {
    return (
      <div className="log-entry system-message">
        <div className="log-label">{entry.sender}</div>
        <pre className="log-content"><code>{entry.content}</code></pre>
      </div>
    );
  }

  const parsedContent = marked(entry.content, {
    highlight: (code, lang) => {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  });

  return (
    <div className={`log-entry ${entry.sender === 'You' ? 'user-message' : ''}`}>
      <div className="log-label">{entry.sender}</div>
      <div
        className="log-content"
        dangerouslySetInnerHTML={{ __html: parsedContent }}
      />
    </div>
  );
};

export default Message;
