import Docker from 'dockerode';
import pkg from 'pg';
import { logger } from '../utils/logger.js';
import { Dumper } from './dumper.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);
const { Pool, Client } = pkg;

export class AnonymizationService {
  constructor(dumpPath) {
    this.originalDumpFile = dumpPath;
    this.dumpsDirectory = path.join(process.cwd(), 'dumps');
    this.docker = null;
    this.container = null;
    this.pool = null;
    this.localPort = 15432;
    this.host = 'localhost';
    this.user = 'postgres';
    this.password = 'anon_password';
    this.databaseName = 'postgres';
    this.maxRetries = 60;
    this.retryInterval = 1000; // 1 second
  }

  async ensureDumpsDirectory() {
    try {
      await fs.access(this.dumpsDirectory);
    } catch {
      await fs.mkdir(this.dumpsDirectory, { recursive: true });
      logger.info(`Created dumps directory at: ${this.dumpsDirectory}`);
    }
  }

  async createAnonymizedDump(outputPath) {
    try {
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
      const filename = `${timestamp}_anonymized_${outputPath}.sql`;
      const finalPath = path.join(this.dumpsDirectory, filename);
      
      logger.info('Creating anonymized database dump...');
  
      // Stream directly to file instead of buffering in memory
      const command = [
        'PGPASSWORD=anon_pass',
        'pg_dump',
        `-h ${this.host}`,
        `-p ${this.localPort}`, 
        `-U dump_anon`,
        `-d ${this.databaseName}_anon`,
        '--no-owner',
        '--no-acl',
        '--no-security-labels',
        `-f ${finalPath}` // Write directly to file
      ].join(' ');
  
      // Execute with increased buffer size
      await execAsync(command, {
        maxBuffer: 1024 * 1024 * 100 // 100MB buffer
      });
  
      logger.info(`Anonymized dump created successfully at: ${finalPath}`);
      return finalPath;
  
    } catch (error) {
      logger.error('Failed to create anonymized dump:', error);
      throw error;
    }
  }

  async importOriginalDump() {
    if (!this.originalDumpFile) {
      throw new Error('No dump file provided');
    }
  
    try {
      logger.info('Importing original dump...');
      
      // Import schema with increased buffer
      const schemaCommand = [
        `PGPASSWORD=${this.password}`,
        'pg_restore',
        `-h ${this.host}`,
        `-p ${this.localPort}`,
        `-U ${this.user}`,
        `-d ${this.databaseName}_anon`, 
        '--schema-only',
        this.originalDumpFile
      ].join(' ');
  
      await execAsync(schemaCommand, {
        maxBuffer: 1024 * 1024 * 100 // 100MB buffer
      });
  
      logger.info('Schema imported successfully');
  
      // Import data with increased buffer 
      const dataCommand = [
        `PGPASSWORD=${this.password}`,
        'pg_restore', 
        `-h ${this.host}`,
        `-p ${this.localPort}`,
        `-U ${this.user}`,
        `-d ${this.databaseName}_anon`,
        '--data-only',
        this.originalDumpFile
      ].join(' ');
  
      await execAsync(dataCommand, {
        maxBuffer: 1024 * 1024 * 100 // 100MB buffer  
      });
  
      logger.info('Data imported successfully');
  
    } catch (error) {
      logger.error('Failed to import original dump:', error);
      throw error;
    }
  }

  async init() {
    try {
      this.docker = new Docker();
      await this.docker.ping();
      logger.info('Docker connection established');
    } catch (error) {
      logger.error('Failed to connect to Docker:', error);
      throw new Error('Docker connection failed. Is Docker running?');
    }
  }

