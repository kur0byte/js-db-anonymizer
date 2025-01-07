import { logger } from '../utils/logger.js';
import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import readline from 'readline';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
const execAsync = promisify(exec);

export class Dumper {
  static async preprocessDump(dumpPath) {
    try {
      logger.info('Preprocessing dump file...');
      const tempPath = `${dumpPath}.processed`;
      
      const readStream = createReadStream(dumpPath);
      const writeStream = createWriteStream(tempPath);
      
      const transform = new Transform({
        transform(chunk, encoding, callback) {
          let data = chunk.toString()
            .replace(/SET transaction_timeout = 0;/g, '-- SET transaction_timeout = 0;')
            .replace(/SELECT pg_catalog.set_config\('search_path', '', false\);/g, 
                    "SELECT pg_catalog.set_config('search_path', 'public', false);");
          callback(null, data);
        }
      });

      await pipeline(readStream, transform, writeStream);
      logger.info('Dump file preprocessed successfully');
      
      return tempPath;
    } catch (error) {
      logger.error('Failed to preprocess dump file:', error);
      throw error;
    }
  }

  static async importDump(config, dumpPath) {
    if (!dumpPath) {
      throw new Error('No dump file provided');
    }

    let processedDumpPath = null;
    try {
      logger.info(`Importing dump from ${dumpPath}...`);
      
      // Preprocess the dump file
      processedDumpPath = await this.preprocessDump(dumpPath);
      
      // Create schemas first
      const createSchemasCommand = [
        `PGPASSWORD=${config.password}`,
        'psql',
        `-h ${config.host}`,
        `-p ${config.port}`,
        `-U ${config.user}`,
        `-d ${config.database}`,
        '-c "CREATE SCHEMA IF NOT EXISTS public;"'
      ].join(' ');

      await execAsync(createSchemasCommand);
      
      // Import the processed dump
      const command = [
        `PGPASSWORD=${config.password}`,
        'psql',
        `-h ${config.host}`,
        `-p ${config.port}`,
        `-U ${config.user}`,
        `-d ${config.database}`,
        '--set ON_ERROR_STOP=off', // Changed to off to continue on errors
        '--echo-errors',
        `-f ${processedDumpPath}`
      ].join(' ');

      const { stdout, stderr } = await execAsync(command);
      
      if (stderr && !stderr.includes('SET')) {
        logger.warn('Import produced warnings:', stderr);
      }
      
      logger.info('Database dump imported successfully');
      return stdout;
    } catch (error) {
      logger.error('Failed to import database dump:', error);
      throw error;
    } finally {
      // Clean up processed dump file
      if (processedDumpPath) {
        try {
          await fs.unlink(processedDumpPath);
        } catch (err) {
          logger.warn('Failed to clean up processed dump file:', err);
        }
      }
    }
  }

  static async validateDump(dumpPath) {
    try {
      logger.info(`Validating dump file: ${dumpPath}`);
      
      const validation = {
        hasTableDefinitions: false,
        hasData: false,
        pgVersion: null,
        isValid: false
      };

      const readStream = createReadStream(dumpPath, {
        highWaterMark: 64 * 1024 // 64KB chunks
      });

      const rl = readline.createInterface({
        input: readStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        if (line.includes('CREATE TABLE')) {
          validation.hasTableDefinitions = true;
        }
        if (line.includes('INSERT INTO')) {
          validation.hasData = true;
        }
        if (line.includes('-- Dumped from database version')) {
          const versionMatch = line.match(/-- Dumped from database version (\d+)/);
          if (versionMatch) {
            validation.pgVersion = parseInt(versionMatch[1]);
          }
        }
        
        // Exit early if we found everything we need
        if (validation.hasTableDefinitions && 
            validation.hasData && 
            validation.pgVersion) {
          break;
        }
      }

      validation.isValid = true;
      rl.close();
      readStream.destroy();

      return validation;
    } catch (error) {
      logger.error('Failed to validate dump file:', error);
      throw error;
    }
  }

  static async createStructureDump(config, fileName) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '');
    const dumpFile = `${fileName}_structure_${timestamp}.sql`;
    
    try {
      const command = [
        `PGPASSWORD=${config.password}`,
        'pg_dump',
        `-h ${config.host}`,
        `-p ${config.port}`,
        `-U ${config.user}`,
        `-d ${config.database}`,
        '--schema-only',
        '--no-owner',
        '--no-acl'
      ].join(' ');

      const { stdout } = await execAsync(command);
      await fs.writeFile(dumpFile, stdout);
      
      return dumpFile;
    } catch (error) {
      logger.error('Failed to create structure dump:', error);
      throw error;
    }
  }

  static async dumpDatabase(config, fileName) {
    logger.info('Creating dump of database...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '');
    const dumpFile = `${config.database}_${fileName}_${timestamp}.sql`;
    
    try {
      const command = [
        `PGPASSWORD=${config.password}`,
        'pg_dump',
        `-h ${config.host}`,
        `-p ${config.port}`,
        `-U ${config.user}`,
        `-d ${config.database}`,
        '--format=plain',
        '--no-owner',
        '--no-acl',
        config.securityLabels ? '--no-security-labels' : ''
      ].join(' ');

      const { stdout } = await execAsync(command);
      await fs.writeFile(dumpFile, stdout);
      
      logger.info(`Database dump created successfully: ${dumpFile}`);
      return dumpFile;
    } catch (error) {
      logger.error('Failed to create database dump:', error);
      throw error;
    }
  }
}