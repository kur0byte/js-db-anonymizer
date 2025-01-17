import { logger } from '../utils/logger.js';
import { promisify } from 'util';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import readline from 'readline';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import path from 'path';
import { DockerManager } from './docker.js';

export class Dumper {
  constructor(){
    this.dockerManager = new DockerManager();
  }

  /**
   * Preprocesses the dump file to comment out unnecessary lines.
   */
  async preprocessDump(dumpPath) {
    try {
      logger.info('Preprocessing dump file...');
      const tempPath = `${dumpPath}.processed`;
      await this.transformDumpFile(dumpPath, tempPath);
      logger.info('Dump file preprocessed successfully');
      return tempPath;
    } catch (error) {
      logger.error('Failed to preprocess dump file:', error);
      throw error;
    }
  }

  async transformDumpFile(inputPath, outputPath) {
    const readStream = createReadStream(inputPath);
    const writeStream = createWriteStream(outputPath);

    const transform = new Transform({
      transform(chunk, encoding, callback) {
        let data = chunk
          .toString()
          .replace(/SET transaction_timeout = 0;/g, '-- SET transaction_timeout = 0;')
          .replace(
            /SELECT pg_catalog.set_config\('search_path', '', false\);/g,
            "SELECT pg_catalog.set_config('search_path', 'public', false);"
          ).replace(/'/g, "''");

        callback(null, data);
      },
    });

    await pipeline(readStream, transform, writeStream);
  }

  /**
   * Validates the structure and content of a dump file.
   */
  async validateDump(dumpPath) {
    if (!dumpPath) throw new Error('Dump path is required for validation');

    try {
      logger.info(`Validating dump file: ${dumpPath}`);
      const validation = {
        hasTableDefinitions: false,
        hasData: false,
        pgVersion: null,
        isValid: false,
      };

      const readStream = createReadStream(dumpPath, { highWaterMark: 64 * 1024 });
      const rl = readline.createInterface({ input: readStream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (line.includes('CREATE TABLE')) validation.hasTableDefinitions = true;
        if (line.includes('INSERT INTO')) validation.hasData = true;
        if (line.includes('-- Dumped from database version')) {
          const match = line.match(/-- Dumped from database version (\d+)/);
          if (match) validation.pgVersion = parseInt(match[1]);
        }

        if (validation.hasTableDefinitions && validation.hasData && validation.pgVersion) break;
      }

      validation.isValid = validation.hasTableDefinitions && validation.hasData && !!validation.pgVersion;
      return validation;
    } catch (error) {
      logger.error('Failed to validate dump file:', error);
      throw error;
    }
  }

  /**
   * Creates a database structure dump.
   */
  async createStructureDump(config, fileName) {
    return this.createDump(config, fileName, { schemaOnly: true });
  }

  /**
   * Creates a full database dump (data and schema).
   */
  async dumpDatabase(config, fileName) {
    return this.createDump(config, fileName, { schemaOnly: false });
  }

  /**
   * Generalized dump creation logic.
   */
  async createDump(config, fileName, { schemaOnly = false } = {}) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '');
    const dumpFile = `${fileName}_${timestamp}.sql`;

    try {
      const stdout = await this.dockerManager.runPgDump('dump_postgresql', config, schemaOnly);
      await fs.writeFile(dumpFile, stdout);
      logger.info(`Dump created successfully: ${dumpFile}`);
      return dumpFile;
    } catch (error) {
      logger.error('Failed to create dump:', error);
      throw error;
    }
  }

  /**
   * Imports a dump file into the database.
   */
  async importDump(config, dumpPath) {
    if (!dumpPath) throw new Error('No dump file provided');

    try {
      await this.dockerManager.runPsql('dump_postgresql', config, dumpPath);
      logger.info('Database dump imported successfully');
    } catch (error) {
      logger.error('Failed to import database dump:', error);
      throw error;
    }
  }

  /**
   * Resets the target database (drops and recreates it).
   */
  async resetDatabase(client, dbName) {
    try {
      logger.info('Resetting database...');
      await client.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await client.query(`CREATE DATABASE ${dbName}`);
      logger.info('Database reset successfully');
    } catch (error) {
      logger.error('Failed to reset database:', error);
      throw error;
    }
  }
}
