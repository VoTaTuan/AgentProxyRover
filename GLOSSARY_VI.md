# Từ Điển Tiếng Việt - Proxy Management System

## 🔤 Các Thuật Ngữ Chính

### Proxy / Máy chủ trung gian
- Một máy tính nằm giữa bạn và website
- Khi bạn truy cập web qua proxy, website sẽ thấy IP của proxy, không phải IP thực của bạn
- **Ví dụ:** Bạn muốn lên YouTube nhưng bị chặn → dùng proxy của nước khác → YouTube thấy bạn ở nước đó

### Health / Sức khỏe (của proxy)
- Kiểm tra proxy có hoạt động tốt không
- 🟢 **Healthy (Khỏe mạnh)** = Hoạt động tốt, nhanh
- 🟡 **Warning (Cảnh báo)** = Hơi chậm, không ổn định
- 🔴 **Critical (Nguy hiểm)** = Gần như ngừng hoạt động

### Latency / Độ trễ
- Thời gian chờ (tính bằng milliseconds = ms)
- Dưới 100ms = rất nhanh ✅
- 100-500ms = bình thường ⚠️
- Trên 500ms = chậm ❌
- **Ví dụ:** Latency 120ms = mất 0.12 giây để proxy phản hồi

### Success Rate / Tỷ lệ thành công
- % số lần proxy hoạt động thành công
- 100% = luôn thành công ✅
- 95% = 19 lần thành công, 1 lần fail
- 50% = nửa lúc thành công, nửa lúc fail ❌

### Rotation / Xoay / Đổi proxy
- Bỏ proxy hiện tại, lấy proxy khác
- **Tự động rotation** = Hệ thống tự đổi proxy khi nó fail
- **Manual rotation** = Bạn tự bấm nút để đổi

### Failure / Lỗi / Thất bại
- Proxy không hoạt động được
- Khi failure > 3 lần trong 5 phút → hệ thống tự động xoay (rotation)

### Quota / Hạn mức
- Giới hạn số lần được làm cái gì
- **Ví dụ:** Shiplo cho phép 20 lần rotation per 20 phút
- Khi hết quota → phải chờ 20 phút để reset

### Device / Thiết bị / Máy
- Một cái máy chạy AgentProxy
- Bạn có thể chạy AgentProxy trên nhiều máy cùng lúc
- Backend sẽ quản lý tất cả những máy này

