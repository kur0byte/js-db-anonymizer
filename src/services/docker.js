import { logger } from '../utils/logger.js';
import { promisify } from 'util';
import { exec } from 'child_process';
import Docker from 'dockerode';
import path from 'path';

const execAsync = promisify(exec);

export class DockerManager {
  constructor(){
    this.docker = new Docker();
  }

  /**
   * Ensures that any existing container is removed along with its volumes.
   */
  async ensureCleanContainer(containerName) {
    try {
      const container = this.docker.getContainer(containerName);
      await container.stop();
      await container.remove({ v: true });
      logger.info(`Removed existing container: ${containerName}`);
    } catch (error) {
      if (error.statusCode !== 404) {
        logger.error('Failed to remove existing container:', error);
        throw error;
      }
    }
  }

  /**
   * Executes a Docker command.
   */
  async executeDockerCommand(args) {
    try {
      const command = ['docker', ...args].join(' ');
      logger.debug(`Executing Docker command: ${command}`);
      const { stdout, stderr } = await execAsync(command);
      if (stderr) logger.warn(`Docker stderr: ${stderr}`);
      return stdout;
    } catch (error) {
      logger.error('Failed to execute Docker command:', error);
      throw error;
    }
  }

  /**
   * Runs pg_dump within a Docker container.
   */
  async runPgDump(containerName, config, schemaOnly) {
    const args = [
      'exec',
      containerName,
      'pg_dump',
      '-h', 'localhost',
      `-p ${config.port}`,
      `-U ${config.user}`,
      `-d ${config.database}`,
      schemaOnly ? '--schema-only' : '--data-only',
      '--no-owner',
      '--no-acl',
      '--clean',
    ];
    return this.executeDockerCommand(args);
  }

  /**
   * Runs psql within a Docker container to import a dump file.
   */
  async runPsql(containerName, config, dumpPath) {
    const containerDumpPath = `/dumps/${path.basename(dumpPath)}`;
    const args = [
      'exec',
      containerName,
      'psql',
      '-h', 'localhost',
      `-p ${config.port}`,
      `-U ${config.user}`,
      `-d ${config.database}`,
      '--set', 'ON_ERROR_STOP=off',
      // '--echo-errors',
      '-f', containerDumpPath,
    ];
    return this.executeDockerCommand(args);
  }

  /**
   * Ensures a Docker container is running, creating it if necessary.
   */
  async createAndStartContainer(containerName, imageName, options = {}) {
    try {
      const existingContainer = await this.getExistingContainer(containerName);

      if (existingContainer) {
        logger.info(`Found existing container: ${containerName}`);
        const container = this.docker.getContainer(existingContainer.Id);

        const containerInfo = await container.inspect();
        if (!containerInfo.State.Running) {
          logger.info(`Starting existing container: ${containerName}`);
          await container.start();
        }

        logger.info(`Container "${containerName}" is now running.`);
        return;
      }

      logger.info(`Creating and starting container: ${containerName}`);
      const container = await this.docker.createContainer({
        Image: imageName,
        name: containerName,
        HostConfig: {
          PortBindings: options.portBindings || {},
          Binds: options.volumes || [],
        },
        Env: options.env || [],
      });

      await container.start();
      logger.info(`Container "${containerName}" created and started successfully.`);
    } catch (error) {
      logger.error('Failed to create or start Docker container:', error);
      throw error;
    }
  }

  /**
   * Retrieves an existing container by name.
   */
  async getExistingContainer(containerName) {
    const containers = await this.docker.listContainers({ all: true });
    return containers.find((c) => c.Names.includes(`/${containerName}`)) || null;
  }
}
