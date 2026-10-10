'use strict';

/**
 * Example plugin handler for hello_world tool
 * @param {Object} context - Execution context (session, workspace, etc.)
 * @param {Object} args - Tool arguments
 * @param {string} args.name - Name to greet
 * @param {string} [args.language='en'] - Language code
 * @returns {Object} Result object
 */
module.exports = async function helloWorldHandler(context, args) {
  const { name, language = 'en' } = args;

  const greetings = {
    en: `Hello, ${name}!`,
    zh: `你好，${name}！`,
    ja: `こんにちは、${name}さん！`,
  };

  const greeting = greetings[language] || greetings.en;

  return {
    success: true,
    greeting,
    language,
    timestamp: new Date().toISOString(),
  };
};
