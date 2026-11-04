# AgentProxy - Notes

## 🔍 Tổng Quan

**AgentProxy** là một ứng dụng desktop (Electron) quản lý proxy từ backend service của Shiplo.

- **Backend URL:** `https://api-proxy.shiplo.site/api/v1`
- **Device ID:** `mac-d186a64110d49284` (locked to MAC address)
- **Device Token:** `92d94aeb91b3655761d3e10d3a74181bcc2195286745803f`
- **Physical MAC:** `00:e0:4f:33:7a:cd`

---

## 📊 Allocation Hiện Tại

**Tổng:** 20 proxies từ **18 quốc gia**

### Countries & Proxy Count:
| Country | Count | Code |
|---------|-------|------|
| Australia | 3 | AU |
| Estonia | 1 | EE |
| Czech Republic | 1 | CZ |
| Lithuania | 1 | LT |
| Argentina | 1 | AR |
| Germany | 1 | DE |
| United Kingdom | 1 | GB |
| Singapore | 1 | SG |
| Chile | 1 | CL |
| Côte d'Ivoire | 1 | CI |
| Portugal | 1 | PT |
| India | 1 | IN |
| Thailand | 1 | TH |
| New Zealand | 1 | NZ |
| Ireland | 1 | IE |
| Ukraine | 1 | UA |
| Brazil | 1 | BR |
| Croatia | 1 | HR |

---

## 🔌 Local Proxy Endpoints

```
Bind IP: 127.0.0.1
Port Range: 8801 - 8820
MCP Port: 6789
```

**Usage:**
```
http://127.0.0.1:8801  → Exit qua country đầu tiên
http://127.0.0.1:8802  → Exit qua country thứ 2
...
http://127.0.0.1:8820  → Exit qua country thứ 20
```

---

## ⚙️ Quotas & Limits

### Rotate Limit
- **20 rotations per 20 minutes**
- Current status: **EXCEEDED** (quota hết)
- ⏱️ Next reset: ~20 phút từ lần rotate cuối

### Proxy Resets
- **Total lifetime:** 0 (chưa dùng)
- **Reset quota:** 20/20 available

---

## ⚠️ Known Issues

### Country Label Mismatch

| Port | Allocation Label | Actual Exit IP | Actual Country |
|------|------------------|----------------|-----------------|
| 8805 | Japan - Tokyo | 144.48.39.114 | **Australia** ❌ |

**Nguyên nhân:** Backend metadata sai hoặc exit pool rotation không match

---

## ❌ Trung Quốc (CN)

**Status:** ❌ NOT AVAILABLE

Allocation hiện tại **KHÔNG CÓ proxy Trung Quốc**. 

Để có CN proxy, bạn cần:
1. Liên hệ Shiplo (backend provider)
2. Upgrade tier (có thể tier cao hơn mới có CN)
3. Hoặc đợi lần reset allocation tiếp theo (backend có thể gán khác)

---

## 🔧 API Endpoints

```
GET /v1/allocation                    → Lấy allocation
POST /v1/allocation/{id}/rotate       → Rotate proxy
POST /v1/allocation/{id}/failure      → Report failure
GET /v1/allocation/{id}/credentials   → Lấy credentials
GET /v1/commands                      → Operator commands (revoke, lock...)
```

**Headers:**
```
Authorization: Bearer {deviceToken}
Content-Type: application/json
```

---

## 📝 Cách Sử Dụng

### 1. Start App
```powershell
npm start
```

### 2. Rotate Proxy (UI)
Nhấn nút "rotate" trên proxy bạn muốn đổi exit

### 3. Test via Script
```powershell
node test-rotate.js
```
Script sẽ rotate liên tục để tìm một quốc gia cụ thể (có thể sửa trong code)

### 4. Test via API
```powershell
$token = "92d94aeb91b3655761d3e10d3a74181bcc2195286745803f"
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

$response = Invoke-WebRequest -Uri "https://api-proxy.shiplo.site/api/v1/allocation" `
    -Headers $headers `
    -UseBasicParsing

$response.Content | ConvertFrom-Json | ConvertTo-Json
```

---

## 📌 MCP Tools (cho AI Agents)

```javascript
list_proxies(country="AU")          // Lọc proxy theo country
get_allocation()                     // Lấy allocation (không cần start)
connect()                            // Start local proxy servers
disconnect()                         // Stop servers
rotate({proxy: "127.0.0.1:8801"})   // Rotate một proxy cụ thể
```

**MCP Endpoint:** `http://127.0.0.1:6789/mcp`

---

## 🔐 Security Notes

- Device ID được **lock to MAC address** → không thể copy sang máy khác
- Public IP cũng dùng để key quota
- Token lưu trong: `C:\Users\Tuan\AppData\Roaming\agentproxy\device.json`

---

## 📅 Last Updated
2026-11-05

---

## ❓ Kế tiếp

- [ ] Liên hệ Shiplo nếu cần proxy CN
- [ ] Kiểm tra quota reset status
- [ ] Tìm proxy service khác nếu cần CN urgently
