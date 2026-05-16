export const INTENT_META = {
  'Dừng':          { color: 'bg-red-100 text-red-700 border-red-200',       dot: 'bg-red-500',     label: 'Dừng' },
  'Đang Chốt':     { color: 'bg-purple-100 text-purple-700 border-purple-200', dot: 'bg-purple-500', label: 'Đang Chốt' },
  'Muốn Mua':      { color: 'bg-green-100 text-green-700 border-green-200',  dot: 'bg-green-500',   label: 'Muốn Mua' },
  'Đang Tư Vấn':   { color: 'bg-blue-100 text-blue-700 border-blue-200',    dot: 'bg-blue-500',    label: 'Đang Tư Vấn' },
  'Đã Chốt':       { color: 'bg-indigo-100 text-indigo-700 border-indigo-200', dot: 'bg-indigo-500', label: 'Đã Chốt' },
  'Khách Đùa':     { color: 'bg-gray-100 text-gray-600 border-gray-200',    dot: 'bg-gray-400',    label: 'Khách Đùa' },
  'Không Nhu Cầu': { color: 'bg-orange-50 text-orange-600 border-orange-200', dot: 'bg-orange-400', label: 'Không Nhu Cầu' },
};

export const getIntentMeta = (intent) =>
  INTENT_META[intent] ?? { color: 'bg-gray-100 text-gray-500 border-gray-200', dot: 'bg-gray-300', label: intent ?? '?' };

export const ALL_INTENTS = Object.keys(INTENT_META);

export const formatTs = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export const formatTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  if (diffMin < 1) return 'vừa xong';
  if (diffMin < 60) return `${diffMin}p trước`;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
