export type DiagnosticSeverity = "info" | "warning" | "error";

export type DiagnosticSource = "discovery" | "plugin" | "registry";

export interface CcskiDiagnostic {
  severity: DiagnosticSeverity;
  source: DiagnosticSource;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function diagnosticToWarning(diagnostic: CcskiDiagnostic): string {
  return `[${diagnostic.source}:${diagnostic.code}] ${diagnostic.message}`;
}
