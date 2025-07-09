/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export abstract class Snippet {
  abstract content(): string;
}

export class FileSnippet extends Snippet {
  constructor(
    readonly filePath: string,
    readonly startLine: number,
    readonly endLine: number,
    readonly snippet: string,
  ) {
    super();
  }

  content(): string {
    return this.snippet;
  }
}

export class SearchResult {
  constructor(
    readonly url: string,
    readonly text: string,
  ) {}
}

export class SearchSnippet extends Snippet {
  constructor(
    readonly query: string,
    readonly results: SearchResult[],
  ) {
    super();
  }

  content(): string {
    return this.results.map((r) => r.text).join('\n');
  }
}

export class MemoryScratchPad {
  private snippets: Snippet[] = [];

  addSnippet(snippet: Snippet) {
    this.snippets.push(snippet);
  }

  clearSnippets() {
    this.snippets = [];
  }

  searchSnippets(query: string | RegExp): Snippet[] {
    const regex = typeof query === 'string' ? new RegExp(query, 'g') : query;
    return this.snippets.filter((snippet) => regex.test(snippet.content()));
  }
}
