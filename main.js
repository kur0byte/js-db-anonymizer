#!/usr/bin/env node

import { program } from 'commander';
import { AnonymizationService } from './src/services/anonymization.js';
import { logger } from './src/utils/logger.js';
import path from 'path';
import { loadRules } from './src/utils/config.js';

program
  .version('1.0.0')
  .description('Database Anonymization Tool')
  .option('-d, --dump <path>', 'Path to original dump file')
  .option('-r, --rules <path>', 'Path to rules file')
  .option('-o, --output <path>', 'Output file name')
  .parse(process.argv);

const options = program.opts();

async function main() {
  let anonService = null;
  try {
    const dumpAbsolutePath = path.resolve(options.dump);
    const rulesPath = path.resolve('src/rules');
    
    const rules = await loadRules(rulesPath, options.rules);
    
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
    process.exit(0)
  }
}

main();