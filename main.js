#!/usr/bin/env node

import { program } from 'commander';
import { AnonymizationService } from './src/services/anonymization.js';
import { logger } from './src/utils/logger.js';
import path from 'path';
import { loadRules } from './src/utils/config.js';

program
  .version('1.0.0')
  .description('Database Anonymization Tool')
  .option('-d, --dump <name>', 'Name of dump file in dumps folder (e.g., dump.sql)')
  .option('-r, --rules <name>', 'Name of rules file in src/rules (e.g., users.rules.js)')
  .option('-o, --output <name>', 'Output file name for anonymized dump')
  .parse(process.argv);

const options = program.opts();

async function main() {
  let anonService = null;
  try {
    // Define el directorio base para los dumps
    const dumpsDir = path.resolve('dumps');

    // Resuelve la ruta del archivo dump dentro del directorio `dumps`
    const dumpAbsolutePath = path.join(dumpsDir, options.dump);

    // Valida que el dump exista
    const fs = await import('fs/promises');
    try {
      await fs.access(dumpAbsolutePath);
    } catch {
      throw new Error(`Dump file "${options.dump}" not found in ${dumpsDir}`);
    }

    // Carga las reglas desde `src/rules`
    const rules = await loadRules(options.rules);

    // Inicializa el servicio
    anonService = new AnonymizationService(dumpAbsolutePath);
    await anonService.init();
    await anonService.setup();
    await anonService.processRules(rules);
    await anonService.createAnonymizedDump(options.output);
    
  } catch (error) {
    logger.error('Failed to run anonymization:', error);
    if (anonService) {
      await anonService.cleanup().catch(err =>
        logger.error('Cleanup after failure:', err)
      );
    }
    process.exit(1);
  } finally {
    if (anonService) {
      await anonService.cleanup().catch(err =>
        logger.error('Cleanup after failure:', err)
      );
    }
    process.exit(0);
  }
}

main();
