import React, { useState, useEffect } from 'react';

const StatusBar = () => {
  const [statusInfo, setStatusInfo] = useState({
    cwd: '',
    sandbox: false,
    model: '',
    contextWindow: '',
    branchName: '',
  });

  useEffect(() => {
    window.electron.on('update-status-info', (info) => {
      setStatusInfo(info);
    });
    window.electron.send('get-status-info');

    return () => {
      window.electron.removeAllListeners('update-status-info');
    };
  }, []);

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <span>{statusInfo.cwd}</span>
        <span>{statusInfo.branchName ? `(${statusInfo.branchName}*)` : ''}</span>
      </div>
      <div className="status-bar-center">
        <span>Sandbox: {statusInfo.sandbox ? 'On' : 'Off'}</span>
      </div>
      <div className="status-bar-right">
        <span>{statusInfo.model}</span>
        <span>{statusInfo.contextWindow}</span>
      </div>
    </div>
  );
};

export default StatusBar;
