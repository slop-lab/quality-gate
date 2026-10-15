export type ScanMode = "changed" | "full";

export type ChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type_changed"
  | "mode_changed"
  | "unmerged"
  | "unknown";

export interface ChangeEntry {
  status: ChangeStatus;
  path: string;
  oldPath?: string;
  mode?: string;
  similarity?: number;
}

export interface ChangedProviderOptions {
  root: string;
  base?: string;
  head?: string;
  staged?: boolean;
  workingTree?: boolean;
}

export interface ChangedProvider {
  getChanged(options: ChangedProviderOptions): Promise<ChangeEntry[]>;
}

export interface FileSystemProvider {
  exists(path: string): Promise<boolean>;
  isFile(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  readDirectory(path: string): Promise<DirectoryEntry[]>;
  readFile(path: string): Promise<string>;
  readFileBytes(path: string): Promise<Uint8Array>;
}

export interface ProcessProvider {
  exec(options: ProcessExecOptions): Promise<ProcessResult>;
}

export interface ProcessExecOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink" | "other";
}

export type DiagnosticSeverity = "error" | "warning" | "info";
export type RuleScope = "file" | "directory" | "package" | "repo";

export interface Diagnostic {
  ruleId: string;
  severity: DiagnosticSeverity;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  scope: RuleScope;
  suggestedFix?: SuggestedFix;
  docsUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface SuggestedFix {
  message: string;
  edits?: FileEdit[];
}

export type FileEdit =
  | {
      type: "deleteFile";
      path: string;
    }
  | {
      type: "replaceText";
      path: string;
      start: number;
      end: number;
      text: string;
    };

export interface RuleMetadata<TOptions = unknown> {
  id: string;
  name: string;
  description: string;
  defaultSeverity: DiagnosticSeverity;
  supports: ScanMode[];
  scope: RuleScope;
  requires: string[];
  fixable: "none" | "suggestion" | "edit";
  docsUrl?: string;
  defaultOptions?: TOptions;
}

export interface RuleContext<TOptions = unknown> {
  root: string;
  mode: ScanMode;
  changes: ChangeEntry[];
  fs: FileSystemProvider;
  process: ProcessProvider;
  options: TOptions;
  severity: DiagnosticSeverity;
  resolveConfig(path: string): ResolvedRuleConfig<TOptions>;
}

export interface ResolvedRuleConfig<TOptions = unknown> {
  enabled: boolean;
  severity: DiagnosticSeverity;
  options: TOptions;
}

export interface Rule<TOptions = unknown> {
  metadata: RuleMetadata<TOptions>;
  check(context: RuleContext<TOptions>): Promise<Diagnostic[]>;
}

export type RuleConfig<TOptions = unknown> =
  | DiagnosticSeverity
  | "off"
  | [DiagnosticSeverity, TOptions]
  | ["off", TOptions];

export interface QualityGateConfig {
  scan?: {
    defaultMode?: ScanMode;
    base?: string;
  };
  rules?: Record<string, RuleConfig>;
  overrides?: QualityGateOverride[];
}

export interface QualityGateOverride {
  files: string[];
  excludedFiles?: string[];
  rules: Record<string, RuleConfig>;
}

export interface RunOptions {
  root: string;
  mode?: ScanMode;
  base?: string;
  head?: string;
  staged?: boolean;
  workingTree?: boolean;
  rules: Rule[];
  config?: QualityGateConfig;
  changedProvider?: ChangedProvider;
  fs?: FileSystemProvider;
  process?: ProcessProvider;
}

export interface RunResult {
  mode: ScanMode;
  changes: ChangeEntry[];
  diagnostics: Diagnostic[];
}
