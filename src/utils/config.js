import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs/promises';
import { logger } from './logger.js';

/**
 * Carga un archivo de reglas desde la carpeta predeterminada `src/rules`.
 * @param {string} rulesFileName - Nombre del archivo de reglas.
 * @returns {Promise<object>} - Objeto con las reglas cargadas.
 */
export async function loadRules(rulesFileName) {
  const rulesBaseDir = path.resolve('src/rules');
  const rules = {};

  try {
    // Construye la ruta completa en la carpeta `src/rules`
    const ruleFilePath = path.join(rulesBaseDir, rulesFileName);

    // Verifica si el archivo existe
    await fs.access(ruleFilePath);

    // Convierte la ruta a una URL válida para ESM
    const ruleFileUrl = pathToFileURL(ruleFilePath).href;

    // Importa dinámicamente el módulo
    const ruleModule = await import(ruleFileUrl);

    // Usa `testDbRules` si está definido, de lo contrario intenta con `default`
    Object.assign(rules, ruleModule.testDbRules || ruleModule.default || {});

    logger.info(`Rules loaded successfully from ${ruleFilePath}`);
  } catch (error) {
    logger.error(`Failed to load rules from ${rulesFileName}:`, error);
    throw new Error(`Unable to load rules from ${rulesFileName}: ${error.message}`);
  }

  return rules;
}
