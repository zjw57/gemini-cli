/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo } from 'react';

const EVENT_TYPES_OF_INTEREST = new Set([
  'user-prompt',
  'llm-request',
  'llm-response',
  'tool-code',
  'tool-call',
  'tool-result',
]);

type LogEntry = {
  timestamp: string;
  eventName: string;
  sessionId: string;
  [key: string]: unknown;
};

function App() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSession, setActiveSession] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const contents = e.target?.result as string;
      try {
        const parsedLogs = contents
          .trim()
          .split('}\n{')
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch (err) {
              console.error('Failed to parse individual log object:', err);
              return null;
            }
          })
          .filter((log): log is LogEntry => log !== null);

        setLogs(parsedLogs);
        setError(null);
      } catch (err) {
        setError(`Failed to parse log file. Error: ${err}`);
        setLogs([]);
      }
    };
    reader.onerror = () => {
      setError('Failed to read file.');
      setLogs([]);
    };
    reader.readAsText(file);
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  };

  const sessions = useMemo(() => {
    const lowerCaseTerm = searchTerm.toLowerCase();
    const sessionsMap = new Map<string, LogEntry[]>();

    for (const log of logs) {
      if (!EVENT_TYPES_OF_INTEREST.has(log.eventName)) {
        continue;
      }

      if (
        searchTerm &&
        !JSON.stringify(log).toLowerCase().includes(lowerCaseTerm)
      ) {
        continue;
      }

      if (!sessionsMap.has(log.sessionId)) {
        sessionsMap.set(log.sessionId, []);
      }
      sessionsMap.get(log.sessionId)!.push(log);
    }
    return sessionsMap;
  }, [logs, searchTerm]);

  const toggleSession = (sessionId: string) => {
    setActiveSession(activeSession === sessionId ? null : sessionId);
  };

  return (
    <div className="container mt-4">
      <h1 className="mb-4">Gemini CLI Telemetry Viewer</h1>
      <div className="mb-3">
        <label htmlFor="logFile" className="form-label">
          Select telemetry.log file
        </label>
        <input
          className="form-control"
          type="file"
          id="logFile"
          onChange={handleFileChange}
          accept=".log"
        />
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {logs.length > 0 && (
        <>
          <div className="mb-3">
            <input
              type="text"
              className="form-control"
              placeholder="Search logs..."
              value={searchTerm}
              onChange={handleSearchChange}
            />
          </div>
          <div className="accordion" id="sessions-accordion">
            {Array.from(sessions.entries()).map(([sessionId, sessionLogs]) => (
              <div className="accordion-item" key={sessionId}>
                <h2 className="accordion-header" id={`heading-${sessionId}`}>
                  <button
                    className={`accordion-button ${
                      activeSession === sessionId ? '' : 'collapsed'
                    }`}
                    type="button"
                    onClick={() => toggleSession(sessionId)}
                  >
                    Session: {sessionId} ({sessionLogs.length} events)
                  </button>
                </h2>
                <div
                  className={`accordion-collapse collapse ${
                    activeSession === sessionId ? 'show' : ''
                  }`}
                >
                  <div className="accordion-body">
                    <table className="table table-striped table-bordered">
                      <thead className="thead-dark">
                        <tr>
                          <th>Timestamp</th>
                          <th>Event Name</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessionLogs.map((log, index) => (
                          <tr key={index}>
                            <td>{new Date(log.timestamp).toLocaleString()}</td>
                            <td>{log.eventName}</td>
                            <td>
                              <pre>{JSON.stringify(log, null, 2)}</pre>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default App;
