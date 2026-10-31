# PieDesk — Kiến trúc & đề xuất tính năng

PieDesk là app độc lập (không thuộc hệ sinh thái Abyss) để sắp xếp desktop Windows bằng **Box** (hộp chứa
shortcut/thư mục) và **Widget** tùy biến. Stack: Tauri 2 + Rust + React 19 + Zustand + Tailwind 4.

## 1. So sánh với iTop Easy Desktop và các điểm cải tiến

| iTop Easy Desktop | PieDesk |
|---|---|
| Mỗi box là một cửa sổ riêng (nhiều HWND, mỗi box tự vẽ) | **Một surface WebView duy nhất mỗi màn hình**, mọi box + widget là phần tử DOM trên đó → RAM gần như không tăng theo số box |
| Box chỉ chứa icon | Box 3 loại: **Shortcut** (tự thêm), **Folder Portal** (phản chiếu thư mục thật, cập nhật live), **Smart** (lọc theo đuôi file của một thư mục) |
| Widget cố định của hãng | **Widget registry** + **Web widget** (HTML cục bộ chạy trong iframe sandbox, đọc dữ liệu hệ thống qua bridge) |
| Luôn chạy, kể cả khi chơi game | **Game/Fullscreen guard**: phát hiện app toàn màn hình → ẩn surface + dừng thu thập số liệu → ~0% CPU |
| Thu thập số liệu theo chu kỳ cố định | **Data hub pub/sub đếm tham chiếu**: chỉ đo CPU/RAM/mạng khi có widget đang subscribe |
| Icon load lại mỗi lần | **Icon pipeline**: Shell `IShellItemImageFactory` → PNG → cache đĩa theo hash → phục vụ qua giao thức `icon://` có HTTP cache |
| Bố cục cố định theo độ phân giải | Toạ độ lưu **theo từng màn hình** (monitor id) + snap lưới |

Tính năng Box đã có trong MVP:
- Kéo-thả file/shortcut từ Explorer vào box; sắp xếp lại / chuyển item giữa các box bằng kéo thả.
- Thu gọn box (double-click thanh tiêu đề), lọc nhanh trong box, chế độ lưới / danh sách, 3 cỡ icon.
- Màu nhấn, độ trong suốt riêng từng box; khoá bố cục toàn cục.
- Menu chuột phải: mở, chạy quyền admin, mở vị trí file, đổi tên, xoá khỏi box.
- Click đơn hoặc double-click để mở (tuỳ chọn).

Widget có sẵn: Đồng hồ (số/kim, múi giờ), Lịch tháng, System Monitor (CPU/RAM/mạng + sparkline), Thời tiết
(Open-Meteo, không cần API key), Ghi chú, To-do, Ảnh, Đếm ngược, Web widget.

## 2. Kiến trúc

```
┌──────────────── Rust (tauri) ─────────────────────────────────────────┐
│ desktop.rs   gắn surface vào desktop: tool window, owner = Progman,   │
│              HWND_BOTTOM, phủ vùng làm việc của từng màn hình          │
│ surfaces.rs  1 surface / màn hình, đồng bộ khi cắm-rút; kéo box sang   │
│              màn khác (drag_over / drag_end)                          │
│ monitors.rs  monitor id ổn định (device path, QueryDisplayConfig)     │
│ catalog.rs   nhận diện + gom nhóm app (rules/apps.json), theo dõi     │
│              Start Menu                                               │
│ overlays.rs  cửa sổ overlay trên mọi app cho FX / mèo Pie             │
│ hittest.rs   luồng 60 Hz: GetCursorPos ∩ rect tương tác → bật/tắt      │
│              click-through (set_ignore_cursor_events) chỉ khi đổi trạng│
│ store.rs     nguồn sự thật duy nhất: settings + boxes + widgets,       │
│              nhận "ops" (upsert/delete), phát lại cho mọi cửa sổ,      │
│              ghi đĩa có debounce + atomic rename                       │
│ icons.rs     giao thức icon:// (bất đồng bộ), COM trên luồng worker,   │
│              cache RAM + đĩa (xxh3 của path+mtime+size)                │
│ hub.rs       pub/sub số liệu hệ thống, refcount theo topic             │
│ guard.rs     phát hiện fullscreen (SHQueryUserNotificationState)       │
│ folders.rs   liệt kê + theo dõi thư mục (notify, debounce)             │
│ shell.rs     ShellExecuteW (open / runas), mở vị trí file              │
└───────────────────────────────────────────────────────────────────────┘
          ▲ invoke / events                    ▲ http://icon.localhost
┌──────────── WebView: surface-<n> (1 / màn hình) ──────┐  ┌── manager ──┐
│ React: BoxView, WidgetFrame, context menu, drag engine│  │ Cài đặt,    │
│ hit-rects → Rust mỗi khi bố cục đổi (ResizeObserver)  │  │ thư viện    │
└───────────────────────────────────────────────────────┘  │ widget      │
                                                           └─────────────┘
```

