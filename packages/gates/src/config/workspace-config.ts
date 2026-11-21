import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ValidationIssue, ValidationResult } from '@donaron/core';

export type WorkspaceStack = 'node' | 'python' | 'go' | 'rust' | 'flutter' | 'custom';
export type TestResultsFormat = 'vitest' | 'junit';
export type CoverageFormat = 'istanbul-summary' | 'lcov';

export interface WorkspaceStackConfig {
  readonly stack: WorkspaceStack;
  readonly typecheckCommand: string;
  readonly lintCommand: string;
  readonly testCommand?: string;
  readonly auditCommand?: string;
  readonly testResultsFormat: TestResultsFormat;
  readonly testResultsPath: string;
  readonly coverageFormat: CoverageFormat;
  readonly coveragePath: string;
  readonly minimumCoveragePct: number;
  readonly aiApplication?: boolean;
}

const STACK_DEFAULTS: Readonly<Record<WorkspaceStack, WorkspaceStackConfig>> = {
  node: {
    stack: 'node',
    typecheckCommand: 'pnpm run typecheck',
    lintCommand: 'pnpm run lint',
    testResultsFormat: 'vitest',
    testResultsPath: 'coverage/test-results.json',
    coverageFormat: 'istanbul-summary',
    coveragePath: 'coverage/coverage-summary.json',
    minimumCoveragePct: 70,
  },
  python: {
    stack: 'python',
    typecheckCommand: 'mypy .',
    lintCommand: 'ruff check .',
    testResultsFormat: 'junit',
    testResultsPath: 'coverage/junit.xml',
    coverageFormat: 'lcov',
    coveragePath: 'coverage/lcov.info',
    minimumCoveragePct: 70,
  },
  go: {
    stack: 'go',
    typecheckCommand: 'go vet ./...',
    lintCommand: 'golangci-lint run',
    testResultsFormat: 'junit',
    testResultsPath: 'coverage/junit.xml',
    coverageFormat: 'lcov',
    coveragePath: 'coverage/lcov.info',
    minimumCoveragePct: 70,
  },
  rust: {
    stack: 'rust',
    typecheckCommand: 'cargo check --all-targets',
    lintCommand: 'cargo clippy --all-targets -- -D warnings',
    testResultsFormat: 'junit',
    testResultsPath: 'coverage/junit.xml',
    coverageFormat: 'lcov',
    coveragePath: 'coverage/lcov.info',
    minimumCoveragePct: 70,
  },
  flutter: {
    stack: 'flutter',
    typecheckCommand: 'dart analyze',
    lintCommand: 'dart format --output=none --set-exit-if-changed .',
    testResultsFormat: 'junit',
    testResultsPath: 'coverage/junit.xml',
    coverageFormat: 'lcov',
    coveragePath: 'coverage/lcov.info',
    minimumCoveragePct: 70,
  },
  custom: {
    stack: 'custom',
    typecheckCommand: 'pnpm run typecheck',
    lintCommand: 'pnpm run lint',
    testResultsFormat: 'junit',
    testResultsPath: 'coverage/junit.xml',
    coverageFormat: 'lcov',
    coveragePath: 'coverage/lcov.info',
    minimumCoveragePct: 70,
  },
};

const VALID_STACKS = new Set<WorkspaceStack>(['node', 'python', 'go', 'rust', 'flutter', 'custom']);
const VALID_TEST_FORMATS = new Set<TestResultsFormat>(['vitest', 'junit']);
const VALID_COVERAGE_FORMATS = new Set<CoverageFormat>(['istanbul-summary', 'lcov']);

export function detectWorkspaceStack(workspaceRoot: string): WorkspaceStack {
  if (existsSync(join(workspaceRoot, 'pubspec.yaml'))) {
    return 'flutter';
  }
  if (
    existsSync(join(workspaceRoot, 'pyproject.toml')) ||
    existsSync(join(workspaceRoot, 'requirements.txt'))
  ) {
    return 'python';
  }
  if (existsSync(join(workspaceRoot, 'go.mod'))) {
    return 'go';
  }
  if (existsSync(join(workspaceRoot, 'Cargo.toml'))) {
    return 'rust';
  }
  if (existsSync(join(workspaceRoot, 'package.json'))) {
    return 'node';
  }
  return 'custom';
}

function readOptionalString(
  obj: Record<string, unknown>,
  key: string,
  issues: ValidationIssue[],
): string | undefined {
  const val = obj[key];
  if (val === undefined) {
    return undefined;
  }
  if (typeof val !== 'string' || val.trim().length === 0) {
    issues.push({
      code: 'INVALID_CONFIG_STRING',
      path: key,
      message: `Config field "${key}" must be a non-empty string.`,
    });
    return undefined;
  }
  return val.trim();
}

