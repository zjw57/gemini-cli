/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';

interface TokenBreakdown {
  chatTokens: number;
  conventionsTokens: number;
  systemTokens: number;
}

interface FilesWithTokens {
  path: string;
  tokenCount: number;
}

const formatTokens = (tokens: number): string => {
  if (tokens < 1000) {
    return tokens.toString();
  }
  return `${(tokens / 1000).toFixed(1)}k`;
};

export const useTokenCounts = (
  tokenBreakdown: TokenBreakdown,
  filesWithTokens: FilesWithTokens[],
  tokenLimit: number,
) => {
  return useMemo(() => {
    const filesTokenCount = filesWithTokens.reduce(
      (acc, file) => acc + file.tokenCount,
      0,
    );

    const totalTokenCount =
      tokenBreakdown.chatTokens +
      tokenBreakdown.conventionsTokens +
      tokenBreakdown.systemTokens +
      filesTokenCount;

    const totalPercentage =
      tokenLimit > 0 ? ((totalTokenCount / tokenLimit) * 100).toFixed(0) : '0';

    return {
      totalTokenCount,
      totalTokens: totalTokenCount.toLocaleString(),
      totalPercentage: `${totalPercentage}%`,
      systemTokens: formatTokens(tokenBreakdown.systemTokens),
      historyTokens: formatTokens(tokenBreakdown.chatTokens),
      conventionsTokens: formatTokens(tokenBreakdown.conventionsTokens),
      filesTokens: formatTokens(filesTokenCount),
    };
  }, [tokenBreakdown, filesWithTokens, tokenLimit]);
};
