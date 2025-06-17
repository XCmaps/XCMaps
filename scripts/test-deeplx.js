import * as deeplxNamespace from 'deeplx';
const deeplx = deeplxNamespace; // Attempt to use the imported namespace object directly as the function

async function testTranslation() {
  try {
    const textToTranslate = 'Hello, world!';
    const targetLang = 'DE'; // Translate to German
    const sourceLang = 'EN'; // Source language is English

    console.log(`Original text (${sourceLang}): ${textToTranslate}`);

    // As per deeplx v0.3.0 documentation:
    // deeplx(text, targetLang, sourceLang, authKey, freeApi)
    // We will attempt to use the free API by passing null for authKey and true for freeApi.
    // If an authKey is strictly required and not picked up automatically (e.g. via environment variables),
    // this call might fail or return an error related to authentication.
    const resultData = await deeplx(
      textToTranslate,
      targetLang,
      sourceLang,
      null, // authKey - passing null as no key is provided
      true  // freeApi - attempting to use the free API
    );

    // The npm example (https://www.npmjs.com/package/deeplx/v/0.3.0) shows `data` as the direct result.
    // It's not clear if `data` is a string or an object.
    // The example `console.log(data)` suggests it might be directly printable.
    // Let's assume `resultData` is the translated text or an object containing it.
    if (resultData) {
      // If resultData is an object, it might have a 'text' or 'translations' property.
      // If it's a string, this will print it.
      // Based on the example `console.log(data)`, it's likely the direct translated string or an object that stringifies well.
      // The example shows `data` is the direct output.
      console.log(`Translated text (${targetLang}): ${resultData}`);
    } else {
      console.log('Translation failed or returned an empty result:', resultData);
    }

  } catch (error) {
    console.error('Error during translation test:', error);
    if (error.message && (error.message.toLowerCase().includes('auth_key') || error.message.toLowerCase().includes('authkey'))) {
      console.log('\nHint: The error suggests an authentication key is required or invalid.');
      console.log('Please ensure you have a valid DeepL API key if you are not using the free tier,');
      console.log('or that the free tier is accessible without a key for this library version.');
      console.log('You might need to pass your authKey as the fourth argument to the deeplx function.');
    } else if (error.response && error.response.data) {
      // Some API errors might be in error.response.data
      console.error('API Error Data:', error.response.data);
    }
  }
}

testTranslation();