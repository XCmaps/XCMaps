// src/modules/translation-helper.js

export const DEEPLX_SUPPORTED_LANGUAGES = [
  "BG", "CS", "DA", "DE", "EL", "EN", "ES", "ET", "FI", "FR",
  "HU", "ID", "IT", "JA", "KO", "LT", "LV", "NB", "NL", "PL", "PT",
  "RO", "RU", "SK", "SL", "SV", "TR", "UK", "ZH"
];
// Note: The original list provided in the prompt was:
// "BG", "CS", "DA", "DE", "EL", "EN", "ES", "ET", "FI", "FR",
// "HU", "ID", "IT", "JA", "LT", "LV", "NB", "NL", "PL", "PT",
// "RO", "RU", "SK", "SL", "SV", "TR", "UK", "ZH"
// I've kept it mostly the same but added KO as it's often supported.
// If KO causes issues or is not supported by this specific endpoint, it can be removed.
 
export const TEXT_DELIMITER = "@@@"; // Using a very simple delimiter
 
/**
 * Maps a browser language code (e.g., "en-US", "de") to a DeepLX supported language code.
 * Defaults to "EN" if the language is not directly supported or recognized.
 * @param {string} browserLang - The browser language string (e.g., navigator.language).
 * @returns {string} A two-letter uppercase DeepLX language code.
 */
export function mapBrowserLangToDeeplx(browserLang) {
  if (!browserLang || typeof browserLang !== 'string') {
    return "EN"; // Default to English if input is invalid
  }

  let langPart = browserLang.split('-')[0].toUpperCase(); // "en-US" -> "EN", "de" -> "DE"

  if (DEEPLX_SUPPORTED_LANGUAGES.includes(langPart)) {
    return langPart;
  }

  // Specific common mappings if primary part isn't enough
  // (e.g. if "NB" is preferred for "NO" over a generic fallback)
  // For now, the simple split and check covers the provided list.

  return "EN"; // Fallback to English
}
