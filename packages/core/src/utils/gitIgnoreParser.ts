/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import ignore, { type Ignore } from 'ignore';
import { isGitRepository } from './gitUtils.js';

export interface GitIgnoreFilter {
  isIgnored(filePath: string): boolean;
  getPatterns(): string[];
}

export class GitIgnoreParser implements GitIgnoreFilter {
  private projectRoot: string;
  private ig: Ignore = ignore();
  private patterns: string[] = [];

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  loadGitRepoPatterns(): void {
    if (!isGitRepository(this.projectRoot)) return;

    // Always ignore .git directory regardless of .gitignore content
    this.addPatterns(['.git']);

    const patternFiles = ['.gitignore', path.join('.git', 'info', 'exclude')];
    this.loadPatterns(patternFiles);
  }

  loadPatterns(patternsFileName: string | string[]): void {
    const patternFiles = Array.isArray(patternsFileName)
      ? patternsFileName
      : [patternsFileName];
    for (const pf of patternFiles) {
      const pfp = path.join(this.projectRoot, pf);
      let content: string;
      try {
        content = fs.readFileSync(pfp, 'utf-8');
      } catch (_error) {
        // ignore file not found
        continue;
      }
      const patterns = (content ?? '')
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p !== '' && !p.startsWith('#'));
      if (patterns.length > 0) {
        console.log(`Loaded ${patterns.length} patterns from ${pfp}`);
      }
      this.addPatterns(patterns);
    }
  }

  private addPatterns(patterns: string[]) {
    this.ig.add(patterns);
    this.patterns.push(...patterns);
  }

  isIgnored(filePath: string): boolean {
    const relativePath = path.isAbsolute(filePath)
      ? path.relative(this.projectRoot, filePath)
      : filePath;

    if (relativePath === '' || relativePath.startsWith('..')) {
      return false;
    }

    let normalizedPath = relativePath.replace(/\\/g, '/');
    if (normalizedPath.startsWith('./')) {
      normalizedPath = normalizedPath.substring(2);
    }

    return this.ig.ignores(normalizedPath);
  }

  getPatterns(): string[] {
    return this.patterns;
  }
}
