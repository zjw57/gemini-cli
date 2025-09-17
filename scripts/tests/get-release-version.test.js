/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getVersion } from '../get-release-version.js';
import { execSync } from 'node:child_process';

vi.mock('node:child_process');

describe('getVersion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Mock date to be consistent for nightly versions
    vi.setSystemTime(new Date('2025-09-17T00:00:00.000Z'));
  });

  const mockExecSync = (command) => {
    // NPM Mocks
    if (command.includes('npm view') && command.includes('--tag=latest')) {
      return '0.4.1';
    }
    if (command.includes('npm view') && command.includes('--tag=preview')) {
      return '0.5.0-preview-2';
    }
    if (command.includes('npm view') && command.includes('--tag=nightly')) {
      return '0.6.0-nightly.20250910.a31830a3';
    }

    // Git Tag Mocks
    if (command.includes('git tag -l "v0.4.1"')) return 'v0.4.1';
    if (command.includes('git tag -l "v0.5.0-preview-2"')) return 'v0.5.0-preview-2';
    if (command.includes('git tag -l "v0.6.0-nightly.20250910.a31830a3"')) return 'v0.6.0-nightly.20250910.a31830a3';

    // GitHub Release Mocks
    if (command.includes('gh release view "v0.4.1"')) return 'v0.4.1';
    if (command.includes('gh release view "v0.5.0-preview-2"')) return 'v0.5.0-preview-2';
    if (command.includes('gh release view "v0.6.0-nightly.20250910.a31830a3"')) return 'v0.6.0-nightly.20250910.a31830a3';

    // Git Hash Mock
    if (command.includes('git rev-parse --short HEAD')) return 'd3bf8a3d';

    return '';
  };

  describe('Happy Path - Version Calculation', () => {
    it('should calculate the next stable version from the latest preview', () => {
      vi.mocked(execSync).mockImplementation(mockExecSync);
      const result = getVersion({ type: 'stable' });
      expect(result.releaseVersion).toBe('0.5.0');
      expect(result.npmTag).toBe('latest');
      expect(result.previousReleaseTag).toBe('v0.4.1');
    });

    it('should calculate the next preview version from the latest nightly', () => {
      vi.mocked(execSync).mockImplementation(mockExecSync);
      const result = getVersion({ type: 'preview' });
      expect(result.releaseVersion).toBe('0.6.0-preview');
      expect(result.npmTag).toBe('preview');
      expect(result.previousReleaseTag).toBe('v0.5.0-preview-2');
    });

    it('should calculate the next nightly version from the latest stable', () => {
      vi.mocked(execSync).mockImplementation(mockExecSync);
      const result = getVersion({ type: 'nightly' });
      expect(result.releaseVersion).toBe('0.5.0-nightly.20250917.d3bf8a3d');
      expect(result.npmTag).toBe('nightly');
      expect(result.previousReleaseTag).toBe('v0.6.0-nightly.20250910.a31830a3');
    });

    it('should calculate the next patch version for a stable release', () => {
      vi.mocked(execSync).mockImplementation(mockExecSync);
      const result = getVersion({ type: 'patch', patchFrom: 'stable' });
      expect(result.releaseVersion).toBe('0.4.2');
      expect(result.npmTag).toBe('latest');
      expect(result.previousReleaseTag).toBe('v0.4.1');
    });

    it('should calculate the next patch version for a preview release', () => {
      vi.mocked(execSync).mockImplementation(mockExecSync);
      const result = getVersion({ type: 'patch', patchFrom: 'preview' });
      expect(result.releaseVersion).toBe('0.5.1-preview-2');
      expect(result.npmTag).toBe('preview');
      expect(result.previousReleaseTag).toBe('v0.5.0-preview-2');
    });
  });

  describe('Failure Path - Discrepancy Checks', () => {
    it('should throw an error if the git tag is missing', () => {
      const mockWithMissingGitTag = (command) => {
        if (command.includes('git tag -l "v0.5.0-preview-2"')) return ''; // Simulate missing tag
        return mockExecSync(command);
      };
      vi.mocked(execSync).mockImplementation(mockWithMissingGitTag);

      expect(() => getVersion({ type: 'stable' })).toThrow(
        'Discrepancy found! NPM version v0.5.0-preview-2 is missing a corresponding git tag.'
      );
    });

    it('should throw an error if the GitHub release is missing', () => {
      const mockWithMissingRelease = (command) => {
        if (command.includes('gh release view "v0.5.0-preview-2"')) {
          throw new Error('gh command failed'); // Simulate gh failure
        }
        return mockExecSync(command);
      };
      vi.mocked(execSync).mockImplementation(mockWithMissingRelease);

      expect(() => getVersion({ type: 'stable' })).toThrow(
        'Discrepancy found! Failed to verify GitHub release for v0.5.0-preview-2.'
      );
    });
  });
});