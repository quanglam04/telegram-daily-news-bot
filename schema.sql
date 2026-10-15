-- Sự kiện: quota, ngày lễ, deadline, sinh nhật...
-- 1 bảng chung, phân biệt bằng category
-- target_date LUÔN là ngày DƯƠNG LỊCH (solar)
-- Nếu is_lunar=1, metadata chứa {"lunar_day":x,"lunar_month":y} để recalculate hằng năm
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'general',      -- "quota" | "holiday" | "personal" | "deadline"
  emoji       TEXT DEFAULT '📌',
  target_date TEXT NOT NULL,                        -- ISO datetime, LUÔN là ngày dương lịch
  is_lunar    INTEGER DEFAULT 0,                    -- 0 = gốc dương lịch, 1 = gốc âm lịch (cần recalculate hằng năm)
  recurrence  TEXT,                                 -- NULL = 1 lần, "yearly" = hằng năm, "monthly" = hằng tháng
  notify_days TEXT DEFAULT '7,3,1,0',               -- nhắc trước mấy ngày (comma-separated)
  metadata    TEXT,                                 -- JSON tùy ý. Nếu is_lunar=1: {"lunar_day":10,"lunar_month":3}
  enabled     INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Dedup: tin đã gửi, tránh gửi lại tin cũ
CREATE TABLE IF NOT EXISTS sent_articles (
  url_hash TEXT PRIMARY KEY,
  title    TEXT,
  sent_at  TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Dữ liệu mẫu: Tất cả target_date đều là ngày DƯƠNG LỊCH
-- Các ngày lễ âm lịch đã được quy đổi sang dương lịch 2026
-- ============================================================
INSERT OR IGNORE INTO events (id, name, category, emoji, target_date, is_lunar, recurrence, notify_days, metadata, enabled)
VALUES
  -- Ngày lễ DƯƠNG LỊCH cố định
  (1,  'Tết Dương lịch',                          'holiday', '🎆', '2026-01-01T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),
  (2,  'Lễ Tình nhân',                            'holiday', '💖', '2026-02-14T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),
  (3,  'Quốc tế Phụ nữ',                         'holiday', '💐', '2026-03-08T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),
  (4,  'Thành lập Đoàn TNCS Hồ Chí Minh',        'holiday', '🇻🇳', '2026-03-26T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),
  (5,  'Giải phóng miền Nam',                     'holiday', '🇻🇳', '2026-04-30T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),
  (6,  'Quốc tế Lao động',                        'holiday', '🛠', '2026-05-01T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),
  (7,  'Sinh nhật Chủ tịch Hồ Chí Minh',          'holiday', '⭐', '2026-05-19T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),
  (8,  'Quốc tế Thiếu nhi',                       'holiday', '🎈', '2026-06-01T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),
  (9,  'Ngày Báo chí Cách mạng Việt Nam',         'holiday', '📰', '2026-06-21T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),
  (10, 'Ngày Thương binh - Liệt sĩ',             'holiday', '🕯', '2026-07-27T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),
  (11, 'Quốc khánh',                              'holiday', '🇻🇳', '2026-09-02T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),
  (12, 'Ngày Phụ nữ Việt Nam',                    'holiday', '🌸', '2026-10-20T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),
  (13, 'Ngày Nhà giáo Việt Nam',                  'holiday', '👨‍🏫', '2026-11-20T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),
  (14, 'Thành lập Quân đội Nhân dân Việt Nam',    'holiday', '🎖', '2026-12-22T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),
  (15, 'Lễ Giáng sinh',                           'holiday', '🎄', '2026-12-25T00:00:00', 0, 'yearly', '7,3,1,0', '{}', 1),

  -- Ngày lễ ÂM LỊCH → đã quy đổi sang DƯƠNG LỊCH 2026
  -- metadata chứa gốc âm lịch để recalculate hằng năm
  (16, 'Tết Nguyên Tiêu (Rằm tháng Giêng)',      'holiday', '🏮', '2026-03-03T00:00:00', 1, 'yearly', '7,3,1,0', '{"lunar_day":15,"lunar_month":1}', 1),
  (17, 'Giỗ Tổ Hùng Vương',                      'holiday', '👑', '2026-04-26T00:00:00', 1, 'yearly', '7,3,1,0', '{"lunar_day":10,"lunar_month":3}', 1),
  (18, 'Tết Đoan Ngọ',                            'holiday', '🌾', '2026-06-19T00:00:00', 1, 'yearly', '7,3,1,0', '{"lunar_day":5,"lunar_month":5}', 1),
  (19, 'Lễ Vu Lan',                               'holiday', '🪷', '2026-08-27T00:00:00', 1, 'yearly', '7,3,1,0', '{"lunar_day":15,"lunar_month":7}', 1),
  (20, 'Tết Trung Thu',                           'holiday', '🥮', '2026-09-25T00:00:00', 1, 'yearly', '7,3,1,0', '{"lunar_day":15,"lunar_month":8}', 1),
  (21, 'Ông Công Ông Táo',                        'holiday', '🎏', '2027-01-30T00:00:00', 1, 'yearly', '7,3,1,0', '{"lunar_day":23,"lunar_month":12}', 1),

  -- Quota mẫu
  (22, 'AntiGravity - trinhquanglam2k4', 'quota', '🤖', '2026-10-15T17:00:00', 0, 'monthly', '7,3,1,0', '{"account":"trinhquanglam2k4"}', 1),
  (23, 'AntiGravity - nam085924',        'quota', '🤖', '2026-10-18T17:00:00', 0, 'monthly', '7,3,1,0', '{"account":"nam085924"}', 1);
