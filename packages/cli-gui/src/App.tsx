/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import ChatView from './components/ChatView';

const App = () => {
  const [task, setTask] = useState(null);

  useEffect(() => {
    window.electron.on('load-chat', (task) => {
      setTask(task);
    });

    return () => {
      window.electron.removeAllListeners('load-chat');
    };
  }, []);

  if (!task) {
    return <div>Loading...</div>;
  }

  return <ChatView task={task} />;
};

export default App;
