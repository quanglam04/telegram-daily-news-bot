/**
 * Daily Bot CMS — Frontend Logic
 * Clean, modern SaaS application logic
 */

const API_BASE = "/api";

// ===== State =====
let events = [];
let currentFilter = "all";
let editingId = null;

// ===== DOM Elements =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const tbody = $("#events-tbody");
const emptyState = $("#empty-state");
const modalOverlay = $("#modal-overlay");
const previewOverlay = $("#preview-overlay");
const eventForm = $("#event-form");

// ===== Initialize =====
document.addEventListener("DOMContentLoaded", () => {
  loadEvents();
  bindEventListeners();
});

// ===== Event Listeners =====
function bindEventListeners() {
  $("#btn-add").addEventListener("click", () => openModal());
  $("#btn-add-empty")?.addEventListener("click", () => openModal());

  $("#modal-close").addEventListener("click", closeModal);
  $("#btn-cancel").addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  eventForm.addEventListener("submit", handleFormSubmit);

  $$(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentFilter = btn.dataset.filter;
      $$(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderTable();
    });
  });

  $("#btn-recalc")?.addEventListener("click", handleRecalculateYearly);
  $("#btn-preview").addEventListener("click", openPreview);
  $("#btn-send").addEventListener("click", sendBulletin);
  $("#preview-close").addEventListener("click", closePreview);
  $("#preview-dismiss").addEventListener("click", closePreview);
  $("#preview-send").addEventListener("click", () => {
    closePreview();
    sendBulletin();
  });
  previewOverlay.addEventListener("click", (e) => {
    if (e.target === previewOverlay) closePreview();
  });

  $("#event-is-lunar")?.addEventListener("change", (e) => {
    updateDateHint(e.target.checked);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closePreview();
    }
  });
}

// ===== API Helper =====
async function apiCall(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
  return data;
}

