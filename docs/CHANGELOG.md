# PieDesk — Changelog

## Chưa phát hành — theme lễ hội
- **Decor theo theme** (`src/decor`, 52 SVG vẽ tay, mỗi file một chunk lazy): cảnh đứng trên desktop tự tìm chỗ trống
  không đè box / widget (tránh cột icon bên trái), trượt sang chỗ mới khi box di chuyển. Đồ trang trí trên box
  (`src/fx/ornaments.ts`): cành ở góc, vật ngồi trên nóc, nhũ băng dưới đáy, đồ treo dưới box đung đưa như con lắc khi
  kéo box; nhện leo lên xuống sợi tơ. Cài đặt `decor`.
  - Giáng sinh: cây thông đèn nhấp nháy, quà, người tuyết; nhựa ruồi, nhũ băng, quả châu / kẹo gậy / tất treo;
    bông tuyết tinh thể; xe tuần lộc bay ngang.
  - Halloween: bia mộ, vạc sủi bọt, bí ngô khắc mặt nến chập chờn; mạng nhện góc box, bí ngô nhỏ trên nóc, nhện thả tơ;
    sương tím dưới chân, ma trôi; đàn dơi bùng ra từ góc màn hình, phù thuỷ cưỡi chổi.
  - Tết: chậu mai, chậu đào, nồi bánh chưng bốc khói, mâm ngũ quả; cành mai / đào góc box; lì xì, đèn lồng, dây pháo
    treo; hoa mai đào rơi; pháo hoa 6 kiểu nhiều màu, bắn dày 15 phút đầu giao thừa.
  - Trung thu: trăng rằm có cây đa chú Cuội, đèn kéo quân xoay bóng, mâm bánh trung thu, thỏ ngọc; đèn ông sao, cá chép,
    thỏ, đèn lồng tròn treo dưới box; đèn Khổng Minh bay lên; mây.
- **Hiệu ứng theme trên mọi cửa sổ** (`themeOverlay`, mặc định bật): phần "sky" của theme chạy trong cửa sổ overlay
  (xe tuần lộc, đàn dơi, phù thuỷ, nhện, pháo hoa, đèn Khổng Minh). Giáng sinh có bão tuyết phủ cả taskbar: tuyết đọng
  thành lớp trên mép taskbar, nhũ băng nhỏ, sương giá, bông tuyết tan dần trên taskbar. Lệnh `theme_effects`.
- **Hình nền theo theme** (`themeWallpaper`, mặc định bật, `src-tauri/src/wallpaper.rs`): 4 hình nền tạo bằng Gemini
  (`src-tauri/wallpapers`, bundle resource) đặt cho mọi màn hình khi theme lễ bật; hết lễ hoặc Thoát PieDesk thì trả lại
  hình nền cũ từng màn hình (lưu ở `<config>/wallpaper.json`). Màn hình nào người dùng tự đổi hình thì giữ nguyên.
  Slideshow của Windows được tạm dừng rồi bật lại đúng như cũ (ảnh / thư mục, chu kỳ, xáo trộn).
- Sửa lỗi chớp tắt khi có cửa sổ overlay: Windows báo "busy" (QUNS_BUSY) vì chính overlay phủ kín màn hình, fullscreen
  guard ẩn hết rồi hiện lại mỗi 2 giây. Giờ "busy" chỉ được tin khi cửa sổ đang focus là app khác và phủ kín màn hình.
- Lỗi tạo overlay được ghi vào log.
- Runner FX xoá canvas mỗi frame (trừ effect có `trails`), đo lại vị trí box mỗi frame khi đang kéo.
- Dev: `dev/decor.html?theme=<id>` xem toàn bộ SVG.

## v0.3.0
- **Widget Đang phát** (Now Playing): bài đang phát trên Spotify, trình duyệt, trình nghe nhạc… (GSMTC của Windows,
  không cần plugin), ảnh bìa, nền mờ theo ảnh bìa, thanh tiến trình, nút trước / phát / sau.
- **Widget GPU / VRAM**: tải GPU, VRAM, biểu đồ; NVIDIA thêm nhiệt độ, điện năng / giới hạn, quạt, xung (NVML);
  danh sách app chiếm VRAM nhiều nhất. GPU hãng khác dùng bộ đếm GPU của Windows (như Task Manager).
- **Widget Lịch** có âm lịch (thuật toán Hồ Ngọc Đức, UTC+7, chạy offline), can chi ngày / tháng / năm, đánh dấu ngày lễ
  dương lịch và âm lịch, bấm một ngày để xem chi tiết.
