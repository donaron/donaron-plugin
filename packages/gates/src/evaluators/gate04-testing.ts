import { readFileSync } from 'node:fs';
import { resolveSafePluginPath, type ValidationResult } from '@donaron/core';
import { computeCodeHash } from '../hashing/scoped-hash.js';
import type { EvidenceStore } from '../store/evidence-store.js';
import type { GateCheckResult, GateDecisionRecord, GateFinding } from '../types.js';

export interface CoverageThresholds {
  readonly lines: number;
  readonly statements: number;
  readonly functions: number;
  readonly branches: number;
}

export const DEFAULT_COVERAGE_THRESHOLDS: CoverageThresholds = {
  lines: 70,
  statements: 70,
  functions: 70,
  branches: 70,
};

export interface ParsedTestRun {
  readonly totalTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  readonly skippedTests: number;
}

export interface TestRunnerParser {
  readonly name: string;
  parseTestResults(rawJson: string): ValidationResult<ParsedTestRun>;
}

function asNonNegativeInt(val: unknown): number | undefined {
  return typeof val === 'number' && Number.isInteger(val) && val >= 0 ? val : undefined;
}

export const vitestRunnerParser: TestRunnerParser = {
  name: 'vitest',
  parseTestResults(rawJson: string): ValidationResult<ParsedTestRun> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return {
        ok: false,
        issues: [
          {
            code: 'TEST_RESULTS_INVALID_JSON',
            path: 'testResults',
            message: 'Vitest test results output is not valid JSON.',
          },
        ],
      };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        issues: [
          {
            code: 'TEST_RESULTS_NOT_OBJECT',
            path: 'testResults',
            message: 'Vitest test results JSON must be an object.',
          },
        ],
      };
    }

    const obj = parsed as Record<string, unknown>;
    const totalTests = asNonNegativeInt(obj.numTotalTests);
    const passedTests = asNonNegativeInt(obj.numPassedTests);
    const failedTests = asNonNegativeInt(obj.numFailedTests);
    const pendingTests = asNonNegativeInt(obj.numPendingTests ?? 0);
    const todoTests = asNonNegativeInt(obj.numTodoTests ?? 0);

    if (
      totalTests === undefined ||
      passedTests === undefined ||
      failedTests === undefined ||
      pendingTests === undefined ||
      todoTests === undefined
    ) {
      return {
        ok: false,
        issues: [
          {
            code: 'TEST_RESULTS_MISSING_COUNTS',
            path: 'testResults',
            message:
              'Vitest JSON output is missing required numeric test counts (numTotalTests, numPassedTests, numFailedTests).',
          },
        ],
      };
    }

    return {
      ok: true,
      value: {
        totalTests,
        passedTests,
        failedTests,
        skippedTests: pendingTests + todoTests,
      },
    };
  },
};

