import { Box, Text } from 'ink';
import { FileContextService } from '@gemini-cli/core';
import path from 'path';
import { Colors } from '../colors.js';

interface TrackedFilesDisplayProps {
  fileContextService: FileContextService;
  projectRoot: string;
}

export const TrackedFilesDisplay = ({
  fileContextService,
  projectRoot,
}: TrackedFilesDisplayProps) => {
  const trackedFiles = fileContextService
    .getTrackedFiles()
    .map((file) => path.relative(projectRoot, file));

  if (trackedFiles.length === 0) {
    return null;
  }

  return (
    <Box borderStyle="round" borderColor={Colors.AccentGreen} paddingX={1} marginY={1}>
      <Text color={Colors.AccentGreen}>
        Tracked Files ({trackedFiles.length}): {trackedFiles.join(', ')}
      </Text>
    </Box>
  );
};
