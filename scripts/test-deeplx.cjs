const deeplx = require('deeplx');
async function testTranslation() {
  try {
    const textToTranslate = 'Car: Yes, Foot: Yes';
    const targetLang = 'DE'; // Translate to German
    const sourceLang = 'EN'; // Source language is English

    console.log(`Original text (${sourceLang}): ${textToTranslate}`);

    // Debugging showed deeplx is an object with a 'translate' method.
    // Calling deeplx.translate() instead of deeplx()
    const resultData = await deeplx.translate(
      textToTranslate,
      targetLang,
      sourceLang,
      null, // authKey - passing null as no key is provided
      true  // freeApi - attempting to use the free API
    );

    if (resultData) {
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
      console.error('API Error Data:', error.response.data);
    }
  }
}

testTranslation();