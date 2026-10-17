const STORAGE_KEY = 'dsc_labels';
let labels = [];
let editingId = null;

const listEl = document.getElementById('list');

// ---------- 存储 ----------
function getLabels() {
  return new Promise(r => chrome.storage.local.get([STORAGE_KEY], res => r(res[STORAGE_KEY] || [])));
}
function setLabels(l) {
  return new Promise(r => chrome.storage.local.set({ [STORAGE_KEY]: l }, r));
}

// ---------- 工具 ----------
function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function showToast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, ms);
}
function normUrl(u) {
  try { const x = new URL(u); return x.origin + x.pathname; } catch { return u || ''; }
}

// ---------- 渲染 ----------
function render() {
  document.getElementById('count').textContent = labels.length;
  if (labels.length === 0) {
    listEl.innerHTML = '<div class="empty">还没有标签<br>在 DeepSeek 页面划词添加吧</div>';
    return;
  }
  const sorted = [...labels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  listEl.innerHTML = sorted.map(l => {
    const display = l.displayText || l.text;
    if (editingId === l.id) {
      return `<div class="item" draggable="true" data-id="${l.id}">
        <input class="edit-input" data-id="${l.id}" value="${escapeHtml(display)}">
      </div>`;
    }
    return `<div class="item" draggable="true" data-id="${l.id}">
      <div class="text">${escapeHtml(display)}</div>
      <div class="meta">
        <span class="conv" title="${escapeHtml(l.convTitle || '')}">📁 ${escapeHtml(l.convTitle || '未命名')}</span>
        <span>${fmtTime(l.createdAt)}</span>
      </div>
      <div class="tools">
        <button data-action="jump" data-id="${l.id}">跳转</button>
        <button data-action="edit" data-id="${l.id}">编辑</button>
        <button class="del" data-action="delete" data-id="${l.id}">删除</button>
      </div>
    </div>`;
  }).join('');

  // 编辑态：绑事件 + 自动聚焦
  if (editingId) {
    const input = listEl.querySelector(`.edit-input[data-id="${editingId}"]`);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveEdit(input.dataset.id); }
        else if (e.key === 'Escape') { e.preventDefault(); editingId = null; render(); }
      });
      input.addEventListener('blur', () => saveEdit(input.dataset.id));
      setTimeout(() => { input.focus(); input.select(); }, 0);
    }
  }
}

// ---------- 事件委托：列表点击 ----------
listEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (action === 'jump') await handleJump(id);
  else if (action === 'edit') { editingId = id; render(); }
  else if (action === 'delete') await handleDelete(id);
});

// ---------- 拖拽排序 ----------
let dragId = null;

listEl.addEventListener('dragstart', (e) => {
  const item = e.target.closest('.item');
  if (!item || !item.draggable) return;
  dragId = item.dataset.id;
  item.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
});

listEl.addEventListener('dragover', (e) => {
  if (!dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  listEl.querySelectorAll('.item').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });

  const target = e.target.closest('.item');
  if (!target || target.dataset.id === dragId) return;

  const rect = target.getBoundingClientRect();
  const isTop = e.clientY < rect.top + rect.height / 2;
  target.classList.add(isTop ? 'drag-over-top' : 'drag-over-bottom');
});

listEl.addEventListener('drop', async (e) => {
  if (!dragId) return;
  e.preventDefault();

  const target = e.target.closest('.item');
  const draggedId = dragId;
  dragId = null;

  listEl.querySelectorAll('.item').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom', 'dragging');
  });

  if (!target || target.dataset.id === draggedId) return;

  const rect = target.getBoundingClientRect();
  const isTop = e.clientY < rect.top + rect.height / 2;
  await reorderLabels(draggedId, target.dataset.id, isTop);
});

listEl.addEventListener('dragend', () => {
  listEl.querySelectorAll('.item').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom', 'dragging');
  });
  dragId = null;
});

