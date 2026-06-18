const backendPath = '/Users/vedantsmacmini/Desktop/Code/Gamma Exposure Indicator/gamma-exposure-dashboard/backend';
const axios = require(`${backendPath}/node_modules/axios`);
const dotenv = require(`${backendPath}/node_modules/dotenv`);

dotenv.config({ path: `${backendPath}/.env` });

const apiKey = process.env.GEMINI_API_KEY;
console.log('Using API key:', apiKey ? apiKey.substring(0, 10) + '...' : 'none');

async function listModels() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  try {
    const response = await axios.get(url);
    console.log('Supported Models:');
    response.data.models.forEach(m => {
      console.log(`- ${m.name} (Methods: ${m.supportedGenerationMethods.join(', ')})`);
    });
  } catch (err) {
    console.error('Error Status:', err.response?.status);
    console.error('Error Data:', JSON.stringify(err.response?.data, null, 2));
  }
}

listModels();
