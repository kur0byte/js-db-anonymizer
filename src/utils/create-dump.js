#!/usr/bin/env node
// src/utils/create-dump.js

import { program } from 'commander';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

const execAsync = promisify(exec);

program
  .option('-h, --host <host>', 'Database host', 'localhost')
  .option('-p, --port <port>', 'Database port', '5432')
  .option('-U, --user <user>', 'Database user', 'postgres')
  .option('-d, --database <database>', 'Database name', 'postgres')
  .option('-f, --file <file>', 'Output file name', 'database_dump.sql')
  .parse(process.argv);

const options = program.opts();

async function createDump() {
  try {
    logger.info('Creating database dump...');
    
    const command = [
      'pg_dump',
      `-h ${options.host}`,
      `-p ${options.port}`,
      `-U ${options.user}`,
      `-d ${options.database}`,
      '--format=plain',
      '--verbose',
      '--no-owner',
      '--no-acl',
      `--file=${options.file}`
    ].join(' ');

    const { stdout, stderr } = await execAsync(command);
    
    if (stderr) {
      logger.warn('Dump warnings:', stderr);
    }
    
    logger.info(`Database dump created successfully: ${options.file}`);
  } catch (error) {
    logger.error('Failed to create database dump:', error);
    process.exit(1);
  }
}

createDump();

// import { program } from 'commander';
// import { exec } from 'child_process';
// import { promisify } from 'util';
// import { logger } from './logger.js';

// const execAsync = promisify(exec);

// program
//   .option('-h, --host <host>', 'Database host', 'localhost')
//   .option('-p, --port <port>', 'Database port', '5432')
//   .option('-U, --user <user>', 'Database user', 'postgres')
//   .option('-d, --database <database>', 'Database name', 'postgres')
//   .option('-f, --file <file>', 'Output file name', 'database_dump.sql')
//   .option('-Z, --compress <level>', 'Compression level (0-9)', '5')
//   .option('-x, --exclude <tables>', 'Tables to exclude (comma-separated)')
//   .parse(process.argv);

// const options = program.opts();

// async function createDump() {
//   try {
//     logger.info('Starting database dump...');
    
//     const env = {
//       ...process.env,
//       PGCONNECT_TIMEOUT: '60',
//       PGOPTIONS: '--client-min-messages=warning',
//       PGPASSWORD: process.env.PGPASSWORD
//     };

//     const command = [
//       'pg_dump',
//       `-h ${options.host}`,
//       `-p ${options.port}`,
//       `-U ${options.user}`,
//       `-d ${options.database}`,
//       `-Z ${options.compress}`,
//       '--format=plain',
//       '--verbose',
//       '--no-owner',
//       '--no-acl',
//       '--no-comments',
//       '--no-tablespaces',
//       '--encoding=UTF8'
//     ];

//     if (options.exclude) {
//       const tables = options.exclude.split(',');
//       tables.forEach(table => {
//         command.push(`--exclude-table=${table.trim()}`);
//       });
//     }

//     // Ensure correct file extension
//     const outputFile = options.file.endsWith('.sql') ? 
//       options.file : 
//       `${options.file.replace(/\.[^/.]+$/, '')}.sql`;

//     command.push(`--file=${outputFile}`);

//     const { stdout, stderr } = await execAsync(command.join(' '), {
//       env,
//       maxBuffer: 1024 * 1024 * 100
//     });
    
//     if (stderr) {
//       logger.warn('Dump warnings:', stderr);
//     }
    
//     logger.info(`Database dump created successfully: ${outputFile}`);
//     logger.info(`To restore: pg_restore -d [database_name] ${outputFile}`);
//   } catch (error) {
//     logger.error('Failed to create database dump:', error);
//     process.exit(1);
//   }
// }

// createDump();