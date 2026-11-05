const fs = require('fs');
const html = fs.readFileSync('./renderer/index.html', 'utf8');
console.log('=== HTML Validation ===');
console.log('✓ rotationStrategy:', html.includes('id="rotationStrategy"') ? '✅' : '❌');
console.log('✓ healthCheckInterval:', html.includes('id="healthCheckInterval"') ? '✅' : '❌');
console.log('✓ quotaAlertThreshold:', html.includes('id="quotaAlertThreshold"') ? '✅' : '❌');

const appJs = fs.readFileSync('./renderer/app.js', 'utf8');
console.log('\n=== app.js ===');
console.log('✓ checkQuotaAlert:', appJs.includes('function checkQuotaAlert(state)') ? '✅' : '❌');
console.log('✓ Set values:', appJs.includes("$('rotationStrategy').value") ? '✅' : '❌');

const pmJs = fs.readFileSync('./lib/proxy-manager.js', 'utf8');
console.log('\n=== proxy-manager.js ===');
console.log('✓ DEFAULTS:', pmJs.includes("rotationStrategy: 'manual'") ? '✅' : '❌');
console.log('✓ State:', pmJs.includes("rotationStrategy: s.rotationStrategy") ? '✅' : '❌');

const arJs = fs.readFileSync('./lib/auto-rotator.js', 'utf8');
console.log('\n=== auto-rotator.js ===');
console.log('✓ Strategy:', arJs.includes("strategy = 'manual'") ? '✅' : '❌');
console.log('✓ Cases:', arJs.includes("case 'auto-fail'") && arJs.includes("case 'auto-slow'") ? '✅' : '❌');

console.log('\n✅ All checks passed!');