- Theme Tết / Trung thu tính ngày theo âm lịch cho mọi năm (bỏ bảng 2026–2035; bảng cũ lệch Tết 2030 và Trung thu 2034
  vì theo giờ UTC+8).
- Widget mới thêm vào chủ đề `disk` / `media` nhận số liệu ngay ở tick kế tiếp.

## v0.2.0
- **Đa màn hình**: monitor id ổn định (device path của `QueryDisplayConfig`); layout cũ theo tên `\\.\DISPLAYn` được
  đổi một lần. Surface tự tạo / đóng / đặt lại khi cắm, rút màn hình hoặc đổi độ phân giải, scale.
- Cài đặt "Màn hình chính của PieDesk" (theo Windows hoặc chọn tay): nơi tạo layout đầu, box mới và box mồ côi.
- Box mồ côi giữ monitor id và toạ độ gốc, tự về chỗ cũ khi cắm lại màn hình; kéo nó trên màn chính thì nó ở lại đó.
- Kéo box / widget qua mép màn hình sang màn khác (có bóng xem trước, quy đổi DPI), hoặc chuột phải → "Chuyển sang …".
- Tab Bố cục hiện tên màn hình thật (EDID).
- **Gom nhóm ứng dụng** (tab Bố cục): quét desktop + Start Menu, chấm điểm theo tên exe, đường dẫn cài, URL scheme,
  CompanyName / FileDescription của exe và tên / thư mục shortcut (luật trong `src-tauri/rules/apps.json`, ghi đè bằng
  `<config>/app-rules.json`). 12 nhóm + Khác; đổi nhóm từng app được nhớ lại. "Tạo box theo nhóm": shortcut desktop chuyển
  vào box, shortcut Start Menu được sao chép. App mới cài tự vào box của nhóm (theo dõi Start Menu, tắt được).
- **Theme engine**: 24 theme chia Cơ bản / Đặc biệt / Theo mùa (`src/themes`). Mới: Fluent Glass, Minimal Light, Nord,
  Dracula, Catppuccin, Paper; đặc biệt: Cyberpunk (glitch RGB), Matrix, Synthwave, Sakura, Winter, Aquarium, Galaxy,
  Retro Pixel (CRT), Lofi Rain, Steampunk (bánh răng quay); theo mùa tự bật: Halloween, Giáng sinh, Tết, Trung thu
  (ngày âm lịch 2026–2035 có sẵn).
- **Hiệu ứng canvas** (`src/fx`): lớp sau (trong kính box) và lớp trước (trên box), 30 fps, biết vị trí box: tuyết đọng
  trên nóc box và rơi khi kéo box, hoa đậu rồi trượt khỏi box, giọt mưa chảy trên kính box. Dừng khi fullscreen, khi chạy
  pin (tuỳ chọn) hoặc khi Windows bật giảm chuyển động.
- **Overlay FX**: cửa sổ trong suốt trên mọi app, chuột xuyên qua, không lấy focus (tuyết, hoa, lá, mưa, đom đóm, đèn
  lồng); chỉ tạo khi bật.
- **Mèo Pie**: trên desktop (đi trên nóc box, nhảy giữa các box, ngồi, ngủ) hoặc trên cùng (đi dọc taskbar).
- Không làm: phím tắt Win+Shift+←/→ (Windows đã dùng tổ hợp này để chuyển cửa sổ giữa các màn hình) và tuỳ chọn
  "màn chính = màn đang có chuột".

## Kế hoạch (chưa làm)

- Quy tắc tự sắp file mới trên desktop vào box; backup/restore bố cục.
- Widget: Dự án gần đây (Unreal, Unity, Blender, JetBrains, VS Code), theo dõi build / render, clipboard, bảng điều khiển
  nhanh (âm thanh, độ sáng), nút lệnh kiểu Stream Deck.

### Đã bỏ qua
- Xoay màn hình dọc/ngang (bố cục theo hướng) và chế độ sửa kiểu iOS / Smart Stack / nhiều trang desktop.

## v0.1.4
- Tự khởi động khi đăng nhập qua Task Scheduler; nút "Gom shortcut app ra desktop"; lần đầu không tạo box Desktop.

## v0.1.3
- Shortcut được chuyển hẳn vào box (chỉ một bản tồn tại, "Trả về desktop" khôi phục); mặc định khởi động cùng Windows.

## v0.1.0 – v0.1.2
- MVP: Box (Shortcut / Folder Portal / Smart), widget registry, i18n vi/en, 4 theme, party mode, widget Thời tiết và
  Agents, self-update.
