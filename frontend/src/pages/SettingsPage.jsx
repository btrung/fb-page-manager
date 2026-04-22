import React, { useEffect, useState, useCallback } from 'react';
import Navbar from '../components/Navbar';
import { pagesApi, chatApi } from '../utils/api';

const DAYS = [
  { key: 'mon', label: 'Thứ 2' },
  { key: 'tue', label: 'Thứ 3' },
  { key: 'wed', label: 'Thứ 4' },
  { key: 'thu', label: 'Thứ 5' },
  { key: 'fri', label: 'Thứ 6' },
  { key: 'sat', label: 'Thứ 7' },
  { key: 'sun', label: 'CN' },
];

const DEFAULT_HOURS = Object.fromEntries(
  DAYS.map(({ key }) => [key, { enabled: true, start: '08:00', end: '22:00' }])
);

// ── Active Hours Editor ──────────────────────────────────────────────────────

const ActiveHoursEditor = ({ activeHours, onChange }) => {
  const hours = activeHours ?? DEFAULT_HOURS;

  const toggleDay = (key) => {
    onChange({ ...hours, [key]: { ...hours[key], enabled: !hours[key]?.enabled } });
  };

  const setTime = (key, field, val) => {
    onChange({ ...hours, [key]: { ...hours[key], [field]: val } });
  };

  return (
    <div className="mt-3 space-y-1.5">
      {DAYS.map(({ key, label }) => {
        const day = hours[key] ?? { enabled: true, start: '08:00', end: '22:00' };
        return (
          <div key={key} className="flex items-center gap-2 text-xs">
            <button
              onClick={() => toggleDay(key)}
              className={`w-12 text-center py-0.5 rounded-md font-medium transition-colors border ${
                day.enabled
                  ? 'bg-facebook-light text-facebook-blue border-blue-200'
                  : 'bg-gray-50 text-gray-400 border-gray-200'
              }`}
            >
              {label}
            </button>
            {day.enabled ? (
              <>
                <input
                  type="time"
                  value={day.start}
                  onChange={(e) => setTime(key, 'start', e.target.value)}
                  className="border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-facebook-blue"
                />
                <span className="text-gray-400">–</span>
                <input
                  type="time"
                  value={day.end}
                  onChange={(e) => setTime(key, 'end', e.target.value)}
                  className="border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-facebook-blue"
                />
              </>
            ) : (
              <span className="text-gray-400 italic">Tắt cả ngày</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Page Setting Card ────────────────────────────────────────────────────────

const PageCard = ({ page, setting, onSave }) => {
  const [aiEnabled, setAiEnabled]     = useState(setting?.aiEnabled ?? false);
  const [activeHours, setActiveHours] = useState(setting?.activeHours ?? null);
  const [showHours, setShowHours]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);

  // Sync when setting prop updates from parent fetch
  useEffect(() => {
    setAiEnabled(setting?.aiEnabled ?? false);
    setActiveHours(setting?.activeHours ?? null);
  }, [setting]);

  const handleToggleAi = async () => {
    const next = !aiEnabled;
    setAiEnabled(next);
    setSaving(true);
    try {
      await chatApi.updateSettings(page.id, { aiEnabled: next, activeHours });
      flashSaved();
    } catch {
      setAiEnabled(!next); // rollback
    } finally {
      setSaving(false);
    }
  };

  const handleSaveHours = async () => {
    setSaving(true);
    try {
      await chatApi.updateSettings(page.id, { aiEnabled, activeHours });
      setShowHours(false);
      flashSaved();
    } finally {
      setSaving(false);
    }
  };

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const hoursLabel = () => {
    if (!activeHours) return 'Cả ngày (24/7)';
    const enabledDays = DAYS.filter(({ key }) => activeHours[key]?.enabled);
    if (enabledDays.length === 0) return 'Tắt tất cả ngày';
    if (enabledDays.length === 7) {
      const first = activeHours[DAYS[0].key];
      return `${first?.start ?? '08:00'} – ${first?.end ?? '22:00'} hàng ngày`;
    }
    return `${enabledDays.length}/7 ngày`;
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Page header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        {page.picture?.data?.url ? (
          <img src={page.picture.data.url} alt={page.name} className="w-10 h-10 rounded-full" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-facebook-light flex items-center justify-center text-facebook-blue font-bold">
            {page.name?.[0] ?? 'P'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-800 truncate">{page.name}</div>
          <div className="text-xs text-gray-400">{page.category}</div>
        </div>
        {saved && <span className="text-xs text-green-600 font-medium">✅ Đã lưu</span>}
      </div>

      {/* AI toggle */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-gray-700">AI Chat tự động</div>
          <div className="text-xs text-gray-400 mt-0.5">
            AI sẽ trả lời tin nhắn từ fanpage này
          </div>
        </div>
        <button
          onClick={handleToggleAi}
          disabled={saving}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
            aiEnabled ? 'bg-facebook-blue' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              aiEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Active hours */}
      <div className="px-5 pb-4">
        <button
          onClick={() => setShowHours((v) => !v)}
          className="flex items-center justify-between w-full text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span>🕐</span>
            <span>Khung giờ hoạt động:</span>
            <span className="font-medium text-gray-800">{hoursLabel()}</span>
          </div>
          <span className="text-gray-400 text-xs">{showHours ? '▲' : '▼'}</span>
        </button>

        {showHours && (
          <div className="mt-3 border border-gray-100 rounded-xl p-3 bg-gray-50">
            <div className="text-xs text-gray-500 mb-2">
              Để trống = AI hoạt động 24/7. Timezone: Asia/Ho_Chi_Minh
            </div>
            <ActiveHoursEditor
              activeHours={activeHours ?? DEFAULT_HOURS}
              onChange={setActiveHours}
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleSaveHours}
                disabled={saving}
                className="bg-facebook-blue text-white text-xs px-4 py-1.5 rounded-lg font-medium hover:bg-facebook-dark disabled:opacity-40 transition-colors"
              >
                Lưu khung giờ
              </button>
              <button
                onClick={() => { setActiveHours(null); }}
                className="bg-gray-100 text-gray-600 text-xs px-4 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Reset 24/7
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── SettingsPage ─────────────────────────────────────────────────────────────

const SettingsPage = () => {
  const [pages, setPages]       = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      const [pagesRes, settingsRes] = await Promise.all([
        pagesApi.getPages(),
        chatApi.getSettings(),
      ]);
      setPages(pagesRes.data.pages ?? []);

      const settingsMap = {};
      (settingsRes.data.settings ?? []).forEach((s) => {
        settingsMap[s.pageId] = s;
      });
      setSettings(settingsMap);
    } catch (err) {
      setError(err.response?.data?.error || 'Không thể tải cài đặt');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">⚙️ Cài đặt AI Chat</h1>
          <p className="text-gray-500 text-sm mt-1">
            Bật/tắt AI và cấu hình khung giờ hoạt động cho từng fanpage
          </p>
        </div>

        {loading && (
          <div className="text-center py-16 text-gray-400 text-sm">Đang tải...</div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && pages.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">📄</div>
            <div>Chưa có fanpage nào. Hãy đăng nhập lại để tải danh sách.</div>
          </div>
        )}

        <div className="space-y-4">
          {pages.map((page) => (
            <PageCard
              key={page.id}
              page={page}
              setting={settings[page.id] ?? null}
              onSave={fetchAll}
            />
          ))}
        </div>
      </main>
    </div>
  );
};

export default SettingsPage;
