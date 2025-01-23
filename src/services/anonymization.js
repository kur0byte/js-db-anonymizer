import pkg from 'pg';
import { logger } from '../utils/logger.js';
import { DockerManager } from './docker.js';
import { Dumper } from './dumper.js';
import { config } from '../config/index.js';
import path from 'path';
import fs from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);
const { Pool, Client } = pkg;
const { database } = config;

export class AnonymizationService {
  constructor(dumpPath, dbEngine) {
    this.originalDumpFile = dumpPath;
    this.dumpsDirectory = path.join(process.cwd(), 'dumps');
    this.dockerManager = new DockerManager();
    this.dumper = new Dumper();
    this.dbEngine = dbEngine;
    this.localPort = database.port;
    this.host = database.host;
    this.user = database.user;
    this.password = database.password;
    this.databaseName = database.dbName;
    this.maxRetries = database.maxRetries;
    this.retryInterval = 1000; // 1 second
    this.pool = null;
  }

  async init() {
    try {
      logger.info('Initializing Anonymization Service');
    } catch (error) {
      logger.error('Initialization failed:', error);
      throw error;
    }
  }

  async setup() {
    try {
      logger.info('Starting setup process...');
      await this.ensureDumpsDirectory();

      await this.dockerManager.ensureCleanContainer('dump_postgresql');
      await this.dockerManager.createAndStartContainer('dump_postgresql', 'registry.gitlab.com/dalibo/postgresql_anonymizer:latest', {
        portBindings: { '5432/tcp': [{ HostPort: this.localPort.toString() }] },
        env: [
          `POSTGRES_PASSWORD=${this.password}`,
          `POSTGRES_USER=${this.user}`,
          `POSTGRES_DB=${this.databaseName}`,
        ],
        volumes: [`${this.dumpsDirectory}:/dumps`],
      });

      await this.waitForPostgres();
      await this.initializeAnonDatabase();
      
      // Import the original dump first, then setup anonymization
      await this.importOriginalDump();
      await this.setupAnonymization();
      
      this.pool = this.createPool();
      
      logger.info('Setup completed successfully');
    } catch (error) {
      logger.error('Setup failed:', error);
      await this.cleanup();
      throw error;
    }
  }

  async setupAnonymization() {
    try {
      logger.info('Setting up anonymization extensions and roles...');
  
      // Crear la extensión anon
      await this.dockerManager.executeDockerCommand([
        'exec',
        'dump_postgresql',
        'psql',
        '-h', this.host,
        '-p', this.localPort.toString(),
        '-U', this.user,
        '-d', this.databaseName,
        '-c', '"CREATE EXTENSION IF NOT EXISTS anon CASCADE;"',
      ]);
  
      // Inicializar anon
      await this.dockerManager.executeDockerCommand([
        'exec',
        'dump_postgresql',
        'psql',
        '-h', this.host,
        '-p', this.localPort.toString(),
        '-U', this.user,
        '-d', this.databaseName,
        '-c', '"SELECT anon.init();"'
      ]);
  
      // Crear y configurar el rol dump_anon
      const roleSetupQuery = `
        DO $$ BEGIN
          IF EXISTS (
              SELECT FROM pg_catalog.pg_roles
              WHERE rolname = 'dump_anon') THEN
            RAISE NOTICE 'Role "dump_anon" already exists. Skipping.';
          ELSE
            CREATE ROLE dump_anon LOGIN PASSWORD 'anon_pass';
          END IF;
        END $$;
        ALTER ROLE dump_anon SET anon.transparent_dynamic_masking = True;
        SECURITY LABEL FOR anon ON ROLE dump_anon IS 'MASKED';
      `.trim().replace(/\s+/g, ' ');
  
      await this.dockerManager.executeDockerCommand([
        'exec',
        'dump_postgresql',
        'psql',
        '-h', this.host,
        '-p', this.localPort.toString(),
        '-U', this.user,
        '-d', this.databaseName,
        '-c', `"${roleSetupQuery}"`,
      ]);
  
      // Configurar permisos para el rol dump_anon
      const grantPermissionsQuery = `
        GRANT USAGE ON SCHEMA public, anon TO dump_anon;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO dump_anon;
        GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO dump_anon;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA anon TO dump_anon;
        GRANT SELECT ON ALL TABLES IN SCHEMA anon TO dump_anon;
        GRANT SELECT ON pg_statistic TO dump_anon;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dump_anon;
      `.trim().replace(/\s+/g, ' ');
  
      await this.dockerManager.executeDockerCommand([
        'exec',
        'dump_postgresql',
        'psql',
        '-h', this.host,
        '-p', this.localPort.toString(),
        '-U', this.user,
        '-d', this.databaseName,
        '-c', `"${grantPermissionsQuery}"`,
      ]);
  
      logger.info('Anonymization setup completed successfully');
    } catch (error) {
      logger.error('Failed to setup anonymization:', error);
      throw error;
    }
  }  
  
