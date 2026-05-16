import React, { useState, useEffect } from 'react';

const LiveSettingsModal = ({ isOpen, onClose, settings, onSave }) => {
  const [aiEnabled, setAiEnabled] = useState(settings?.aiEnabled ?? false);
  const [ctaText, setCtaText]     = useState(settings?.ctaText ?? '{tên} nhắn vào page để em tư vấn ngay nhé! 👉 {link}');
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    setAiEnabled(settings?.aiEnabled ?? false);
    setCtaText(settings?.ctaText ?? '{tên} nhắn vào page để em tư vấn ngay nhé! 👉 {link}');
  }, [settings]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    await onSave({ aiEnabled, ctaText });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">⚙️ Cài đặt Livestream AI</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* Toggle */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-gray-700">AI Monitor comments</span>
          <button
            onClick={() => setAiEnabled(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${aiEnabled ? 'bg-facebook-blue' : 'bg-gray-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${aiEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* CTA textarea */}
        <div className="mb-1">
          <label className="text-xs font-medium text-gray-600 block mb-1">Câu reply mẫu</label>
          <textarea
            value={ctaText}
            onChange={e => setCtaText(e.target.value)}
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-facebook-blue resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">* {'{tên}'} = tên khách &nbsp; {'{link}'} = m.me link</p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full mt-3 bg-facebook-blue text-white text-sm py-2 rounded-xl font-medium hover:bg-facebook-dark disabled:opacity-40 transition-colors"
        >
          {saving ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>
    </div>
  );
};

export default LiveSettingsModal;