### Vì sao một surface trong suốt + hit-test ở Rust?
- Một WebView2 ~ 40–70 MB. Mô hình “mỗi box một cửa sổ” với 10 box + 6 widget sẽ tốn ~1 GB; một surface/màn hình
  chỉ tốn một WebView.
- Vùng trống của surface phải “xuyên chuột” xuống desktop. Rust giữ danh sách rect tương tác (frontend gửi khi bố
  cục đổi) và một luồng nhẹ so sánh vị trí chuột; chỉ gọi Win32 khi trạng thái đổi. WebView không tham gia vòng lặp này.
- Khi đang kéo box/item hoặc mở menu, frontend bật `capture` để surface nhận toàn bộ chuột.
- Kéo file từ Explorer vẫn hoạt động: khi con trỏ vào rect của box, surface trở thành đích thả.

### Vì sao owner = Progman?
Cửa sổ thuộc sở hữu của Progman không bị Win+D ẩn, luôn nằm trên hình nền và dưới mọi cửa sổ app — không cần
nhúng vào WorkerW (nơi mà icon desktop phủ lên và không nhận chuột, nhất là trên Windows 11 24H2+).

### Mô hình dữ liệu
`store.rs` giữ `{ settings, boxes: {id → Box}, widgets: {id → Widget} }` dạng JSON. Frontend gửi `ops`, Rust áp dụng,
tăng `rev`, phát event `store://ops` cho các surface khác → nhiều màn hình không ghi đè lẫn nhau.

### Hiệu năng frontend
- Kéo/resize dùng `transform` trong lúc kéo, chỉ commit vị trí vào store khi thả.
- Icon là `<img loading="lazy" decoding="async">` từ `icon://` → trình duyệt tự cache, không base64 qua IPC.
- Widget đồng hồ dùng 1 timer dùng chung; số liệu hệ thống chỉ chạy khi có subscriber.

## 3. Lộ trình đề xuất (chưa làm)
1. **Quick Search toàn cục** (Alt+Space): tìm item trong mọi box + Start Menu, chạy ngay.
2. **Trang (tabs) trong box** và **gộp box** (thả box lên box).
3. **Ẩn/hiện bằng double-click desktop** (hook chuột cấp thấp) và tự ẩn icon desktop gốc.
4. **Layout profiles**: lưu/khôi phục bố cục theo cấu hình màn hình, tự đổi khi cắm màn hình ngoài.
5. **Widget Now Playing** (GlobalSystemMediaTransportControls), GPU (NVML/D3DKMT), lịch Google/Outlook.
6. **Widget pack** dạng thư mục (`manifest.json` + `index.html`) với quyền khai báo, chia sẻ/nhập 1 click.
7. Hybrid mode: box “đặc biệt” dùng cửa sổ riêng có Acrylic thật (đổi RAM lấy hiệu ứng blur hệ thống).

### Thứ tự ưu tiên (chốt 2026-10-31, chi tiết trong CHANGELOG.md › Kế hoạch)
1. ✅ **Đa màn hình** (đã làm): nhận màn chính (`MONITORINFOF_PRIMARY`, kiểm tra lại khi `WM_DISPLAYCHANGE`); monitor id lấy từ
   device path của `QueryDisplayConfig` (ổn định qua reboot); box mới / box mồ côi về màn chính, giữ toạ độ gốc để trả về
   khi cắm lại. Kéo box giữa màn hình bằng chuyển giao giữa các surface (`drag://move` + op `moveBox`), quy đổi DPI,
   snap trọn vào một màn.
2. ✅ **Gom nhóm app tự động** (đã làm, `catalog.rs`): chấm điểm theo tên exe, version info, đường dẫn cài, thư mục Start Menu; luật trong
   `rules.json`; nhớ lựa chọn sửa tay của người dùng.
3. ✅ **Theme engine** (đã làm, `src/themes`, `src/fx`): CSS tokens + effect module nạp lười; theme đặc biệt và theo mùa.
4. ✅ **Overlay FX / desktop pet** (đã làm, `overlays.rs`, `src/fx/pet.ts`): cửa sổ topmost xuyên chuột, dùng lại effect module, biết vị trí box.

Đã bỏ qua: xoay màn hình dọc/ngang và chế độ sửa kiểu iOS.
