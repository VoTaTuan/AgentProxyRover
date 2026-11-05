#!/usr/bin/env node
'use strict';

/**
 * YouTube PoC - Example integration với Proxy Client
 *
 * Usage:
 *   node youtube-poc.js <url> [--country US] [--strategy bestHealth]
 */

const { ProxyClient } = require('../client/proxy-client');
const { HttpWithProxy } = require('../client/http-with-proxy');

async function main() {
  const args = process.argv.slice(2);
  const targetUrl = args[0];

  if (!targetUrl) {
    console.log('Usage: node youtube-poc.js <url> [--country US] [--strategy bestHealth]');
    process.exit(1);
  }

  // Parse args
  const country = args.includes('--country') ? args[args.indexOf('--country') + 1] : null;
  const strategy = args.includes('--strategy') ? args[args.indexOf('--strategy') + 1] : 'bestHealth';

  try {
    console.log(`[youtube-poc] Making request to: ${targetUrl}`);
    console.log(`[youtube-poc] Strategy: ${strategy}, Country: ${country || 'any'}`);

    // Method 1: Direct proxy selection
    console.log('\n--- Method 1: Direct Proxy Selection ---');
    const client = new ProxyClient('http://localhost:3000');

    // Get available countries
    const { countries, stats } = await client.getCountries();
    console.log(`Available countries: ${countries.join(', ')}`);
    console.log('Country stats:', stats);

    // Select proxy
    const proxy = await client.selectProxy({ strategy, country });
    console.log(`Selected proxy: ${proxy.proxyId} (${proxy.country})`);
    console.log(`  Local: 127.0.0.1:${proxy.localPort}`);
    console.log(`  Exit: ${proxy.exitIp}`);
    console.log(`  Health: ${proxy.health}%`);

    // Get proxy stats
    const stats2 = await client.getProxyStats(proxy.proxyId);
    console.log('Proxy stats:', stats2);

    // Method 2: Using HttpWithProxy wrapper
    console.log('\n--- Method 2: HTTP Wrapper (Auto-Retry) ---');
    const httpProxy = new HttpWithProxy('http://localhost:3000', {
      maxRetries: 3,
      timeout: 10000,
    });

    const startTime = Date.now();
    const response = await httpProxy.fetch(targetUrl, {}, { strategy, country });
    const duration = Date.now() - startTime;

    console.log(`Response status: ${response.status} (${duration}ms)`);
    console.log(`Response headers:`, {
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
    });

    // Read response
    const contentType = response.headers.get('content-type');
    let body;
    if (contentType?.includes('application/json')) {
      body = await response.json();
      console.log('Response (JSON):', JSON.stringify(body, null, 2).slice(0, 500) + '...');
    } else if (contentType?.includes('text/')) {
      body = await response.text();
      console.log('Response (Text):', body.slice(0, 500) + '...');
    } else {
      body = await response.blob();
      console.log(`Response (Blob): ${body.size} bytes`);
    }

    // Get pool stats
    console.log('\n--- Pool Status ---');
    const poolStats = await httpProxy.getStats();
    console.log('Pool stats:', poolStats);

    console.log('\n✅ Success!');
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
}

main();
