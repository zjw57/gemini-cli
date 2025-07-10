/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import hljs from 'highlight.js';

const InfoConfirmation = ({ confirmationDetails, onConfirm }) => {
  const { name, args, description } = confirmationDetails;
  const codeRef = useRef(null);

  useEffect(() => {
    if (codeRef.current) {
      hljs.highlightElement(codeRef.current);
    }
  }, [args]);

  return (
    <div className="tool-call-confirmation">
      <div className="tool-call-header">
        Tool Call: {name}
      </div>
      <div className="tool-call-body">
        {args && args.description && <p className="tool-description">{args.description}</p>}
        <div className="tool-args">
          <h5>Arguments:</h5>
          <pre><code ref={codeRef} className="json">{JSON.stringify(args, null, 2)}</code></pre>
        </div>
      </div>
      <div className="tool-call-actions">
        <button className="approve-button" onClick={() => onConfirm('proceed_once')}>Yes, allow once</button>
        <button className="approve-button" onClick={() => onConfirm('proceed_always')}>Yes, allow always</button>
        <button className="deny-button" onClick={() => onConfirm('cancel')}>No</button>
      </div>
    </div>
  );
};

export default InfoConfirmation;