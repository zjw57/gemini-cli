import React from 'react';
import EditConfirmation from './EditConfirmation';
import ExecConfirmation from './ExecConfirmation';
import InfoConfirmation from './InfoConfirmation';
import McpConfirmation from './McpConfirmation';

const ToolCallConfirmation = ({ toolCall, onConfirm }) => {
  switch (toolCall.type) {
    case 'edit':
      return <EditConfirmation confirmationDetails={toolCall} onConfirm={onConfirm} />;
    case 'exec':
      return <ExecConfirmation confirmationDetails={toolCall} onConfirm={onConfirm} />;
    case 'info':
      return <InfoConfirmation confirmationDetails={toolCall} onConfirm={onConfirm} />;
    case 'mcp':
      return <McpConfirmation confirmationDetails={toolCall} onConfirm={onConfirm} />;
    default:
      return null;
  }
};

export default ToolCallConfirmation;
