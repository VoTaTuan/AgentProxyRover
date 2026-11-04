'use strict';

const path = require('node:path');
const os = require('node:os');
const { BackendClient } = require('./lib/backend-client');

const appDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'agentproxy');

/**
 * Detect actual country từ exit IP bằng geolocation API
 * Free API: ipapi.co, ip-api.com
 */
async function detectCountryFromIP(ipAddress) {
  try {
    // ipapi.co - free, không cần API key
    const response = await fetch(`https://ipapi.co/${ipAddress}/json/`);
    const data = await response.json();
    return {
      country: data.country_code,
      countryName: data.country_name,
      city: data.city,
      region: data.region,
    };
  } catch (e) {
    console.error(`❌ Error detecting country for ${ipAddress}:`, e.message);
    return null;
  }
}

async function detectAllCountries() {
  const client = new BackendClient(undefined, appDataDir);
  console.log('🔍 Detecting actual countries từ exit IPs...\n');

  try {
    const alloc = await client.getAllocation();
    const items = alloc.items ?? [];

    if (!items.length) {
      console.log('❌ No allocation items found');
      return;
    }

    console.log(`Found ${items.length} proxies. Detecting actual countries...\n`);

    const results = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const exitIp = item.exitHost?.split(':')[0] ?? item.exitHost;

      if (!exitIp || exitIp.includes('-')) {
        console.log(`[${i + 1}] ${item.country || 'UNKNOWN'}: ${item.exitHost || 'N/A'} - Skip (not IP)`);
        results.push({
          port: 8801 + i,
          label: item.country,
          exitHost: item.exitHost,
          exitIP: exitIp,
          actualCountry: '?',
          match: '?',
        });
        continue;
      }

      console.log(`[${i + 1}] ${item.country}: ${exitIp} - Detecting...`);

      const geo = await detectCountryFromIP(exitIp);
      if (geo) {
        const match = geo.country === item.country ? '✅' : '❌';
        console.log(
          `     → ${geo.country} (${geo.countryName}, ${geo.city}) ${match}`,
        );
        results.push({
          port: 8801 + i,
          label: item.country,
          exitHost: item.exitHost,
          exitIP: exitIp,
          actualCountry: geo.country,
          actualCountryName: geo.countryName,
          city: geo.city,
          match: match === '✅' ? 'OK' : 'MISMATCH',
        });
      } else {
        console.log(`     → Error detecting`);
        results.push({
          port: 8801 + i,
          label: item.country,
          exitHost: item.exitHost,
          exitIP: exitIp,
          actualCountry: 'ERROR',
          match: 'ERROR',
        });
      }

      // Rate limiting - 500ms delay giữa requests
      await new Promise((r) => setTimeout(r, 500));
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('='.repeat(80));

    const mismatches = results.filter((r) => r.match === 'MISMATCH');
    const ok = results.filter((r) => r.match === 'OK');
    const errors = results.filter((r) => r.match === 'ERROR');

    console.log(`✅ Matched: ${ok.length}`);
    console.log(`❌ Mismatches: ${mismatches.length}`);
    console.log(`⚠️  Errors: ${errors.length}`);

    if (mismatches.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('MISMATCHES:');
      console.log('='.repeat(80));
      for (const m of mismatches) {
        console.log(`Port ${m.port}: Label "${m.label}" but actual "${m.actualCountry}" (${m.city})`);
      }
    }

    // Generate markdown table
    console.log('\n' + '='.repeat(80));
    console.log('MARKDOWN TABLE:');
    console.log('='.repeat(80));
    console.log('\n| Port | Label | Exit IP | Actual Country | Match |');
    console.log('|------|-------|---------|----------------|-------|');
    for (const r of results) {
      const match = r.match === 'OK' ? '✅' : r.match === 'MISMATCH' ? '❌' : '⚠️';
      console.log(
        `| ${r.port} | ${r.label} | ${r.exitIP} | ${r.actualCountry} | ${match} |`,
      );
    }
  } catch (e) {
    console.error('❌ Fatal error:', e.message);
  }
}

detectAllCountries();