export function loadWorkspaceConfig(workspaceRoot: string): ValidationResult<WorkspaceStackConfig> {
  const detectedStack = detectWorkspaceStack(workspaceRoot);
  const configPath = join(workspaceRoot, '.donaron', 'config.json');

  if (!existsSync(configPath)) {
    return { ok: true, value: STACK_DEFAULTS[detectedStack] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: 'WORKSPACE_CONFIG_INVALID_JSON',
          path: '.donaron/config.json',
          message: '.donaron/config.json is not valid JSON.',
        },
      ],
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      issues: [
        {
          code: 'WORKSPACE_CONFIG_NOT_OBJECT',
          path: '.donaron/config.json',
          message: '.donaron/config.json must be a JSON object.',
        },
      ],
    };
  }

  const obj = parsed as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  let stack: WorkspaceStack = detectedStack;
  if (obj.stack !== undefined) {
    if (typeof obj.stack !== 'string' || !VALID_STACKS.has(obj.stack as WorkspaceStack)) {
      issues.push({
        code: 'INVALID_STACK',
        path: 'stack',
        message: 'Config "stack" must be one of: node, python, go, rust, flutter, custom.',
      });
    } else {
      stack = obj.stack as WorkspaceStack;
    }
  }

  const base = STACK_DEFAULTS[stack];

  const typecheckCommand =
    readOptionalString(obj, 'typecheckCommand', issues) ?? base.typecheckCommand;
  const lintCommand = readOptionalString(obj, 'lintCommand', issues) ?? base.lintCommand;
  const testCommand = readOptionalString(obj, 'testCommand', issues);
  const auditCommand = readOptionalString(obj, 'auditCommand', issues);

  let testResultsFormat: TestResultsFormat = base.testResultsFormat;
  if (obj.testResultsFormat !== undefined) {
    if (
      typeof obj.testResultsFormat !== 'string' ||
      !VALID_TEST_FORMATS.has(obj.testResultsFormat as TestResultsFormat)
    ) {
      issues.push({
        code: 'INVALID_TEST_RESULTS_FORMAT',
        path: 'testResultsFormat',
        message: 'Config "testResultsFormat" must be "vitest" or "junit".',
      });
    } else {
      testResultsFormat = obj.testResultsFormat as TestResultsFormat;
    }
  }

  let coverageFormat: CoverageFormat = base.coverageFormat;
  if (obj.coverageFormat !== undefined) {
    if (
      typeof obj.coverageFormat !== 'string' ||
      !VALID_COVERAGE_FORMATS.has(obj.coverageFormat as CoverageFormat)
    ) {
      issues.push({
        code: 'INVALID_COVERAGE_FORMAT',
        path: 'coverageFormat',
        message: 'Config "coverageFormat" must be "istanbul-summary" or "lcov".',
      });
    } else {
      coverageFormat = obj.coverageFormat as CoverageFormat;
    }
  }

  const testResultsPath =
    readOptionalString(obj, 'testResultsPath', issues) ??
    (testResultsFormat === 'junit' ? 'coverage/junit.xml' : 'coverage/test-results.json');
  const coveragePath =
    readOptionalString(obj, 'coveragePath', issues) ??
    (coverageFormat === 'lcov' ? 'coverage/lcov.info' : 'coverage/coverage-summary.json');

  let minimumCoveragePct = base.minimumCoveragePct;
  if (obj.minimumCoveragePct !== undefined) {
    if (
      typeof obj.minimumCoveragePct !== 'number' ||
      Number.isNaN(obj.minimumCoveragePct) ||
      obj.minimumCoveragePct < 0 ||
      obj.minimumCoveragePct > 100
    ) {
      issues.push({
        code: 'INVALID_COVERAGE_THRESHOLD',
        path: 'minimumCoveragePct',
        message: 'Config "minimumCoveragePct" must be a number between 0 and 100.',
      });
    } else {
      minimumCoveragePct = obj.minimumCoveragePct;
    }
  }

  let aiApplication: boolean | undefined;
  if (obj.aiApplication !== undefined) {
    if (typeof obj.aiApplication !== 'boolean') {
      issues.push({
        code: 'INVALID_AI_APPLICATION_FLAG',
        path: 'aiApplication',
        message: 'Config "aiApplication" must be a boolean.',
      });
    } else {
      aiApplication = obj.aiApplication;
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      stack,
      typecheckCommand,
      lintCommand,
      ...(testCommand !== undefined ? { testCommand } : {}),
      ...(auditCommand !== undefined ? { auditCommand } : {}),
      testResultsFormat,
      testResultsPath,
      coverageFormat,
      coveragePath,
      minimumCoveragePct,
      ...(aiApplication !== undefined ? { aiApplication } : {}),
    },
  };
}
