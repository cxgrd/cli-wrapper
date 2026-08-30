#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import { scanCommand } from './commands/scan';
import { inputCommand } from './commands/input';
import { promptCommand } from './commands/prompt';
import { checkCommand } from './commands/check';
import { initHooksCommand } from './commands/init-hooks';
import { watchCommand } from './commands/watch';
import { doctorCommand } from './commands/doctor';
import { authLoginCommand, authLogoutCommand, authStatusCommand } from './commands/auth';
import { loadCxgrdEnv } from './config/env';
import { printFirstRunNotice, trackEvent, optOut, optIn, isOptedOut } from './telemetry';

async function main() {
  await loadCxgrdEnv();
  printFirstRunNotice();

  try {
    await yargs(hideBin(process.argv))
      .command(
        'scan [path]',
        'Scan project and build dependency graph',
        (y: any) =>
          y
            .positional('path', { describe: 'Project path (default: current directory)', type: 'string' })
            .option('sync', { describe: 'Push graph to cloud after scan', type: 'boolean', default: false })
            .option('pull', { describe: 'Pull graph from cloud (Pro/Team plan)', type: 'boolean', default: false})
            .option('team', { describe: 'Require team session and push to shared team graph (Team plan)', type: 'boolean', default: false })
            .option('json', { describe: 'Output results in JSON format', type: 'boolean', default: false }),
        async (argv: any) => {
          trackEvent('cli_scan', { team: !!argv.team, sync: !!argv.sync, pull: !!argv.pull});
          await scanCommand(argv.path as string, { sync: argv.sync, pull: argv.pull, team: argv.team, json: argv.json });
        },
      )
      .command(
        'input <description>',
        'Analyze blast radius of a change',
        (y: any) =>
          y
            .positional('description', { describe: 'Description of the change', type: 'string' })
            .option('path', { describe: 'Project path (default: current directory)', type: 'string', alias: 'p' })
            .option('json', { describe: 'Output results in JSON format', type: 'boolean', default: false }),
        async (argv: any) => {
          trackEvent('cli_input');
          await inputCommand(argv.description as string, argv.path as string, { json: argv.json });
        },
      )
      .command(
        'prompt <description>',
        'Generate LLM-enriched AI prompt (Pro / Team)',
        (y: any) =>
          y
            .positional('description', { describe: 'Description of the change', type: 'string' })
            .option('path', { describe: 'Project path (default: current directory)', type: 'string', alias: 'p' }),
        async (argv: any) => {
          trackEvent('cli_prompt');
          await promptCommand(argv.description as string, argv.path as string);
        },
      )
      .command(
        'check [path]',
        'Validate architecture and run compiler-backed verification',
        (y: any) =>
          y
            .positional('path', { describe: 'Project path (default: current directory)', type: 'string' })
            .option('staged',          { describe: 'Only check git staged files', type: 'boolean', default: false })
            .option('changed',         { describe: 'Only check staged and unstaged changed files', type: 'boolean', default: false })
            .option('skip-compiler',   { describe: 'Skip compiler-backed verification', type: 'boolean', default: false })
            .option('skip-structural', { describe: 'Skip structural graph checks', type: 'boolean', default: false })
            .option('strict',          { describe: 'Fail if a detected language compiler was skipped', type: 'boolean', default: false })
            .option('ci',              { describe: 'CI mode: post result to server for GitHub PR status (Team plan)', type: 'boolean', default: false })
            .option('json', { describe: 'Output results in JSON format', type: 'boolean', default: false }),
        async (argv: any) => {
          const scope = argv.staged ? 'staged' : argv.changed ? 'changed' : 'all';
          trackEvent('cli_check', { scope, strict: !!argv.strict, ci: !!argv.ci });
          await checkCommand(argv.path as string, {
            scope,
            skipCompiler:   argv.skipCompiler,
            skipStructural: argv.skipStructural,
            strict:         argv.strict,
            ci:             argv.ci,
            json:           argv.json,
          });
        },
      )
      .command('auth', 'Sign in for Pro features (prompt, repo memory)', (y: any) =>
        y
          .command('login',  'Open browser to sign in with GitHub', {}, async () => { trackEvent('cli_auth_login');  await authLoginCommand(); })
          .command('logout', 'Remove stored credentials',           {}, async () => { trackEvent('cli_auth_logout'); await authLogoutCommand(); })
          .command('status', 'Show current plan and auth state',    {}, async () => { await authStatusCommand(); })
          .demandCommand(1, 'Specify auth login, logout, or status')
          .help(),
      )
      .command(
        'config',
        'Manage cxgrd settings',
        (y: any) =>
          y
            // Avoid --no-* prefix — yargs treats --no-X as boolean negation of --X
            // so --no-telemetry would set argv.telemetry = false, not argv.noTelemetry = true
            .option('disable-telemetry', { describe: 'Opt out of anonymous usage stats', type: 'boolean' })
            .option('enable-telemetry',  { describe: 'Re-enable anonymous usage stats',  type: 'boolean' }),
        (argv: any) => {
          if (argv.disableTelemetry) {
            optOut();
            console.log(chalk.green('✓ Telemetry disabled. No usage data will be sent.'));
          } else if (argv.enableTelemetry) {
            optIn();
            console.log(chalk.green('✓ Telemetry enabled. Thanks for helping improve cxgrd!'));
          } else {
            const status = isOptedOut() ? chalk.yellow('disabled') : chalk.green('enabled');
            console.log(`Telemetry: ${status}`);
            console.log(chalk.gray('  cxgrd config --disable-telemetry   disable'));
            console.log(chalk.gray('  cxgrd config --enable-telemetry    re-enable'));
          }
        },
      )
      .command(
        'doctor [path]',
        'Check runtime, compiler tools, and project readiness',
        (y: any) => y.positional('path', { describe: 'Project path (optional)', type: 'string' }),
        async (argv: any) => { trackEvent('cli_doctor'); await doctorCommand(argv.path as string); },
      )
      .command(
        'init-hooks [path]',
        'Set up pre-commit hooks for architecture checks',
        (y: any) =>
          y
            .positional('path', { describe: 'Project path (default: current directory)', type: 'string' })
            .option('block-critical', { type: 'boolean', default: true })
            .option('block-high', { type: 'boolean', default: false })
            .option('warn-medium', { type: 'boolean', default: true })
            .option('threshold', { type: 'number',  default: 70 })
            .option('uninstall', { type: 'boolean', default: false }),
        async (argv: any) => {
          trackEvent('cli_init_hooks', { uninstall: !!argv.uninstall });
          await initHooksCommand(argv.path as string, {
            blockCritical: argv.blockCritical,
            blockHigh: argv.blockHigh,
            warnMedium: argv.warnMedium,
            threshold: argv.threshold,
            uninstall: argv.uninstall,
          });
        },
      )
      .command(
        'watch [path]',
        'Monitor project for real-time architecture analysis',
        (y: any) =>
          y
            .positional('path',  { describe: 'Project path (default: current directory)', type: 'string' })
            .option('debounce',  { type: 'number', default: 500 }),
        async (argv: any) => { trackEvent('cli_watch'); await watchCommand(argv.path as string, { debounce: argv.debounce }); },
      )
      .version('1.0.0')
      .help()
      .alias('h', 'help')
      .epilogue(chalk.gray('For more information, visit: https://www.cxgrd.com'))
      .demandCommand(1, chalk.red('You must provide a command'))
      .strict()
      .parseAsync();
  } catch (err: any) {
    console.error(chalk.red(`✗ Error: ${err.message}`));
    process.exit(1);
  }
}

main();
