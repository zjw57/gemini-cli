/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';

function App() {
  const [logs, setLogs] = useState<object[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<object[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const contents = e.target?.result as string;
      try {
        const logObjects = contents.trim().split('}\n{');
        const parsedLogs = logObjects
          .map((logObject, index) => {
            try {
              if (logObjects.length > 1 && index > 0) {
                logObject = '{' + logObject;
              }
              if (logObjects.length > 1 && index < logObjects.length - 1) {
                logObject = logObject + '}';
              }
              return JSON.parse(logObject);
            } catch (err) {
              console.error('Failed to parse individual log object:', err);
              return null;
            }
          })
          .filter((log) => log !== null) as object[];

        setLogs(parsedLogs);
        setFilteredLogs(parsedLogs);
        setError(null);
      } catch (err) {
        setError(`Failed to parse log file. Error: ${err}`);
        setLogs([]);
        setFilteredLogs([]);
      }
    };
    reader.onerror = () => {
      setError('Failed to read file.');
      setLogs([]);
      setFilteredLogs([]);
    };
    reader.readAsText(file);
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const term = event.target.value;
    setSearchTerm(term);
    if (term === '') {
      setFilteredLogs(logs);
    } else {
      const lowerCaseTerm = term.toLowerCase();
      const filtered = logs.filter((log) =>
        JSON.stringify(log).toLowerCase().includes(lowerCaseTerm),
      );
      setFilteredLogs(filtered);
    }
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
          <table className="table table-striped table-bordered">
            <thead className="thead-dark">
              <tr>
                <th>Timestamp</th>
                <th>Event Name</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log, index) => (
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
        </>
      )}
    </div>
  );
}

export default App;
