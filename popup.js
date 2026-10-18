const STORAGE_KEY = 'dsc_labels';
let labels = [];
let editingId = null;
let dragId = null;

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
      return `<div class="item">
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
        <!-- 原文和复制按钮作为一个整体 -->
        <div class="original-wrapper" data-action="copy" data-id="${l.id}" title="点击复制原文">
          <span class="original-text">原文：${escapeHtml(l.text)}</span>
          <span class="copy-icon">
            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </span>
        </div>
        
        <!-- 右侧按钮 -->
        <button data-action="edit" data-id="${l.id}" class="action-btn" draggable="false">编辑</button>
        <button data-action="delete" data-id="${l.id}" class="action-btn del" draggable="false">删除</button>
      </div>
    </div>`;
  }).join('');

  // 绑定编辑框事件
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
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  
  if (action === 'edit') { editingId = id; render(); }
  else if (action === 'delete') await handleDelete(id);
  else if (action === 'copy') await copyText(id, e);
});

// ---------- 事件委托：拖拽排序 ----------
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

async function copyText(id, event) {
  if (event) event.stopPropagation();
  const label = labels.find(l => l.id === id);
  if (!label) return;
  try {
    await navigator.clipboard.writeText(label.text);
    showToast('✅ 已复制原文');
  } catch (err) {
    showToast('❌ 复制失败，请手动选中复制');
  }
}

async function reorderLabels(fromId, toId, insertBefore) {
  const sorted = [...labels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const fromIdx = sorted.findIndex(l => l.id === fromId);
  if (fromIdx === -1) return;
  const [moved] = sorted.splice(fromIdx, 1);
  let toIdx = sorted.findIndex(l => l.id === toId);
  if (toIdx === -1) { sorted.splice(fromIdx, 0, moved); return; }
  if (!insertBefore) toIdx += 1;
  sorted.splice(toIdx, 0, moved);
  sorted.forEach((l, i) => { l.order = i; });
  await setLabels(labels);
  render();
}

// ---------- 导出 / 导入 ----------
document.getElementById('exportBtn').addEventListener('click', () => {
  const data = { version: '1.0', exportTime: new Date().toISOString(), labels };
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
  const needInit = labels.some(l => typeof l.order !== 'number');
  if (needInit) {
    const byTime = [...labels].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    byTime.forEach((l, i) => { l.order = i; });
    await setLabels(labels);
  }
  render();
})();