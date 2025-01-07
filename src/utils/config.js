import path from 'path';
import { logger } from './logger.js';

export async function loadRules(rulesPath, selectedRules) {
  const rules = {};
  const ruleFilePath = path.join(rulesPath, path.basename(selectedRules));
  try {
    const ruleModule = await import(ruleFilePath);
    Object.assign(rules, ruleModule.testDbRules);
  } catch (error) {
    logger.error(`Failed to load rules from ${ruleFilePath}:`, error);
    throw error;
  }
  return rules;
}