  async ensureDumpsDirectory() {
    try {
      await fs.access(this.dumpsDirectory);
    } catch {
      await fs.mkdir(this.dumpsDirectory, { recursive: true });
      logger.info(`Created dumps directory at: ${this.dumpsDirectory}`);
    }
  }

  async waitForPostgres() {
    logger.info('Waiting for PostgreSQL to be ready...');

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const client = new Client({
          host: this.host,
          port: this.localPort,
          user: this.user,
          password: this.password,
          database: 'postgres',
        });

        await client.connect();
        await client.query('SELECT 1');
        await client.end();

        logger.info('PostgreSQL is ready');
        return;
      } catch (error) {
        if (attempt === this.maxRetries) {
          logger.error('PostgreSQL failed to start after multiple attempts');
          throw error;
        }
        logger.debug(`Waiting for PostgreSQL... Attempt ${attempt}/${this.maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, this.retryInterval));
      }
    }
  }

  async initializeAnonDatabase() {
    const client = new Client({
      host: this.host,
      port: this.localPort,
      user: this.user,
      password: this.password,
      database: 'postgres',
    });

    try {
      await client.connect();
      logger.info('Initializing anonymization database...');

      await client.query(`DROP DATABASE IF EXISTS ${this.databaseName}`);
      await client.query(`CREATE DATABASE ${this.databaseName}`);

      logger.info('Anonymization database initialized');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    } finally {
      await client.end();
    }
  }

  async importOriginalDump() {
    try {
      logger.info('Importing original dump...');

      const processedDump = await this.dumper.preprocessDump(this.originalDumpFile);
      await this.dumper.importDump(
        {
          host: this.host,
          port: this.localPort,
          user: this.user,
          password: this.password,
          database: this.databaseName,
        },
        processedDump
      );

      logger.info('Original dump imported successfully');
    } catch (error) {
      logger.error('Failed to import original dump:', error);
      throw error;
    }
  }

  createPool() {
    return new Pool({
      host: this.host,
      port: this.localPort,
      user: this.user,
      password: this.password,
      database: this.databaseName,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  async processRules(rules) {
    if (!rules || Object.keys(rules).length === 0) {
      throw new Error('No rules provided for anonymization');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      for (const tableName of Object.keys(rules)) {
        const tableExists = await this.validateTable(client, tableName);
        if (!tableExists) {
          logger.warn(`Table ${tableName} does not exist, skipping...`);
          continue;
        }
  
        await this.applyMaskingRules(client, tableName, rules[tableName]);
  
        // Verificar que los datos se hayan enmascarado
        const count = await this.verifyMasking(client, tableName);
        logger.info(`Masked ${count} rows in table ${tableName}`);
      }
      
      await client.query('COMMIT');
      logger.info('All anonymization rules processed successfully');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('Failed to process anonymization rules:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async validateTable(client, tableName) {
    const result = await client.query(
      `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND lower(table_name) = lower($1);
      `,
      [tableName]
    );
  
    if (result.rows.length > 0) {
      this.exactTableName = result.rows[0].table_name; // Almacena el nombre exacto para futuras consultas
      return true;
    }
  
    return false;
  }

  async applyMaskingRules(client, tableName, tableRules) {
    if (!tableRules || !tableRules.masks) {
      logger.warn(`No masks found for table ${tableName}`);
      return;
    }
  
    for (const [column, maskFunction] of Object.entries(tableRules.masks)) {
      try {
        await client.query(
          `
          SECURITY LABEL FOR anon ON COLUMN "${this.exactTableName}".${column}
          IS 'MASKED WITH FUNCTION ${maskFunction}';
          `
        );
        logger.info(`Successfully masked ${this.exactTableName}.${column}`);
      } catch (error) {
        logger.error(`Failed to mask ${this.exactTableName}.${column}:`, error);
        throw error;
      }
    }
  }
  
  async verifyMasking(client, tableName) {
    try {
      const result = await client.query(`SELECT COUNT(*) FROM "${this.exactTableName}"`);
      return parseInt(result.rows[0].count);
    } catch (error) {
      logger.error(`Failed to verify masking for table ${tableName}:`, error);
      throw error;
    }
  }
  
  async cleanup() {
    logger.info('Starting cleanup...');
    try {
      if (this.pool) {
        await this.pool.end();
        logger.info('Database pool closed');
      }

      await this.dockerManager.ensureCleanContainer();
      logger.info('Docker container cleaned up');
    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }

  async createAnonymizedDump(outputPath) {
    try {
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
      const filename = `${timestamp}_anonymized_${outputPath}.sql`;
      const finalPath = path.join(this.dumpsDirectory, filename);
  
      logger.info('Preparing database for anonymized dump...');
  
      // Crear el archivo cleanup.sql en el sistema local
      const cleanupFilePath = path.join(this.dumpsDirectory, 'cleanup.sql');
      const cleanupScript = `
        DO $$ BEGIN
          -- Remove security labels added by anon
          DELETE FROM pg_catalog.pg_seclabel WHERE provider = 'anon';
  
          -- Drop the anon extension
          DROP EXTENSION IF EXISTS anon CASCADE;
        END $$;
      `;
  
      // Escribir el script en el sistema local
      await fs.writeFile(cleanupFilePath, cleanupScript);
      logger.info(`Cleanup script created at ${cleanupFilePath}`);
  
      // Copiar el archivo al contenedor
      await this.dockerManager.executeDockerCommand([
        'cp',
        cleanupFilePath,
        'dump_postgresql:/dumps/cleanup.sql',
      ]);
      logger.info('Cleanup script copied to container.');
  
      // Ejecutar el script dentro del contenedor
      await this.dockerManager.executeDockerCommand([
        'exec',
        'dump_postgresql',
        'psql',
        '-h', this.host,
        '-p', this.localPort.toString(),
        '-U', this.user,
        '-d', this.databaseName,
        '-f', '/dumps/cleanup.sql',
      ]);
  
      logger.info('Database prepared for anonymized dump.');
  
      // Crear el dump final
      const command = [
        'exec',
        'dump_postgresql',
        'pg_dump',
        '-h', this.host,
        '-p', this.localPort,
        '-U', this.user,
        '-d', this.databaseName,
        '--no-owner',
        '--no-acl',
        '--no-security-labels',
        `-f /dumps/${path.basename(finalPath)}`,
      ];
  
      await this.dockerManager.executeDockerCommand(command);
  
      logger.info(`Anonymized dump created successfully at: ${finalPath}`);
      return finalPath;
    } catch (error) {
      logger.error('Failed to create anonymized dump:', error);
      throw error;
    }
  }  
     
}
