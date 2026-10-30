# PieDesk

Sắp xếp desktop Windows bằng **Box** và **Widget** tuỳ biến. App độc lập (không thuộc Abyss).
Tauri 2 + Rust + React 19. Kiến trúc và lộ trình: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Chạy

```bash
npm install
npm run tauri dev        # app thật trên desktop
npm run dev              # chỉ UI trong trình duyệt, backend giả: /?view=surface hoặc /?view=manager
npm run check            # typecheck + test Rust
npm run tauri build      # bộ cài NSIS trong src-tauri/target/release/bundle
```

## Dùng

- **Khay hệ thống** (icon PieDesk): Thêm Box, Thêm Widget, Ẩn/hiện, Khoá bố cục, Cài đặt, Thoát.
- **Alt+Shift+D**: ẩn/hiện toàn bộ box + widget (đổi trong Cài đặt).
- **Box**: kéo thanh tiêu đề để di chuyển, góc dưới phải để đổi cỡ, double-click tiêu đề để thu gọn, chuột phải để tuỳ chỉnh.
  Kéo file từ Explorer vào box để thêm; kéo icon giữa các box để sắp xếp.
- **Folder Box**: phản chiếu một thư mục thật, tự cập nhật; có thể lọc theo đuôi file. Lần chạy đầu tạo sẵn box “Desktop”.
- **Widget**: rê chuột lên widget → thanh ⋯ phía trên để kéo, ⚙ để cài đặt; chuột phải để đổi nền / nhân bản / xoá.
- **Giao diện**: Cài đặt → Ngôn ngữ (Tiếng Việt / English), 4 theme (Neon Room mặc định, Midnight, Aurora, Ember),
  **Party mode** (LED RGB chạy quanh viền mọi box & widget; mặc định tắt, bật nhanh ở khay hệ thống).
- **Thời tiết**: trạm neon với icon động, biểu đồ 12 giờ (nhiệt độ + khả năng mưa), dự báo 5 ngày khi widget đủ cao.
- **Agent sessions**: theo dõi Claude Code (`~/.claude/projects/*.jsonl`) và Antigravity
  (`~/.gemini/antigravity/conversation_summaries.db`) — đang chạy / đang chờ / xong. Khi một session xong:
  chuông rung + âm báo trong widget và thông báo Windows (tắt được trong Cài đặt). Bấm chuông để đánh dấu đã xem.

## Viết widget của riêng bạn

Cách nhanh: widget **Web widget** chạy một file HTML cục bộ trong iframe sandbox.

```html
<script>
  parent.postMessage({ piedesk: "subscribe", topic: "cpu" }, "*"); // cpu | mem | net | disk
  addEventListener("message", (e) => {
    if (e.data?.piedesk === "data") document.body.textContent = `${e.data.payload.total.toFixed(0)}%`;
  });
</script>
```

Widget gốc: tạo file trong `src/widgets/` bằng `defineWidget({...})` rồi thêm vào `src/widgets/registry.ts`.

Dữ liệu lưu ở `%APPDATA%\com.phineas.piedesk\state.json`, cache icon ở `%LOCALAPPDATA%\com.phineas.piedesk\icons`.