export const junitRunnerParser: TestRunnerParser = {
  name: 'junit',
  parseTestResults(rawXml: string): ValidationResult<ParsedTestRun> {
    const suiteMatches = [...rawXml.matchAll(/<testsuite\b([^>]*)>/gi)];
    if (suiteMatches.length === 0) {
      return {
        ok: false,
        issues: [
          {
            code: 'TEST_RESULTS_INVALID_JUNIT',
            path: 'testResults',
            message: 'JUnit XML output does not contain any <testsuite> elements.',
          },
        ],
      };
    }

    let totalTests = 0;
    let failedTests = 0;
    let skippedTests = 0;
    let foundTestsAttr = false;

    for (const match of suiteMatches) {
      const attrs = match[1] ?? '';
      const readAttr = (name: string): number => {
        const m = new RegExp(`\\b${name}\\s*=\\s*["'](\\d+)["']`, 'i').exec(attrs);
        return m?.[1] !== undefined ? Number.parseInt(m[1], 10) : 0;
      };
      if (/\btests\s*=\s*["']\d+["']/i.test(attrs)) {
        foundTestsAttr = true;
      }
      totalTests += readAttr('tests');
      failedTests += readAttr('failures') + readAttr('errors');
      skippedTests += readAttr('skipped');
    }

    if (!foundTestsAttr) {
      return {
        ok: false,
        issues: [
          {
            code: 'TEST_RESULTS_MISSING_COUNTS',
            path: 'testResults',
            message: 'JUnit <testsuite> elements are missing the "tests" attribute.',
          },
        ],
      };
    }

    const passedTests = Math.max(0, totalTests - failedTests - skippedTests);
    return {
      ok: true,
      value: {
        totalTests,
        passedTests,
        failedTests,
        skippedTests,
      },
    };
  },
};

export interface Gate04Input {
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly store: EvidenceStore;
  readonly testResultsPath?: string;
  readonly testRun?: ParsedTestRun;
  readonly coverageSummaryPath?: string;
  readonly coverageFormat?: 'istanbul-summary' | 'lcov';
  readonly thresholds?: CoverageThresholds;
  readonly requiredPackages?: readonly string[];
  readonly allowSkippedTests?: boolean;
  readonly parser?: TestRunnerParser;
}

interface CoverageMetricEntry {
  readonly total: number;
  readonly covered: number;
  readonly pct: number;
}

interface CoverageFileSummary {
  readonly lines: CoverageMetricEntry;
  readonly statements: CoverageMetricEntry;
  readonly functions: CoverageMetricEntry;
  readonly branches: CoverageMetricEntry;
}

const COVERAGE_METRICS = ['lines', 'statements', 'functions', 'branches'] as const;

function isCoverageMetricEntry(val: unknown): val is CoverageMetricEntry {
  if (typeof val !== 'object' || val === null) {
    return false;
  }
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.total === 'number' && typeof obj.covered === 'number' && typeof obj.pct === 'number'
  );
}

function isCoverageFileSummary(val: unknown): val is CoverageFileSummary {
  if (typeof val !== 'object' || val === null) {
    return false;
  }
  const obj = val as Record<string, unknown>;
  return (
    isCoverageMetricEntry(obj.lines) &&
    isCoverageMetricEntry(obj.statements) &&
    isCoverageMetricEntry(obj.functions) &&
    isCoverageMetricEntry(obj.branches)
  );
}

function toMetricEntry(total: number, covered: number): CoverageMetricEntry {
  return {
    total,
    covered,
    pct: total === 0 ? 100 : Number(((100 * covered) / total).toFixed(2)),
  };
}

export function parseLcovToSummaryMap(rawLcov: string): Record<string, unknown> | null {
  const lines = rawLcov.split(/\r?\n/);
  const summaryMap: Record<string, CoverageFileSummary> = {};
  let currentFile: string | undefined;
  let lf = 0;
  let lh = 0;
  let fnf = 0;
  let fnh = 0;
  let brf = 0;
  let brh = 0;
  let hasRecord = false;

  let totalLines = 0;
  let coveredLines = 0;
  let totalFuncs = 0;
  let coveredFuncs = 0;
  let totalBranches = 0;
  let coveredBranches = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('SF:')) {
      currentFile = line.slice(3).trim().replaceAll('\\', '/');
      lf = 0;
      lh = 0;
      fnf = 0;
      fnh = 0;
      brf = 0;
      brh = 0;
    } else if (line.startsWith('LF:')) {
      lf = Number.parseInt(line.slice(3), 10) || 0;
    } else if (line.startsWith('LH:')) {
      lh = Number.parseInt(line.slice(3), 10) || 0;
    } else if (line.startsWith('FNF:')) {
      fnf = Number.parseInt(line.slice(4), 10) || 0;
    } else if (line.startsWith('FNH:')) {
      fnh = Number.parseInt(line.slice(4), 10) || 0;
    } else if (line.startsWith('BRF:')) {
      brf = Number.parseInt(line.slice(4), 10) || 0;
    } else if (line.startsWith('BRH:')) {
      brh = Number.parseInt(line.slice(4), 10) || 0;
    } else if (line === 'end_of_record' && currentFile !== undefined) {
      hasRecord = true;
      const lineEntry = toMetricEntry(lf, lh);
      summaryMap[currentFile] = {
        lines: lineEntry,
        statements: lineEntry,
        functions: toMetricEntry(fnf, fnh),
        branches: toMetricEntry(brf, brh),
      };
      totalLines += lf;
      coveredLines += lh;
      totalFuncs += fnf;
      coveredFuncs += fnh;
      totalBranches += brf;
      coveredBranches += brh;
      currentFile = undefined;
    }
  }

  if (!hasRecord) {
    return null;
  }

  const totalLineEntry = toMetricEntry(totalLines, coveredLines);
  return {
    total: {
      lines: totalLineEntry,
      statements: totalLineEntry,
      functions: toMetricEntry(totalFuncs, coveredFuncs),
      branches: toMetricEntry(totalBranches, coveredBranches),
    },
    ...summaryMap,
  };
}

