const LOG_KEY = 'dsc_activity_log';

function getLogs() {
  return new Promise(r => chrome.storage.local.get([LOG_KEY], res => r(res[LOG_KEY] || [])));
}

function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function clipText(t, max = 200) {
  t = String(t || '');
  return t.length <= max ? t : t.slice(0, max) + `…(共 ${t.length} 字)`;
}

function renderText(e) {
  const m = e.meta || {};
  switch (e.event) {
    case 'panel_open':
      return `打开标签面板，当前共 ${m.labelCount} 个标签`;
    case 'label_add':
      return `新增标签【${m.id}】，标签标题：【${m.title}】，` +
             `来源对话：【${m.convTitle || '未命名对话'}】，标签原文：【${clipText(m.text)}】`;
    case 'label_edit':
      return `编辑标签【${m.id}】，将标签标题【${m.oldTitle}】改为【${m.newTitle}】`;
    case 'label_copy':
      return `复制标签【${m.id}】，标签标题：【${m.title}】，标签原文：【${m.text}】`;
    case 'label_delete':
      return `删除标签【${m.id}】，标签标题：【${m.title}】，标签原文：【${m.text}】`;
    case 'label_reorder':
      return `调整排序，将标签【${m.id}】【${m.title}】移动到` +
             `【${m.targetId}】【${m.targetTitle}】${m.position === 'before' ? '之前' : '之后'}`;
    case 'label_import': {
      if (m.added === 0) {
        return `尝试导入标签 ${m.total} 个，全部与现有标签重复，未新增`;
      }
      const items = (m.items || []).map(i => `【${i.title}】`).join('、');
      const skipPart = m.skipped > 0 ? `，跳过 ${m.skipped} 个重复` : '';
      return `导入标签 ${m.total} 个（新增 ${m.added} 个${skipPart}）。标签标题：${items}`;
    }
    case 'label_export':
      return `导出标签 ${m.count} 个`;
    default:
      return null;
  }
}

function renderLine(e) {
  const body = renderText(e);
  return body ? `${fmtTime(e.ts)} ${body}` : null;
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

(async () => {
  const logs = await getLogs();
  document.getElementById('count').textContent = `共 ${logs.length} 条`;
  const el = document.getElementById('logs');
  if (!logs.length) {
    el.innerHTML = '<span class="empty">暂无日志</span>';
  } else {
    el.textContent = [...logs].reverse().map(renderLine).filter(Boolean).join('\n');
  }

  const today = new Date().toISOString().slice(0, 10);

  document.getElementById('exportTxtBtn').addEventListener('click', () => {
    download(`标签捕手_日志_${today}.txt`,
      logs.map(renderLine).filter(Boolean).join('\n'), 'text/plain;charset=utf-8');
  });

  document.getElementById('exportJsonBtn').addEventListener('click', () => {
    download(`标签捕手_日志_${today}.json`,
      JSON.stringify(logs, null, 2), 'application/json');
  });

  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!confirm('确定清空全部日志吗？此操作不可恢复。')) return;
    await chrome.storage.local.remove([LOG_KEY]);
    location.reload();
  });
})();