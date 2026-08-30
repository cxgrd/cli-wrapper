/**
 * Git Hook Manager
 * 
 * Manages pre-commit hooks integration with cxgrd
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync, unlinkSync } from 'fs';
import { resolve } from 'path';

export interface HookConfig {
  enabled: boolean;
  blockOnCritical: boolean;
  blockOnHigh: boolean;
  warnOnMedium: boolean;
  autoFixSuggestions: boolean;
  ignoredPatterns: string[];
  riskThreshold: number; // 0-100
  notifySlack?: string;
}

export class GitHookManager {
  private projectRoot: string;
  private hooksDir: string;
  private gitDir: string;
  private cgDir: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.gitDir = resolve(projectRoot, '.git');
    this.hooksDir = resolve(this.gitDir, 'hooks');
    this.cgDir = resolve(projectRoot, '.cg');
  }

  /**
   * Initialize pre-commit hook setup
   */
  async setupHooks(config?: Partial<HookConfig>): Promise<void> {
    const fullConfig: HookConfig = {
      enabled: true,
      blockOnCritical: true,
      blockOnHigh: false,
      warnOnMedium: true,
      autoFixSuggestions: true,
      ignoredPatterns: ['**/*.test.ts', '**/*.spec.ts', 'docs/**', '*.md'],
      riskThreshold: 70,
      ...config,
    };

    // Create .cg directory if needed
    if (!existsSync(this.cgDir)) {
      mkdirSync(this.cgDir, { recursive: true });
    }

    // Create hooks directory if needed
    if (!existsSync(this.hooksDir)) {
      mkdirSync(this.hooksDir, { recursive: true });
    }

    if (process.platform === 'win32') {
      this.createWindowsHook();
    }

    // Save hook configuration
    this.writeHookConfig(fullConfig);

    // Create pre-commit hook script
    this.createPreCommitHook();

    // Make hook executable using Node fs (cross-platform)
    this.makeExecutable(resolve(this.hooksDir, 'pre-commit'));
  }

  /**
   * Create the actual pre-commit hook script
   */
  private createPreCommitHook(): void {
    const hookScript = `#!/bin/sh
# cxgrd pre-commit hook
# Prevents commits that break the architecture

# Get the project root
PROJECT_ROOT="$(git rev-parse --show-toplevel)"
CG_DIR="$PROJECT_ROOT/.cg"
HOOK_CONFIG="$CG_DIR/hooks.json"

# Check if cxgrd is available
if ! command -v cxgrd > /dev/null 2>&1; then
  echo "warning: cxgrd not found in PATH. Skipping architecture check."
  exit 0
fi

# Check if hook config exists
if [ ! -f "$HOOK_CONFIG" ]; then
  exit 0
fi

# Get staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMRUX)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

echo "Running cxgrd check (policy + check)..."

# Team policy + blast radius + check (falls back to check-only on Free/Pro)
if ! cxgrd check "$PROJECT_ROOT"; then
  echo "Architecture check failed. Commit blocked."
  exit 1
fi

exit 0
`;

    writeFileSync(resolve(this.hooksDir, 'pre-commit'), hookScript, { encoding: 'utf-8' });
  }

  private createWindowsHook(): void {
    const batScript = `@echo off
    git diff --cached --name-only --diff-filter=ACMRUX > nul 2>&1
    if %errorlevel% neq 0 exit /b 0
    echo Running cxgrd check...
    cxgrd check
    if %errorlevel% neq 0 (
    echo Architecture check failed. Commit blocked.
    exit /b 1
    )
    exit /b 0
    `;
    writeFileSync(resolve(this.hooksDir, 'pre-commit.bat'), batScript, { encoding: 'utf-8' });
  }

  /**
   * Write hook configuration to .cg/hooks.json
   */
  private writeHookConfig(config: HookConfig): void {
    const configPath = resolve(this.cgDir, 'hooks.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Read hook configuration
   */
  readHookConfig(): HookConfig | null {
    const configPath = resolve(this.cgDir, 'hooks.json');
    if (!existsSync(configPath)) return null;
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * Make file executable — uses Node's chmodSync (cross-platform safe)
   * On Windows this is a no-op but won't throw
   */
  private makeExecutable(filePath: string): void {
    try {
      // 0o755 = rwxr-xr-x — works on macOS/Linux, silently ignored on Windows
      chmodSync(filePath, 0o755);
    } catch {
      // Silently ignore — Windows doesn't support Unix permissions
    }
  }

  /**
   * Check if hooks are installed
   */
  isInstalled(): boolean {
    const hookPath = resolve(this.hooksDir, 'pre-commit');
    if (!existsSync(hookPath)) return false;
    try {
      const content = readFileSync(hookPath, 'utf-8');
      return content.includes('cxgrd');
    } catch {
      return false;
    }
  }

  /**
   * Uninstall hooks — uses Node's unlinkSync instead of shell rm
   */
  async uninstallHooks(): Promise<void> {
    const hookPath = resolve(this.hooksDir, 'pre-commit');
    if (existsSync(hookPath)) {
      try { unlinkSync(hookPath); } catch { /* ignore */ }
    }

    const configPath = resolve(this.cgDir, 'hooks.json');
    if (existsSync(configPath)) {
      try { unlinkSync(configPath); } catch { /* ignore */ }
    }
  }

  /**
   * Get hooks status
   */
  getStatus(): {
    installed: boolean;
    enabled: boolean;
    config: HookConfig | null;
  } {
    const config = this.readHookConfig();
    return {
      installed: this.isInstalled(),
      enabled: config?.enabled ?? false,
      config,
    };
  }

  /**
   * Enable/disable hooks
   */
  setEnabled(enabled: boolean): void {
    const config = this.readHookConfig();
    if (config) {
      config.enabled = enabled;
      const configPath = resolve(this.cgDir, 'hooks.json');
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
  }

  /**
   * Update risk threshold
   */
  setRiskThreshold(threshold: number): void {
    const config = this.readHookConfig();
    if (config) {
      config.riskThreshold = Math.max(0, Math.min(100, threshold));
      const configPath = resolve(this.cgDir, 'hooks.json');
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
  }

  /**
   * Get staged files
   */
  getStagedFiles(): string[] {
    try {
      const output = execSync('git diff --cached --name-only --diff-filter=ACMRUX', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
      });
      return output.split('\n').filter(f => f.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Check if file matches ignored patterns
   */
  isIgnored(filePath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.');
      if (new RegExp(`^${regexPattern}$`).test(filePath)) return true;
    }
    return false;
  }

  /**
   * Get all staged files not matching ignore patterns
   */
  getRelevantStagedFiles(ignorePatterns: string[]): string[] {
    return this.getStagedFiles().filter(
      file => !this.isIgnored(file, ignorePatterns)
    );
  }
}