  async setup() {
    try {
      logger.info('Starting setup process...');
      await this.ensureDumpsDirectory();
      
      // Validate dump file first
      // await Dumper.validateDump(this.originalDumpFile);
      
      await this.initializeContainer();
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

  async initializeContainer() {
    logger.info('Starting PostgreSQL Anonymizer container...');
    try {
        const containerConfig = {
            Image: 'registry.gitlab.com/dalibo/postgresql_anonymizer:latest',
            Env: [
                `POSTGRES_PASSWORD=${this.password}`,
                `POSTGRES_USER=${this.user}`,
                `POSTGRES_DB=${this.databaseName}`,
                'PGDATA=/var/lib/postgresql/data/pgdata'
            ],
            HostConfig: {
                PortBindings: {
                    '5432/tcp': [{ HostPort: this.localPort.toString() }]
                },
                RestartPolicy: {
                    Name: 'no',
                    MaximumRetryCount: 0
                },
                Memory: 2147483648, // 2GB
                MemorySwap: 4294967296, // 4GB
                Binds: [
                    'pgdata:/var/lib/postgresql/data/pgdata' // Updated path
                ]
            },
            Healthcheck: {
                Test: ["CMD-SHELL", "pg_isready -U postgres || exit 1"],
                Interval: 1000000000, // 1s in nanoseconds
                Timeout: 3000000000,  // 3s
                Retries: 5,
                StartPeriod: 3000000000 // 3s initialization time
            }
        };

        // Check and create volume if needed
        const volumes = await this.docker.listVolumes();
        if (!volumes.Volumes.find(v => v.Name === 'pgdata')) {
            await this.docker.createVolume({ 
                Name: 'pgdata',
                Driver: 'local'
            });
            logger.info('Created pgdata volume');
        }

        // Pull image with proper progress tracking
        try {
            await this.docker.getImage(containerConfig.Image).inspect();
        } catch (err) {
            logger.info('Pulling PostgreSQL Anonymizer image...');
            await new Promise((resolve, reject) => {
                this.docker.pull(containerConfig.Image, (err, stream) => {
                    if (err) return reject(err);
                    this.docker.modem.followProgress(stream, 
                        (err) => err ? reject(err) : resolve(),
                        (event) => logger.debug('Pull progress:', event)
                    );
                });
            });
        }

        // Create and start container
        this.container = await this.docker.createContainer(containerConfig);
        await this.container.start();

        // Attach logging
        const logStream = await this.container.logs({
            follow: true,
            stdout: true,
            stderr: true,
            timestamps: true
        });

        logStream.on('data', data => {
            logger.debug('Container log:', data.toString().trim());
        });

        // Wait for health check
        logger.info('Waiting for container health check...');
        await this.waitForContainerHealth();
        logger.info('Container started successfully');

    } catch (error) {
        logger.error('Container startup failed:', error);
        
        // Get container logs if available
        if (this.container) {
            try {
                const logs = await this.container.logs({
                    stdout: true,
                    stderr: true,
                    tail: 50
                });
                logger.error('Container logs:', logs.toString());
            } catch (logError) {
                logger.error('Failed to fetch container logs:', logError);
            }
        }
        throw error;
    }
}

async waitForContainerHealth() {
  const maxRetries = 30;
  const retryInterval = 2000; // 2s

  for (let i = 0; i < maxRetries; i++) {
      try {
          const containerInfo = await this.container.inspect();
          const state = containerInfo.State;
          
          if (state.Running && (!state.Health || state.Health.Status === 'healthy')) {
              return;
          }

          if (state.ExitCode && state.ExitCode !== 0) {
              throw new Error(`Container exited with code ${state.ExitCode}`);
          }

          logger.debug(`Container health status: ${state.Health?.Status || 'unknown'}`);
          await new Promise(resolve => setTimeout(resolve, retryInterval));
          
      } catch (error) {
          logger.error(`Health check attempt ${i + 1}/${maxRetries} failed:`, error);
          if (i === maxRetries - 1) throw error;
      }
  }
  
  throw new Error('Container health check failed after max retries');
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
          database: 'postgres'
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
      database: 'postgres'
    });
  
    try {
      await client.connect();
      logger.info('Initializing anonymization database...');
      
      // Drop database if exists (outside transaction)
      await client.query(`DROP DATABASE IF EXISTS ${this.databaseName}_anon`);
      
      // Create fresh database (outside transaction)
      await client.query(`CREATE DATABASE ${this.databaseName}_anon`);
      
      logger.info('Anonymization database initialized');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    } finally {
      await client.end().catch(err => 
        logger.error('Error closing client:', err)
      );
    }
  }
  