export function evaluateGate04Testing(input: Gate04Input): GateDecisionRecord {
  const now = new Date().toISOString();
  const stateResult = input.store.loadRunState(input.runId);
  if (!stateResult.ok) {
    const failRecord: GateDecisionRecord = {
      gateId: 'GATE_04',
      gateVersion: '1.0.0',
      runId: input.runId,
      evaluator: { type: 'deterministic', id: 'gate04-testing' },
      checks: [{ name: 'run-state', passed: false, summary: 'Workflow run state not found.' }],
      evidenceRefs: [],
      findings: stateResult.issues.map((i, idx) => ({
        id: `gate04-state-${String(idx + 1)}`,
        severity: 'critical',
        message: i.message,
        ruleId: i.code,
      })),
      decision: 'FAIL',
      timestamp: now,
    };
    input.store.recordGateDecision(failRecord);
    return failRecord;
  }

  const state = stateResult.value;
  const codeHashResult = computeCodeHash(input.workspaceRoot, { planFiles: state.planFiles });
  if (!codeHashResult.ok) {
    const failRecord: GateDecisionRecord = {
      gateId: 'GATE_04',
      gateVersion: '1.0.0',
      runId: input.runId,
      evaluator: { type: 'deterministic', id: 'gate04-testing' },
      checks: [{ name: 'code-hash', passed: false, summary: 'Failed to compute codeHash.' }],
      evidenceRefs: [],
      findings: codeHashResult.issues.map((i, idx) => ({
        id: `gate04-hash-${String(idx + 1)}`,
        severity: 'high',
        message: i.message,
        ruleId: i.code,
      })),
      decision: 'FAIL',
      timestamp: now,
    };
    input.store.recordGateDecision(failRecord);
    return failRecord;
  }

  const { codeHash } = codeHashResult.value;
  const checks: GateCheckResult[] = [];
  const findings: GateFinding[] = [];
  const evidenceRefs: string[] = [];

  // 1. Resolve & validate test execution results
  let testRun: ParsedTestRun | undefined = input.testRun;
  if (testRun === undefined) {
    const resultsRelPath = input.testResultsPath ?? 'coverage/test-results.json';
    const resolved = resolveSafePluginPath(input.workspaceRoot, resultsRelPath, {
      mustExist: true,
    });
    if (!resolved.ok) {
      findings.push({
        id: 'gate04-test-results-missing',
        severity: 'high',
        message: `Test results file is missing or unsafe: ${resultsRelPath}`,
        ruleId: 'TEST_RESULTS_MISSING',
      });
    } else {
      evidenceRefs.push(resolved.value.relativePosixPath);
      const parser = input.parser ?? vitestRunnerParser;
      const parsed = parser.parseTestResults(readFileSync(resolved.value.absolutePath, 'utf8'));
      if (!parsed.ok) {
        for (const issue of parsed.issues) {
          findings.push({
            id: `gate04-test-parse-${issue.code}`,
            severity: 'high',
            message: issue.message,
            ruleId: issue.code,
          });
        }
      } else {
        testRun = parsed.value;
      }
    }
  }

  if (testRun === undefined) {
    checks.push({
      name: 'test-execution',
      passed: false,
      summary: 'Test execution results could not be loaded.',
    });
  } else {
    const hasTests = testRun.totalTests > 0 && testRun.passedTests > 0;
    const zeroFailures = testRun.failedTests === 0;
    const skippedOk = input.allowSkippedTests === true || testRun.skippedTests === 0;
    const testPassed = hasTests && zeroFailures && skippedOk;

    checks.push({
      name: 'test-execution',
      passed: testPassed,
      summary: `Tests — total: ${String(testRun.totalTests)}, passed: ${String(testRun.passedTests)}, failed: ${String(testRun.failedTests)}, skipped: ${String(testRun.skippedTests)}.`,
    });

    if (!hasTests) {
      findings.push({
        id: 'gate04-zero-tests',
        severity: 'high',
        message: 'Test suite executed 0 passing tests (fail-closed).',
        ruleId: 'ZERO_TESTS_EXECUTED',
      });
    }
    if (!zeroFailures) {
      findings.push({
        id: 'gate04-test-failures',
        severity: 'high',
        message: `Test suite had ${String(testRun.failedTests)} failing test(s).`,
        ruleId: 'TEST_FAILURES_PRESENT',
      });
    }
    if (!skippedOk) {
      findings.push({
        id: 'gate04-skipped-tests',
        severity: 'high',
        message: `Test suite had ${String(testRun.skippedTests)} skipped/todo test(s), which are disallowed by Gate 04.`,
        ruleId: 'SKIPPED_TESTS_FORBIDDEN',
      });
    }
  }

  // 2. Coverage summary evaluation (aggregate + per-package)
  const thresholds = input.thresholds ?? DEFAULT_COVERAGE_THRESHOLDS;
  const covFormat = input.coverageFormat ?? 'istanbul-summary';
  const covRelPath =
    input.coverageSummaryPath ??
    (covFormat === 'lcov' ? 'coverage/lcov.info' : 'coverage/coverage-summary.json');
  const resolvedCov = resolveSafePluginPath(input.workspaceRoot, covRelPath, { mustExist: true });

  if (!resolvedCov.ok) {
    checks.push({
      name: 'coverage-thresholds',
      passed: false,
      summary: `Coverage summary file missing: ${covRelPath}`,
    });
    findings.push({
      id: 'gate04-coverage-missing',
      severity: 'high',
      message: `Coverage summary file not found at ${covRelPath} (fail-closed).`,
      ruleId: 'COVERAGE_REPORT_MISSING',
    });
  } else {
    evidenceRefs.push(resolvedCov.value.relativePosixPath);
    let rawSummary: unknown;
    try {
      const rawCovText = readFileSync(resolvedCov.value.absolutePath, 'utf8');
      rawSummary =
        covFormat === 'lcov' ? parseLcovToSummaryMap(rawCovText) : JSON.parse(rawCovText);
    } catch {
      rawSummary = null;
    }

    if (
      typeof rawSummary !== 'object' ||
      rawSummary === null ||
      Array.isArray(rawSummary) ||
      !isCoverageFileSummary((rawSummary as Record<string, unknown>).total)
    ) {
      checks.push({
        name: 'coverage-thresholds',
        passed: false,
        summary: 'Coverage summary JSON is malformed or missing "total" metrics.',
      });
      findings.push({
        id: 'gate04-coverage-malformed',
        severity: 'high',
        message: 'Coverage summary JSON is invalid or missing total metrics.',
        ruleId: 'COVERAGE_REPORT_MALFORMED',
      });
    } else {
      const summaryMap = rawSummary as Record<string, unknown>;
      const totalEntry = summaryMap.total as CoverageFileSummary;
      let aggregatePassed = true;

      for (const metric of COVERAGE_METRICS) {
        const actualPct = totalEntry[metric].pct;
        const requiredPct = thresholds[metric];
        if (actualPct < requiredPct) {
          aggregatePassed = false;
          findings.push({
            id: `gate04-total-${metric}-below`,
            severity: 'high',
            message: `Aggregate ${metric} coverage ${String(actualPct)}% is below required ${String(requiredPct)}%.`,
            ruleId: 'COVERAGE_BELOW_THRESHOLD',
          });
        }
      }

      checks.push({
        name: 'coverage-aggregate',
        passed: aggregatePassed,
        summary: `Aggregate coverage — lines: ${String(totalEntry.lines.pct)}%, statements: ${String(totalEntry.statements.pct)}%, functions: ${String(totalEntry.functions.pct)}%, branches: ${String(totalEntry.branches.pct)}%.`,
      });

      // Per-package check in monorepos
      const fileEntries = Object.entries(summaryMap).filter(
        ([key, val]) => key !== 'total' && isCoverageFileSummary(val),
      ) as [string, CoverageFileSummary][];

      for (const rawPkg of input.requiredPackages ?? []) {
        const pkgPrefix = rawPkg
          .trim()
          .replaceAll('\\', '/')
          .replace(/^\/+|\/+$/g, '');
        if (pkgPrefix.length === 0) {
          continue;
        }
        const matched = fileEntries.filter(([filePath]) =>
          filePath.replaceAll('\\', '/').includes(`${pkgPrefix}/src/`),
        );

        if (matched.length === 0) {
          checks.push({
            name: `coverage-package:${pkgPrefix}`,
            passed: false,
            summary: `No instrumented source files found for required package "${pkgPrefix}".`,
          });
          findings.push({
            id: `gate04-pkg-missing-${pkgPrefix.replaceAll('/', '-')}`,
            severity: 'high',
            message: `Required workspace package "${pkgPrefix}" had 0 entries in coverage-summary.json.`,
            ruleId: 'PACKAGE_COVERAGE_MISSING',
          });
          continue;
        }

        let pkgPassed = true;
        const metricPcts: Record<string, number> = {};
        for (const metric of COVERAGE_METRICS) {
          let totalCount = 0;
          let coveredCount = 0;
          for (const [, fileCov] of matched) {
            totalCount += fileCov[metric].total;
            coveredCount += fileCov[metric].covered;
          }
          const pct =
            totalCount === 0 ? 100 : Number(((100 * coveredCount) / totalCount).toFixed(2));
          metricPcts[metric] = pct;
          if (pct < thresholds[metric]) {
            pkgPassed = false;
            findings.push({
              id: `gate04-pkg-${pkgPrefix.replaceAll('/', '-')}-${metric}`,
              severity: 'high',
              message: `Package "${pkgPrefix}" ${metric} coverage ${String(pct)}% is below required ${String(thresholds[metric])}%.`,
              ruleId: 'PACKAGE_COVERAGE_BELOW_THRESHOLD',
            });
          }
        }

        checks.push({
          name: `coverage-package:${pkgPrefix}`,
          passed: pkgPassed,
          summary: `Package ${pkgPrefix} — lines: ${String(metricPcts.lines)}%, statements: ${String(metricPcts.statements)}%, functions: ${String(metricPcts.functions)}%, branches: ${String(metricPcts.branches)}%.`,
        });
      }
    }
  }

  const hasBlockingFinding = findings.some(
    (f) => f.severity === 'critical' || f.severity === 'high',
  );
  const allChecksPassed = checks.every((c) => c.passed);

  const record: GateDecisionRecord = {
    gateId: 'GATE_04',
    gateVersion: '1.0.0',
    runId: input.runId,
    codeHash,
    evaluator: { type: 'deterministic', id: 'gate04-testing' },
    checks,
    evidenceRefs,
    findings,
    decision: allChecksPassed && !hasBlockingFinding ? 'PASS' : 'FAIL',
    timestamp: now,
  };

  input.store.recordGateDecision(record);
  return record;
}
