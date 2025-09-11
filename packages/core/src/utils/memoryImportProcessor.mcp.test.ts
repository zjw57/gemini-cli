/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processImports } from './memoryImportProcessor.js';
import type { ResourceRegistry } from '../resources/resource-registry.js';

describe('MCP Resources in memoryImportProcessor', () => {
  const mockResourceRegistry = {
    getResource: vi.fn(),
    getResourcesByServer: vi.fn(),
  } as any as ResourceRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse MCP resource syntax', async () => {
    const content = 'Here is some content @server:file:///test.md and more text';
    
    // Mock resource not found to test parsing without actual fetching
    mockResourceRegistry.getResource = vi.fn().mockReturnValue(null);
    mockResourceRegistry.getResourcesByServer = vi.fn().mockReturnValue([]);
    
    const result = await processImports(
      content,
      '/test',
      false,
      undefined,
      undefined,
      'tree',
      mockResourceRegistry
    );
    
    // Should contain error message for resource not found
    expect(result.content).toContain('Server \'server\' not found or has no resources');
    expect(mockResourceRegistry.getResource).toHaveBeenCalledWith('server', 'file:///test.md');
  });

  it('should handle valid MCP resource imports', async () => {
    const content = 'Load resource: @test-server:config.json';
    
    const mockResource = {
      read: vi.fn().mockResolvedValue({
        uri: 'config.json',
        text: '{"setting": "value"}',
        mimeType: 'application/json'
      })
    };
    
    mockResourceRegistry.getResource = vi.fn().mockReturnValue(mockResource);
    
    const result = await processImports(
      content,
      '/test',
      false,
      undefined,
      undefined,
      'tree',
      mockResourceRegistry
    );
    
    expect(result.content).toContain('{"setting": "value"}');
    expect(result.content).toContain('Imported from resource: test-server:config.json');
    expect(mockResource.read).toHaveBeenCalled();
  });

  it('should handle resource registry not available', async () => {
    const content = 'Load resource: @server:resource-uri';
    
    const result = await processImports(
      content,
      '/test',
      false,
      undefined,
      undefined,
      'tree',
      undefined // No resource registry
    );
    
    expect(result.content).toContain('MCP resource registry not available');
  });

  it('should validate server names correctly', async () => {
    const testCases = [
      { content: '@valid-server:uri', shouldParse: true },
      { content: '@valid_server:uri', shouldParse: true },
      { content: '@ValidServer123:uri', shouldParse: true },
      { content: '@123invalid:uri', shouldParse: false }, // Can't start with number
      { content: '@invalid-:uri', shouldParse: false }, // Can't end with hyphen
      { content: '@invalid@server:uri', shouldParse: false }, // Invalid character
    ];
    
    for (const testCase of testCases) {
      mockResourceRegistry.getResource = vi.fn().mockReturnValue(null);
      mockResourceRegistry.getResourcesByServer = vi.fn().mockReturnValue([]);
      
      await processImports(
        testCase.content,
        '/test',
        false,
        undefined,
        undefined,
        'tree',
        mockResourceRegistry
      );
      
      if (testCase.shouldParse) {
        expect(mockResourceRegistry.getResource).toHaveBeenCalled();
      } else {
        expect(mockResourceRegistry.getResource).not.toHaveBeenCalled();
      }
    }
  });

  it('should handle circular import prevention', async () => {
    const content = '@server:resource1';
    
    const mockResource = {
      read: vi.fn().mockResolvedValue({
        uri: 'resource1',
        text: '@server:resource1', // Self-reference
        mimeType: 'text/plain'
      })
    };
    
    mockResourceRegistry.getResource = vi.fn().mockReturnValue(mockResource);
    
    const result = await processImports(
      content,
      '/test',
      false,
      undefined,
      undefined,
      'tree',
      mockResourceRegistry
    );
    
    // Should detect circular reference
    expect(result.content).toContain('Resource already processed: server:resource1');
  });

  it('should handle binary content with appropriate MIME types', async () => {
    const content = '@server:image.png';
    
    const mockResource = {
      read: vi.fn().mockResolvedValue({
        uri: 'image.png',
        blob: 'base64data',
        mimeType: 'image/png'
      })
    };
    
    mockResourceRegistry.getResource = vi.fn().mockReturnValue(mockResource);
    
    const result = await processImports(
      content,
      '/test',
      false,
      undefined,
      undefined,
      'tree',
      mockResourceRegistry
    );
    
    expect(result.content).toContain('Binary content (image/png) cannot be imported as text');
  });

  it('should handle text-based binary content', async () => {
    const content = '@server:data.json';
    
    // Base64 encoded "{'key': 'value'}"
    const base64Json = Buffer.from('{"key": "value"}').toString('base64');
    
    const mockResource = {
      read: vi.fn().mockResolvedValue({
        uri: 'data.json',
        blob: base64Json,
        mimeType: 'application/json'
      })
    };
    
    mockResourceRegistry.getResource = vi.fn().mockReturnValue(mockResource);
    
    const result = await processImports(
      content,
      '/test',
      false,
      undefined,
      undefined,
      'tree',
      mockResourceRegistry
    );
    
    expect(result.content).toContain('{"key": "value"}');
  });
});