async function reorderLabels(fromId, toId, insertBefore) {
  const sorted = [...labels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const fromIdx = sorted.findIndex(l => l.id === fromId);
  if (fromIdx === -1) return;
  const [moved] = sorted.splice(fromIdx, 1);
  let toIdx = sorted.findIndex(l => l.id === toId);
  if (toIdx === -1) { sorted.splice(fromIdx, 0, moved); return; }
  if (!insertBefore) toIdx += 1;
  sorted.splice(toIdx, 0, moved);
  // sorted 里的对象和 labels 里是同一批引用，直接改 order
  sorted.forEach((l, i) => { l.order = i; });
  await setLabels(labels);
  render();
}

// ---------- 行为 ----------
async function saveEdit(id) {
  if (editingId !== id) return;
  const input = listEl.querySelector(`.edit-input[data-id="${id}"]`);
  if (!input) { editingId = null; return; }
  const v = input.value.trim();
  const label = labels.find(l => l.id === id);
  if (label && v && v !== label.displayText) {
    label.displayText = v;
    await setLabels(labels);
  }
  editingId = null;
  render();
}

async function handleDelete(id) {
  if (!confirm('确定删除这个标签吗？')) return;
  labels = labels.filter(l => l.id !== id);
  await setLabels(labels);
  render();
}

async function handleJump(id) {
  const label = labels.find(l => l.id === id);
  if (!label) return;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const current = tabs[0];
  const onDeepSeek = current && current.url && /deepseek\.com/.test(current.url);

  if (!onDeepSeek) {
    await chrome.tabs.create({ url: label.url });
    showToast('已打开对话页面，页面加载完再点一次"跳转"');
    return;
  }

  // 先 ping 一下，确认 content script 已注入
  let pingRes = null;
  try {
    pingRes = await chrome.tabs.sendMessage(current.id, { type: 'ping' });
  } catch (err) {
    showToast('无法连接页面脚本，请刷新 DeepSeek 页面后重试', 4000);
    return;
  }

  console.log('[Popup] ping 结果:', pingRes);

  if (!pingRes || pingRes.msgCount === 0) {
    showToast('当前页面未识别到任何消息，可能结构变化或正在加载', 4000);
    return;
  }

  // 发跳转指令
  try {
    const res = await chrome.tabs.sendMessage(current.id, { type: 'jump', label });
    console.log('[Popup] jump 结果:', res);

    if (res && res.ok) { window.close(); return; }

    // 找不到内容 → 可能不在同一对话
    if (normUrl(current.url) !== normUrl(label.url)) {
      await chrome.tabs.update(current.id, { url: label.url });
      showToast('已切换到对应对话，页面加载完再点一次"跳转"', 4000);
      return;
    }

    showToast((res && res.reason) || '定位失败', 8000);
  } catch (err) {
    console.error('[Popup] 通信错误:', err);
    showToast('通信失败，请刷新页面后重试', 4000);
  }
}

// ---------- 导出 / 导入 ----------
document.getElementById('exportBtn').addEventListener('click', () => {
  const data = {
    version: '1.0',
    exportTime: new Date().toISOString(),
    labels
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `DeepSeek标签备份_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.labels || !Array.isArray(data.labels)) throw new Error('格式错误');
      const existing = new Set(labels.map(l => l.id));
      let added = 0;
      // 新导入的标签排在最前：从当前最小 order - 1 开始递减
      let minOrder = labels.reduce((m, l) => Math.min(m, typeof l.order === 'number' ? l.order : 0), 0);
      for (const l of data.labels) {
        if (!existing.has(l.id)) {
          labels.push({ ...l, order: --minOrder });
          added++;
        }
      }

      await setLabels(labels);
      render();
      showToast(`导入成功，新增 ${added} 个标签`);
    } catch (err) {
      showToast('导入失败：' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ---------- 启动 ----------
(async () => {
  labels = await getLabels();
  // 迁移：如果标签没有 order 字段，按 createdAt 升序初始化（老标签保留原添加顺序）
  const needInit = labels.some(l => typeof l.order !== 'number');
  if (needInit) {
    const byTime = [...labels].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    byTime.forEach((l, i) => { l.order = i; });
    await setLabels(labels);
    console.log('已初始化', labels.length, '个标签的 order 字段');
  }
  render();
})();