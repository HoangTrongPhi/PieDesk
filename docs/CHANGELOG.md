# PieDesk — Changelog

## Chưa phát hành
- **Đa màn hình**: monitor id ổn định (device path của `QueryDisplayConfig`); layout cũ theo tên `\\.\DISPLAYn` được
  đổi một lần. Surface tự tạo / đóng / đặt lại khi cắm, rút màn hình hoặc đổi độ phân giải, scale.
- Cài đặt "Màn hình chính của PieDesk" (theo Windows hoặc chọn tay): nơi tạo layout đầu, box mới và box mồ côi.
- Box mồ côi giữ monitor id và toạ độ gốc, tự về chỗ cũ khi cắm lại màn hình; kéo nó trên màn chính thì nó ở lại đó.
- Kéo box / widget qua mép màn hình sang màn khác (có bóng xem trước, quy đổi DPI), hoặc chuột phải → "Chuyển sang …".
- Tab Bố cục hiện tên màn hình thật (EDID).
- Không làm: phím tắt Win+Shift+←/→ (Windows đã dùng tổ hợp này để chuyển cửa sổ giữa các màn hình) và tuỳ chọn
  "màn chính = màn đang có chuột".

## Kế hoạch (chưa làm)

### 1. Gom nhóm app tự động
- Quét Start Menu, Desktop, shortcut trong box; giải `.lnk` ra exe.
- Tín hiệu: tên exe đã biết (`code.exe`, `cursor.exe`, `devenv.exe`, `idea64.exe`, `rider64.exe`, `UnrealEditor.exe`,
  `Unity Hub.exe`, `Godot*.exe`, `blender.exe`, `maya.exe`, `3dsmax.exe`, `houdini*.exe`, `ZBrush.exe`…), `FileDescription`
  / `CompanyName`, đường dẫn (`steamapps\common`, `Epic Games` → Game), thư mục Start Menu.
- Nhóm: Code Editor, IDE, Game Engine, 3D/DCC, 2D/Design, Audio/Video, Dev Tools, Browser, Game, Chat, Office, Utility, Khác.
- Điểm thấp → "Khác" + gợi ý; người dùng sửa thì nhớ lại. Luật trong `rules.json`, cập nhật qua self-update.
- Nút "Tự tạo box theo nhóm"; theo dõi Start Menu để app mới cài tự vào đúng box.

### 2. Theme engine
- Theme = CSS tokens + effect module tuỳ chọn (lớp canvas + CSS hook), chỉ nạp khi bật; đóng gói dạng thư mục.
- Theme thường: Fluent Glass, Minimal Light/Dark, Nord, Dracula, Catppuccin, Paper.
- Theme đặc biệt: Cyberpunk (glitch/RGB split khi hover), Matrix (mưa ký tự), Synthwave (lưới chân trời), Sakura
  (cánh hoa đọng trên box), Winter (tuyết đọng nóc box), Aquarium (bong bóng, cá), Galaxy (parallax sao), Retro Pixel/CRT,
  Lofi Rain (giọt mưa trên kính box), Steampunk (bánh răng quay).
- Theme theo mùa tự bật theo ngày: Halloween, Giáng sinh, Tết, Trung thu.

### 3. Overlay FX / desktop pet
- Cửa sổ trong suốt topmost, xuyên chuột, canvas/WebGL; dùng lại effect module của theme.
- Hiệu ứng biết vị trí box: tuyết đọng trên box, pet đi trên mép box, hoa rơi trượt theo thanh tiêu đề.
- Dừng khi fullscreen (`guard.rs`), giới hạn 30 FPS, tắt khi chạy pin.

### Khác (chưa xếp thứ tự)
- Quy tắc tự sắp file mới trên desktop vào box; backup/restore bố cục; chế độ tiết kiệm pin.

### Đã bỏ qua
- Xoay màn hình dọc/ngang (bố cục theo hướng) và chế độ sửa kiểu iOS / Smart Stack / nhiều trang desktop.

## v0.1.4
- Tự khởi động khi đăng nhập qua Task Scheduler; nút "Gom shortcut app ra desktop"; lần đầu không tạo box Desktop.

## v0.1.3
- Shortcut được chuyển hẳn vào box (chỉ một bản tồn tại, "Trả về desktop" khôi phục); mặc định khởi động cùng Windows.

## v0.1.0 – v0.1.2
- MVP: Box (Shortcut / Folder Portal / Smart), widget registry, i18n vi/en, 4 theme, party mode, widget Thời tiết và
  Agents, self-update.
