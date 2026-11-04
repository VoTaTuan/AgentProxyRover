'use strict';

const path = require('node:path');
const os = require('node:os');
const { BackendClient } = require('./lib/backend-client');

const appDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'agentproxy');

async function findChinaProxy() {
  const client = new BackendClient(undefined, appDataDir);
  let attempts = 0;
  const maxAttempts = 100;

  console.log('🔍 Tìm proxy Trung Quốc...\n');

  while (attempts < maxAttempts) {
    try {
      const alloc = await client.getAllocation();
      console.log(`[${attempts}] Allocation có ${alloc.items?.length ?? 0} proxy`);

      if (!alloc.items?.length) {
        console.log('❌ Allocation trống!');
        break;
      }

      // Kiểm tra có proxy CN không
      const cnProxy = alloc.items.find((p) => p.country?.toUpperCase() === 'CN');
      if (cnProxy) {
        console.log('\n✅ Tìm thấy proxy Trung Quốc!');
        console.log(JSON.stringify(cnProxy, null, 2));
        return cnProxy;
      }

      // In danh sách country hiện tại
      const countries = alloc.items.map((p) => p.country).join(', ');
      console.log(`   Countries: ${countries}`);

      // Rotate tất cả proxy
      console.log('   Rotating...');
      for (const item of alloc.items) {
        try {
          await client.rotateProxy(item.id);
        } catch (e) {
          console.log(`   ⚠️  Rotate ${item.id} failed: ${e.message}`);
        }
      }

      attempts++;
      // Delay 2s trước lần kiểm tra tiếp theo
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.error('❌ Error:', e.message);
      break;
    }
  }

  console.log(`\n❌ Không tìm thấy proxy CN sau ${maxAttempts} lần thử`);
  console.log('💡 Có thể backend pool không có proxy Trung Quốc');
}

findChinaProxy();