  async setupAnonymization() {
    const client = new Client({
      host: this.host,
      port: this.localPort,
      user: this.user,
      password: this.password,
      database: `${this.databaseName}_anon`
    });
  
    try {
      await client.connect();
      logger.info('Setting up anonymization extensions and roles...');
      
      // Create extension (must be outside transaction)
      await client.query('CREATE EXTENSION IF NOT EXISTS anon CASCADE');
      
      // Initialize anonymization (can be in transaction)
      await client.query('BEGIN');
      await client.query('SELECT anon.init()');
      
      // Setup anonymization role with enhanced permissions
      await client.query('DROP ROLE IF EXISTS dump_anon');
      await client.query(`
        CREATE ROLE dump_anon LOGIN PASSWORD 'anon_pass';
        ALTER ROLE dump_anon SET anon.transparent_dynamic_masking = True;
        SECURITY LABEL FOR anon ON ROLE dump_anon IS 'MASKED';
      `);
      
      // Grant comprehensive permissions
      await client.query(`
        GRANT USAGE ON SCHEMA public, anon TO dump_anon;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO dump_anon;
        GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO dump_anon;
        
        -- Grant access to anonymization functions and tables
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA anon TO dump_anon;
        GRANT SELECT ON ALL TABLES IN SCHEMA anon TO dump_anon;
        
        -- Allow access to system catalogs needed for pg_dump
        GRANT SELECT ON pg_statistic TO dump_anon;
      `);
      
      // Make sure future tables are accessible
      await client.query(`
        ALTER DEFAULT PRIVILEGES IN SCHEMA public 
        GRANT SELECT ON TABLES TO dump_anon;
      `);
      
      await client.query('COMMIT');
      logger.info('Anonymization setup completed successfully');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('Failed to setup anonymization:', error);
      throw error;
    } finally {
      await client.end().catch(err => 
        logger.error('Error closing client:', err)
      );
    }
}

  createPool() {
    return new Pool({
      host: this.host,
      port: this.localPort,
      user: this.user,
      password: this.password,
      database: `${this.databaseName}_anon`,
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
        
        await this.processRule(client, tableName, rules);

        // Verify data was masked
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

  async verifyMasking(client, tableName) {
    try {
        // Use exactTableName stored during validation
        const result = await client.query(`SELECT COUNT(*) FROM "${this.exactTableName}"`);
        return parseInt(result.rows[0].count);
    } catch (error) {
        logger.error(`Failed to verify masking for table ${tableName}:`, error);
        throw error;
    }
}

async validateTable(client, tableName) {
    // First get the exact case of the table name from the database
    const result = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND lower(table_name) = lower($1);
    `, [tableName]);
    
    if (result.rows.length > 0) {
        // Store the correct case table name as instance property
        this.exactTableName = result.rows[0].table_name;
        return true;
    }
    return false;
}

  async validateTable(client, tableName) {
    // First get the exact case of the table name from the database
    const result = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND lower(table_name) = lower($1);
    `, [tableName]);
    
    if (result.rows.length > 0) {
        // Store the correct case table name as instance property
        this.exactTableName = result.rows[0].table_name;
        return true;
    }
    return false;
}

  async processRule(client, tableName, rules) {
    logger.info(`Processing rule for table: ${tableName}`);
  
    const tableRules = rules[tableName];
    if (!tableRules || !tableRules.masks) {
      logger.warn(`No masks found for table ${tableName}`);
      return;
    }
  
    // Use the exact table name we found during validation
    const exactTableName = this.exactTableName;
    
    for (const [column, maskFunction] of Object.entries(tableRules.masks)) {
      try {
        await client.query(`
          SECURITY LABEL FOR anon ON COLUMN "${exactTableName}".${column}
          IS 'MASKED WITH FUNCTION ${maskFunction}';
        `);
        logger.info(`Successfully masked ${exactTableName}.${column}`);
      } catch (error) {
        logger.error(`Failed to mask ${exactTableName}.${column}:`, error);
        throw error;
      }
    }
  }

  async importOriginalDump() {
    if (!this.originalDumpFile) {
      throw new Error('No dump file provided');
    }
  
    try {
      logger.info('Importing original dump...');
      const output = await Dumper.importDump({
        host: this.host,
        port: this.localPort,
        user: this.user,
        password: this.password,
        database: `${this.databaseName}_anon`
      }, this.originalDumpFile);
      
      logger.info('Original dump imported successfully');
      return output;
    } catch (error) {
      logger.error('Failed to import original dump:', error);
      throw error;
    }
  }

  async cleanup() {
    logger.info('Starting cleanup...');
    
    if (this.pool) {
      try {
        await this.pool.end();   
        logger.info('Database pool closed');
      } catch (error) {
        logger.error('Error closing database pool:', error);
      }
    }
    
    if (this.container) {
      try {
        await this.container.stop();
        await this.container.remove();
        logger.info('Docker container cleaned up');
      } catch (error) {
        logger.error('Error cleaning up container:', error);
      }
    }
  }
}