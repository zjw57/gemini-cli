/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveEnvVarsInString } from '../../utils/envVarResolver.js';
import { type VariableSchema, VARIABLE_SCHEMA } from './variableSchema.js';

export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonArray;

export type VariableContext = {
  [key in keyof typeof VARIABLE_SCHEMA]?: string;
};

export function validateVariables(
  variables: VariableContext,
  schema: VariableSchema,
) {
  for (const key in schema) {
    const definition = schema[key];
    if (definition.required && !variables[key as keyof VariableContext]) {
      throw new Error(`Missing required variable: ${key}`);
    }
  }
}

export function hydrateString(
  str: string,
  context: VariableContext,
  customEnv?: Record<string, string>,
): string {
  validateVariables(context, VARIABLE_SCHEMA);
  const regex = /\${(.*?)}/g;
  const hydratedString = str.replace(regex, (match, key) =>
    context[key as keyof VariableContext] == null
      ? match
      : (context[key as keyof VariableContext] as string),
  );
  return resolveEnvVarsInString(hydratedString, customEnv);
}

export function recursivelyHydrateStrings(
  obj: JsonValue,
  values: VariableContext,
  customEnv?: Record<string, string>,
): JsonValue {
  if (typeof obj === 'string') {
    return hydrateString(obj, values, customEnv);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      recursivelyHydrateStrings(item, values, customEnv),
    );
  }
  if (typeof obj === 'object' && obj !== null) {
    const newObj: JsonObject = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        newObj[key] = recursivelyHydrateStrings(obj[key], values, customEnv);
      }
    }
    return newObj;
  }
  return obj;
}