### Backend / Máy chủ / Server
- Máy tính chạy ở nhà bạn (hoặc trên cloud)
- Quản lý tất cả những proxy từ nhiều máy
- Chạy trên port 3000 (http://localhost:3000)

### Allocation / Cấp phát / Danh sách
- Shiplo cấp cho bạn 20 proxies
- Mỗi device đều có allocation riêng (20 proxies)

### Exit IP / IP đầu ra
- IP mà website thấy khi bạn truy cập qua proxy
- **Ví dụ:** Exit IP = 95.153.32.35 (ở Estonia) → website nghĩ bạn ở Estonia

### Country / Quốc gia
- Nước mà proxy đó nằm
- US = United States (Mỹ)
- JP = Japan (Nhật)
- VN = Vietnam (Việt Nam)
- Một proxy luôn ở một nước xác định

---

## 🔄 Các Quá Trình Chính

### Health Check / Kiểm tra sức khỏe
1. Mỗi 60 giây, hệ thống gửi HTTP request qua proxy
2. Đo độ trễ (latency)
3. Kiểm tra proxy phản hồi không
4. Cập nhật status: 🟢 🟡 🔴

### Auto-Rotation / Tự động xoay
1. Nếu proxy fail 3 lần trong 5 phút
2. Hệ thống tự động xoay (rotation) sang proxy khác
3. Website sẽ thấy IP khác
4. Retry request tự động

### Device Sync / Đồng bộ thiết bị
1. Mỗi 30 giây, máy của bạn gửi data lên backend
2. Báo: "Máy tôi online, có 15 proxy hoạt động, health là bao nhiêu"
3. Backend cập nhật database
4. Backend có danh sách toàn bộ proxies từ tất cả máy

### Load Balancing / Cân bằng tải
- Backend tự động chọn proxy **tốt nhất** cho request của bạn
- Có 3 cách chọn:
  1. **Best Health** = chọn proxy khỏe nhất
  2. **Least Used** = chọn proxy ít người dùng
  3. **Round Robin** = xoay vòng qua từng proxy

---

## 🎯 Các Chiến Lược (Strategy)

### bestHealth / Sức khỏe tốt nhất
- Chọn proxy có health cao nhất
- Ưu điểm: Nhanh nhất, ít fail
- Nhược điểm: Một số proxy bị tải quá

### leastUsed / Ít sử dụng nhất
- Chọn proxy ít người dùng
- Ưu điểm: Cân bằng tải tốt
- Nhược điểm: Có thể chậm

### roundRobin / Vòng tròn
- Xoay vòng qua từng proxy (1, 2, 3, 1, 2, 3...)
- Ưu điểm: Công bằng cho tất cả
- Nhược điểm: Không thông minh

### geoRotation / Xoay quốc gia
- Mỗi request dùng proxy từ quốc gia khác
- Request 1 → US, Request 2 → JP, Request 3 → UK...
- Ích: Mỗi request từ quốc gia khác, khó bị phát hiện

---

## 🛡️ Bảo Vệ & An Toàn

### Circuit Breaker / Ngắt mạch
- Nếu proxy fail 5 lần liên tiếp
- Hệ thống **tắt nó đi** trong 10 phút
- Sau 10 phút, thử lại
- Tránh lãng phí thời gian vào proxy chết

### Retry / Thử lại
- Nếu request fail lần 1
- Tự động thử lại với proxy khác
- Mặc định thử tối đa 3 lần
- Mỗi lần chờ thêm 1-3 giây

### Session / Phiên làm việc
- Lưu thông tin (cookies, tokens) cho mỗi proxy
- Nếu proxy A đã login → giữ login đó
- Không cần login lại khi dùng proxy A
- Mỗi proxy = 1 "người dùng" khác

---

## 💾 Dữ Liệu & Lưu Trữ

### SQLite / Cơ sở dữ liệu
- Database nhỏ, lưu trong 1 file (`pool.db`)
- Không cần setup, không cần server riêng
- Lưu thông tin: devices, proxies, metrics

### Metrics / Chỉ số
- Lưu lịch sử hoạt động của mỗi proxy
- Latency qua từng thời điểm
- Success rate qua từng thời điểm
- Giữ 7 ngày (hoặc tuỳ config)

### Device ID / Mã thiết bị
- ID unique cho mỗi máy
- Dựa trên MAC address (không thay đổi)
- Ngay cả khi reinstall, vẫn có ID cũ
- Không bị copy sang máy khác được

---

## 🌐 API & HTTP

### GET / Lấy dữ liệu
- `GET /api/proxies` = Lấy danh sách proxies
- `GET /api/stats` = Lấy thống kê pool

### POST / Gửi dữ liệu
- `POST /api/proxies/select` = Yêu cầu chọn proxy tốt nhất
- `POST /api/metrics` = Báo cáo latency/success rate

### Response / Phản hồi
- Server trả lại dữ liệu (thường JSON)
- **Ví dụ:**
```json
{
  "proxy": {
    "proxyId": "device-1:alloc-123",
    "country": "US",
    "localPort": 8801,
    "health": 95
  }
}
```

---

## 📊 Ví Dụ Thực Tế

### Scenario 1: Dùng proxy để xem YouTube
```
1. Bạn muốn xem video YouTube
2. Gọi: selectProxy() → Backend chọn proxy tốt nhất
3. Proxy trả về: "127.0.0.1:8801, nước Mỹ"
4. Bạn truy cập YouTube qua proxy này
5. YouTube thấy: Bạn ở Mỹ (IP = 95.153.32.35)
6. Video mở được ✅
```

### Scenario 2: Proxy bị chặn, tự động xoay
```
1. Request 1 qua 127.0.0.1:8801 → fail ❌
2. Report failure → health giảm
3. Request 2 → hệ thống chọn proxy khác (8802)
4. Request 2 thành công ✅
5. Proxy 8801 bị đánh dấu "warning"
6. Request tiếp theo sẽ tránh proxy 8801
```

### Scenario 3: Geo-rotation
```
Request 1: US proxy → Exit IP = 1.2.3.4
Request 2: JP proxy → Exit IP = 5.6.7.8
Request 3: UK proxy → Exit IP = 9.10.11.12
Request 4: US proxy → Exit IP = 13.14.15.16
...
```
- Website thấy requests từ quốc gia khác nhau
- Khó phát hiện bạn đang dùng bot

---

## 🔌 Kết Nối Các Phần

```
┌─────────────────────────────┐
│ YouTube (hay tool khác)     │
│ Muốn dùng proxy             │
└────────────┬────────────────┘
             │ Gọi selectProxy()
             ↓
┌─────────────────────────────┐
│ Backend Pool Manager        │
│ (localhost:3000)            │
│ Chọn proxy tốt nhất         │
└────────────┬────────────────┘
             │ Trả về: "8801, US, health 95"
             ↓
┌─────────────────────────────┐
│ Local Proxy (127.0.0.1:8801)│
│ Chạy trên máy bạn           │
│ Health monitor tự động check│
└────────────┬────────────────┘
             │
             ↓
┌─────────────────────────────┐
│ Shiplo Backend              │
│ (Cấp phát proxies)          │
└─────────────────────────────┘
```

---

## 📝 Tóm Tắt Nhanh

| Thuật ngữ | Nghĩa | Ví dụ |
|-----------|-------|-------|
| Proxy | Máy chủ trung gian | 127.0.0.1:8801 |
| Health | Sức khỏe | 🟢 Healthy |
| Latency | Độ trễ | 120ms |
| Success Rate | % thành công | 98% |
| Rotation | Xoay/Đổi | Đổi proxy khi fail |
| Quota | Hạn mức | 20 lần/20 phút |
| Device | Thiết bị | Máy bạn chạy app |
| Backend | Server | localhost:3000 |
| Country | Quốc gia | US, JP, VN... |
| Exit IP | IP đầu ra | 95.153.32.35 |
| Load Balance | Cân bằng tải | Chọn proxy tốt nhất |
| Circuit Breaker | Ngắt mạch | Tắt proxy xấu |
| Retry | Thử lại | Cố gắng 3 lần |
| Session | Phiên làm việc | Lưu cookies |

---

## ❓ FAQ Nhanh

**Q: Proxy là gì?**
A: Máy trung gian giúp ẩn IP thực của bạn

**Q: Tại sao cần auto-rotation?**
A: Khi proxy fail, tự động chuyển proxy khác, không cần bạn làm

**Q: Health 🔴 là sao?**
A: Proxy chậm hoặc gần như ngừng hoạt động, nên thay proxy khác

**Q: Quota 20/20 min là gì?**
A: Được rotation (đổi proxy) tối đa 20 lần trong 20 phút

**Q: Circuit breaker là gì?**
A: Tự động tắt proxy xấu đi để tránh lãng phí thời gian

---

**Bây giờ bạn hiểu rõ hơn chứ? 😊**
