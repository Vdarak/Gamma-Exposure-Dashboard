const axios = require('axios');
const https = require('https');

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  rejectUnauthorized: true,
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  ciphers: 'DEFAULT:!DH',
});

let cookieJar = {};

function updateCookies(setCookieHeader) {
  if (!setCookieHeader) return;
  setCookieHeader.forEach(cookieStr => {
    const parts = cookieStr.split(';')[0].split('=');
    const name = parts[0].trim();
    const value = parts.slice(1).join('=').trim();
    cookieJar[name] = value;
  });
}

function getCookieString() {
  return Object.entries(cookieJar).map(([name, value]) => `${name}=${value}`).join('; ');
}

async function testNSEAxios() {
  const ticker = 'NIFTY';
  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    'Connection': 'keep-alive',
  };

  try {
    // Step 1: Hit option-chain page to get cookies
    console.log("Step 1: Fetching option-chain page...");
    const res1 = await axios.get('https://www.nseindia.com/option-chain', {
      headers: {
        ...commonHeaders,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      },
      timeout: 10000,
      httpsAgent,
    });
    updateCookies(res1.headers['set-cookie']);
    
    // Wait 2 seconds
    console.log("Waiting 2 seconds...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Hit contract info to get expiry dates
    const infoUrl = `https://www.nseindia.com/api/option-chain-contract-info?symbol=${ticker}`;
    console.log(`Step 2: Fetching contract info from: ${infoUrl}`);
    const infoRes = await axios.get(infoUrl, {
      headers: {
        ...commonHeaders,
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.nseindia.com/option-chain',
        'Cookie': getCookieString(),
      },
      timeout: 15000,
      httpsAgent,
    });

    console.log(`Contract info status: ${infoRes.status}`);
    const infoData = infoRes.data;
    console.log("Contract info keys:", Object.keys(infoData));
    
    const expiryDates = infoData.expiryDates || (infoData.records && infoData.records.expiryDates) || [];
    console.log("Found expiry dates:", expiryDates.slice(0, 5));

    if (expiryDates.length === 0) {
      console.log("No expiry dates found, response:", JSON.stringify(infoData).substring(0, 500));
      return;
    }

    const firstExpiry = expiryDates[0];
    console.log(`Using first expiry: ${firstExpiry}`);

    // Wait 2 seconds
    console.log("Waiting 2 seconds...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 3: Fetch option chain for first expiry
    const apiUrl = `https://www.nseindia.com/api/option-chain-v3?type=Indices&symbol=${ticker}&expiry=${firstExpiry}`;
    console.log(`Step 3: Fetching options from: ${apiUrl}`);
    const response = await axios.get(apiUrl, {
      headers: {
        ...commonHeaders,
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.nseindia.com/option-chain',
        'Cookie': getCookieString(),
      },
      timeout: 15000,
      httpsAgent,
    });

    console.log(`API response status: ${response.status}`);
    console.log(`API response data type:`, typeof response.data);
    const dataString = typeof response.data === 'object' ? JSON.stringify(response.data) : response.data;
    console.log(`API response data preview:`, dataString.substring(0, 1000));
  } catch (error) {
    console.error(`Error:`, error.message);
    if (error.response) {
      console.error(`Response status:`, error.response.status);
      console.error(`Response data preview:`, String(error.response.data).substring(0, 500));
    }
  }
}

testNSEAxios();