async function loadEvents() {
  try {
    const filter = currentFilter !== "all" ? `?category=${currentFilter}` : "";
    events = await apiCall(`/events${filter}`);
    renderTable();
    updateStats();
  } catch (err) {
    console.error("Failed to load events:", err);
    showToast("Không thể tải danh sách sự kiện", "error");
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted)">Lỗi kết nối: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// ===== Render Table =====
function renderTable() {
  const filtered =
    currentFilter === "all"
      ? events
      : events.filter((e) => e.category === currentFilter);

  if (filtered.length === 0) {
    tbody.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";

  tbody.innerHTML = filtered
    .map((ev) => {
      const catClass = `cat-${ev.category || "general"}`;
      const catLabel = getCategoryLabel(ev.category);
      const dateStr = formatTargetDate(ev.target_date);

      let lunarNote = "";
      if (ev.is_lunar) {
        try {
          const meta = typeof ev.metadata === "string" ? JSON.parse(ev.metadata || "{}") : (ev.metadata || {});
          if (meta.lunar_day && meta.lunar_month) {
            const ld = String(meta.lunar_day).padStart(2, "0");
            const lm = String(meta.lunar_month).padStart(2, "0");
            lunarNote = `<span class="lunar-tag">Âm lịch (${ld}/${lm})</span>`;
          } else {
            lunarNote = `<span class="lunar-tag">Lịch âm</span>`;
          }
        } catch {
          lunarNote = `<span class="lunar-tag">Lịch âm</span>`;
        }
      }

      const countdownHtml = renderCountdown(ev.days_remaining);
      const isPast = ev.days_remaining !== null && ev.days_remaining < 0;
      const statusClass = isPast ? "row-past" : "row-active";
      const recLabel = getRecurrenceLabel(ev.recurrence);
      const isEnabled = Number(ev.enabled) === 1;
      const rowClass = [statusClass, isEnabled ? "" : "row-disabled"].filter(Boolean).join(" ");
      const icon = ev.emoji ? `<span class="event-icon">${escapeHtml(ev.emoji)}</span>` : "";

      return `
        <tr class="${rowClass}" data-id="${ev.id}">
          <td class="col-name">
            <div class="name-cell">
              ${icon}
              <span class="event-name">${escapeHtml(ev.name)}</span>
            </div>
          </td>
          <td class="col-category">
            <span class="category-badge ${catClass}">${catLabel}</span>
          </td>
          <td class="col-date">
            <div class="date-wrapper">
              <span class="event-date">${dateStr}</span>
              ${lunarNote}
            </div>
          </td>
          <td class="col-countdown">${countdownHtml}</td>
          <td class="col-recurrence">
            <span class="recurrence-text">${recLabel}</span>
          </td>
          <td class="col-enabled">
            <label class="toggle">
              <input type="checkbox" ${isEnabled ? "checked" : ""} onchange="toggleEnabled(${ev.id}, this.checked)" />
              <span class="toggle-slider"></span>
            </label>
          </td>
          <td class="col-actions">
            <div class="action-btns">
              <button class="btn-action" onclick="editEvent(${ev.id})">Sửa</button>
              <button class="btn-action btn-action-danger" onclick="deleteEvent(${ev.id})">Xóa</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderCountdown(daysRemaining) {
  if (daysRemaining === null || daysRemaining === undefined) {
    return `<span class="badge badge-muted">—</span>`;
  }
  if (daysRemaining < 0) {
    return `<span class="badge badge-expired">Đã trôi qua</span>`;
  }
  if (daysRemaining === 0) {
    return `<span class="badge badge-active badge-today">Hôm nay</span>`;
  }
  return `<span class="badge badge-active">Còn ${daysRemaining} ngày</span>`;
}

function updateStats() {
  const total = events.length;
  const active = events.filter((e) => Number(e.enabled) === 1).length;
  const due = events.filter((e) => e.should_notify_today).length;
  const upcoming = events.filter(
    (e) => e.days_remaining !== null && e.days_remaining >= 0 && e.days_remaining <= 7
  ).length;

  $("#stat-total").textContent = total;
  $("#stat-active").textContent = active;
  $("#stat-due").textContent = due;
  $("#stat-upcoming").textContent = upcoming;
}

// ===== Modal =====
function updateDateHint(isLunar) {
  const hint = $("#date-hint");
  if (!hint) return;
  if (isLunar) {
    hint.innerHTML = "Đang chọn lịch âm: Nhập ngày & tháng âm lịch tương ứng. Hệ thống sẽ tự động quy đổi sang ngày dương để lưu trữ.";
    hint.classList.add("hint-lunar");
  } else {
    hint.textContent = "Ngày Dương lịch (hệ thống lưu trữ và tính countdown theo ngày dương)";
    hint.classList.remove("hint-lunar");
  }
}

function openModal(event = null) {
  editingId = event ? event.id : null;
  $("#modal-title").textContent = event ? "Chỉnh sửa sự kiện" : "Thêm sự kiện";
  $("#btn-save .btn-loading-text").textContent = event ? "Cập nhật" : "Lưu sự kiện";

  if (event) {
    $("#event-id").value = event.id;
    $("#event-name").value = event.name || "";
    $("#event-emoji").value = event.emoji || "📌";
    $("#event-category").value = event.category || "general";

    let meta = {};
    try {
      meta = typeof event.metadata === "string" ? JSON.parse(event.metadata || "{}") : (event.metadata || {});
    } catch {}

    const isLunar = !!event.is_lunar;
    $("#event-is-lunar").checked = isLunar;
    updateDateHint(isLunar);

    if (isLunar && meta.lunar_day && meta.lunar_month) {
      const year = new Date().getFullYear();
      const mm = String(meta.lunar_month).padStart(2, "0");
      const dd = String(meta.lunar_day).padStart(2, "0");
      $("#event-target-date").value = `${year}-${mm}-${dd}T00:00`;
    } else {
      $("#event-target-date").value = (event.target_date || "").replace(" ", "T").slice(0, 16);
    }

    $("#event-recurrence").value = event.recurrence || "";
    $("#event-notify-days").value = event.notify_days || "7,3,1,0";
    $("#event-enabled").checked = Number(event.enabled) === 1;
    $("#event-metadata").value = event.metadata || "{}";
  } else {
    eventForm.reset();
    $("#event-emoji").value = "📌";
    $("#event-notify-days").value = "7,3,1,0";
    $("#event-enabled").checked = true;
    $("#event-metadata").value = "{}";
    $("#event-is-lunar").checked = false;
    updateDateHint(false);
  }

  modalOverlay.classList.add("open");
  setTimeout(() => $("#event-name").focus(), 100);
}

function closeModal() {
  modalOverlay.classList.remove("open");
  editingId = null;
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const btn = $("#btn-save");
  btn.disabled = true;

  const data = {
    name: $("#event-name").value.trim(),
    emoji: $("#event-emoji").value.trim() || "📌",
    category: $("#event-category").value,
    target_date: $("#event-target-date").value,
    is_lunar: $("#event-is-lunar").checked ? 1 : 0,
    recurrence: $("#event-recurrence").value || null,
    notify_days: $("#event-notify-days").value.trim() || "7,3,1,0",
    enabled: $("#event-enabled").checked ? 1 : 0,
    metadata: $("#event-metadata").value.trim() || "{}",
  };

  try {
    if (data.metadata && data.metadata !== "{}") {
      JSON.parse(data.metadata);
    }
  } catch {
    showToast("Metadata JSON không hợp lệ", "error");
    btn.disabled = false;
    return;
  }

  try {
    if (editingId) {
      await apiCall(`/events/${editingId}`, "PUT", data);
      showToast("Đã cập nhật sự kiện", "success");
    } else {
      await apiCall("/events", "POST", data);
      showToast("Đã thêm sự kiện mới", "success");
    }
    closeModal();
    await loadEvents();
  } catch (err) {
    showToast(`Lỗi: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

// ===== Actions =====
window.editEvent = async function (id) {
  const ev = events.find((e) => e.id === id);
  if (ev) openModal(ev);
};

window.deleteEvent = async function (id) {
  const ev = events.find((e) => e.id === id);
  if (!ev) return;
  if (!confirm(`Bạn có chắc chắn muốn xóa sự kiện "${ev.name}"?`)) return;

  try {
    await apiCall(`/events/${id}`, "DELETE");
    showToast("Đã xóa sự kiện", "success");
    await loadEvents();
  } catch (err) {
    showToast(`Lỗi xóa: ${err.message}`, "error");
  }
};

window.toggleEnabled = async function (id, checked) {
  try {
    await apiCall(`/events/${id}`, "PUT", { enabled: checked ? 1 : 0 });
    const ev = events.find((e) => e.id === id);
    if (ev) ev.enabled = checked ? 1 : 0;
    updateStats();
    renderTable();
  } catch (err) {
    showToast(`Lỗi cập nhật: ${err.message}`, "error");
    await loadEvents();
  }
};

// ===== Preview & Send =====
async function openPreview() {
  previewOverlay.classList.add("open");
  const content = $("#preview-content");
  content.innerHTML = '<div class="spinner"></div> <span>Đang tạo bản tin...</span>';

  try {
    const data = await apiCall("/bulletin/preview");
    if (data.ok && data.message) {
      content.innerHTML = data.message;
    } else {
      content.innerHTML = `<span style="color:var(--danger)">Lỗi: ${escapeHtml(data.error || "Không rõ")}</span>`;
    }
  } catch (err) {
    content.innerHTML = `<span style="color:var(--danger)">Lỗi: ${escapeHtml(err.message)}</span>`;
  }
}

function closePreview() {
  previewOverlay.classList.remove("open");
}

async function sendBulletin() {
  const btn = $("#btn-send");
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "Đang gửi...";

  try {
    const data = await apiCall("/trigger", "POST");
    if (data.ok) {
      showToast("Bản tin đã được gửi qua Telegram", "success");
    } else {
      showToast(`Gửi thất bại: ${data.error || "Không rõ"}`, "error");
    }
  } catch (err) {
    showToast(`Lỗi gửi: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ===== Recalculate Yearly Events =====
async function handleRecalculateYearly() {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  const choice = prompt(
    `Nhập năm muốn quy đổi lịch lặp lại (dương & âm):\n(Mặc định: ${nextYear})`,
    nextYear
  );
  if (!choice) return;

  const year = parseInt(choice, 10);
  if (isNaN(year) || year < 2000 || year > 2100) {
    showToast("Năm không hợp lệ", "error");
    return;
  }

  const btn = $("#btn-recalc");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Đang xử lý...";

  try {
    const res = await apiCall(`/events/recalculate?year=${year}`, "POST");
    if (res.ok) {
      showToast(`Đã đồng bộ ${res.updated} sự kiện sang năm ${year}`, "success");
      await loadEvents();
    } else {
      showToast(`Đồng bộ thất bại: ${res.error || "Không rõ"}`, "error");
    }
  } catch (err) {
    showToast(`Lỗi: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ===== Helpers =====
function getCategoryLabel(cat) {
  const labels = {
    quota: "Quota",
    holiday: "Ngày lễ",
    personal: "Cá nhân",
    deadline: "Deadline",
    general: "Chung",
  };
  return labels[cat] || cat || "Chung";
}

function getRecurrenceLabel(rec) {
  if (!rec || rec === "null" || rec === "none") return "Một lần";
  if (rec === "yearly") return "Hằng năm";
  if (rec === "monthly") return "Hằng tháng";
  return rec;
}

function formatTargetDate(dateStr) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return dateStr;
  }
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ===== Toast =====
function showToast(message, type = "info") {
  const container = $("#toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}
