/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import ChatView from './components/ChatView';

const App = () => {
  const [task, setTask] = useState(null);

  useEffect(() => {
    window.electron.on('load-chat', (task) => {
      setTask(task);
    });

    window.electron.on('update-task-state', (updatedTask) => {
      setTask(currentTask => {
        if (currentTask && currentTask.id === updatedTask.id) {
          return updatedTask;
        }
        return currentTask;
      });
    });

    return () => {
      window.electron.removeAllListeners('load-chat');
      window.electron.removeAllListeners('update-task-state');
    };
  }, []);

  if (!task) {
    return <div>Loading...</div>;
  }

  return <ChatView task={task} />;
};

export default App;
