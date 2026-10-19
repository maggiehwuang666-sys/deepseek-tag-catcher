(function () {
  'use strict';

  const STORAGE_KEY = 'dsc_labels';

  function genId() { return 'lbl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }
  function getConvTitle() {
    const t = document.title || '';
    return t.replace(/\s*[-–—]\s*DeepSeek.*$/i, '').trim() || '未命名对话';
  }
  function getNodeText(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let text = '', n;
    while ((n = walker.nextNode())) text += n.nodeValue;
    return text;
  }
  function normalizeText(t) {
    return String(t).replace(/[\s\u200b\u200c\u200d\uFEFF]+/g, '').replace(/[，。！？；：、（）【】《》「」『』""'']/g, '');
  }

  function findMessageNodes() {
    const candidates = new Set();
    document.querySelectorAll('.ds-message').forEach(el => candidates.add(el));
    document.querySelectorAll('.ds-markdown').forEach(el => candidates.add(el));
    const list = Array.from(candidates).filter(el => {
      const len = (el.innerText || '').trim().length;
      return len > 3 && len < 20000;
    });
    list.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });
    const result = [];
    for (const el of list) {
      if (result.some(r => r.contains(el))) continue;
      for (let i = result.length - 1; i >= 0; i--) { if (el.contains(result[i])) result.splice(i, 1); }
      result.push(el);
    }
    return result;
  }

  function findScrollContainer() {
    const sel = ['[class*="chat"]', '[class*="conversation"]', '[class*="message-list"]', 'main'];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (el && el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 200) return el;
    }
    let best = null, maxH = 0;
    document.querySelectorAll('div').forEach(el => {
      if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 300) {
        if (el.scrollHeight > maxH) { maxH = el.scrollHeight; best = el; }
      }
    });
    return best || document.scrollingElement || document.documentElement;
  }

  function findPaginators() {
    const result = [];
    document.querySelectorAll('*').forEach(el => {
      if (el.children.length > 0) return;
      const t = (el.innerText || '').trim().replace(/\s+/g, '');
      if (/^\d+\/\d+$/.test(t)) result.push(el);
    });
    return result;
  }

  function getLabels() { return new Promise(r => chrome.storage.local.get([STORAGE_KEY], res => r(res[STORAGE_KEY] || []))); }
  function setLabels(labels) { return new Promise(r => chrome.storage.local.set({ [STORAGE_KEY]: labels }, r)); }
  async function addLabel(label) {
    const labels = await getLabels();
    const dup = labels.find(l => l.url === label.url && l.text === label.text && l.msgFingerprint === label.msgFingerprint);
    if (dup) return false;
    const minOrder = labels.reduce((m, l) => Math.min(m, typeof l.order === 'number' ? l.order : 0), 0);
    label.order = minOrder - 1;
    labels.push(label);
    await setLabels(labels);
    return true;
  }

  // === 浮层 ===
  let tooltipHost = null, tooltipEl = null, pending = null;
  function ensureTooltip() {
    if (tooltipHost) return;
    tooltipHost = document.createElement('div');
    tooltipHost.id = 'dsc-tooltip-host';
    tooltipHost.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;display:none;';
    document.documentElement.appendChild(tooltipHost);
    const shadow = tooltipHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>.tip{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #d0d5dd;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,.12);padding:6px 12px;font-size:13px;color:#1c1c1e;cursor:pointer;pointer-events:auto;white-space:nowrap;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;transition:background .15s,color .15s,border-color .15s;user-select:none;}.tip:hover{background:#e7f0ff;color:#1a73e8;border-color:#1a73e8;}.tip.saved{background:#e7ffe7;border-color:#4caf50;color:#2e7d32;}</style><div class="tip"><span style="font-size:15px;">🔖</span> 添加标签</div>`;
    tooltipEl = shadow.querySelector('.tip');
    tooltipEl.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    tooltipEl.addEventListener('click', async (e) => { e.preventDefault(); e.stopPropagation(); await onAddClick(); });
  }
  function showTooltip(cx, cy) {
    ensureTooltip();
    tooltipEl.className = 'tip';
    tooltipEl.innerHTML = '<span style="font-size:15px;">🔖</span> 添加标签';
    let left = Math.max(10, Math.min(cx - 60, window.innerWidth - 140));
    let top = cy - 44;
    if (top < 10) top = cy + 16;
    tooltipHost.style.left = left + 'px'; tooltipHost.style.top = top + 'px'; tooltipHost.style.display = 'block';
  }
  function hideTooltip() { if (tooltipHost) tooltipHost.style.display = 'none'; pending = null; }

  document.addEventListener('mouseup', (e) => {
    if (tooltipHost && tooltipHost.contains(e.target)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return hideTooltip();
      const text = sel.toString().trim(); if (!text) return hideTooltip();
      const range = sel.getRangeAt(0); const container = range.commonAncestorContainer;
      const containerEl = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
      const nodes = findMessageNodes(); let hostNode = null;
      for (const n of nodes) if (n.contains(containerEl)) { hostNode = n; break; }
      if (!hostNode) return hideTooltip();
      pending = { text, hostNode };
      const rect = range.getBoundingClientRect();
      showTooltip(rect.left + rect.width / 2, rect.top);
    }, 10);
  });
  document.addEventListener('mousedown', (e) => {
    if (tooltipHost && tooltipHost.contains(e.target)) return;
    hideTooltip();
  });

  async function onAddClick() {
    if (!pending) return;
    const { text, hostNode } = pending;
    const nodeText = getNodeText(hostNode);
    const idx = nodeText.indexOf(text);
    const contextBefore = idx !== -1 ? nodeText.slice(Math.max(0, idx - 20), idx) : '';
    const contextAfter = idx !== -1 ? nodeText.slice(idx + text.length, idx + text.length + 20) : '';
    const msgFingerprint = nodeText.replace(/\s+/g, '').slice(0, 50);
    const label = { id: genId(), url: location.href, convTitle: getConvTitle(), text, displayText: text, contextBefore, contextAfter, msgFingerprint, createdAt: Date.now() };
    const ok = await addLabel(label);
   if (ok) {
  chrome.runtime.sendMessage({
    type: 'log_event',
    evt: {
      event: 'label_add',
      meta: {
        id: label.id,
        title: label.displayText,
        convTitle: label.convTitle,
        text: label.text,
      },
    },
  }, () => void chrome.runtime.lastError);
}

    tooltipEl.className = 'tip saved';
    tooltipEl.innerHTML = ok ? '<span style="font-size:15px;">✅</span> 已保存' : '<span style="font-size:15px;">ℹ️</span> 已存在';
    setTimeout(hideTooltip, 800);
  }

  // === 匹配与高亮 ===
  function tryMatchMessageCandidates(label) {
    const nodes = findMessageNodes(); if (!nodes.length) return [];
    const norm = (s) => normalizeText(s);
    const textNorm = norm(label.text); const fpNorm = norm(label.msgFingerprint || '');
    const before = norm(label.contextBefore || ''); const after = norm(label.contextAfter || '');
    const candidates = [];

    if (textNorm) { for (const node of nodes) { if (norm(node.innerText).includes(textNorm)) candidates.push({ node, strategy: 'textFull', score: 100 }); } }
    if (textNorm.length >= 8) {
      const head = textNorm.slice(0, 20);
      for (const node of nodes) { if (candidates.some(c => c.node === node)) continue; if (norm(node.innerText).includes(head)) candidates.push({ node, strategy: 'textHead', score: 80 }); }
    }
    if (fpNorm) { for (const node of nodes) { if (candidates.some(c => c.node === node)) continue; if (norm(node.innerText).includes(fpNorm)) candidates.push({ node, strategy: 'fingerprint', score: 40 }); } }
    candidates.sort((a, b) => b.score - a.score); return candidates;
  }

  function findTextPosition(node, text, before, after) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const textNodes = []; let fullText = '', n;
    while ((n = walker.nextNode())) { textNodes.push({ node: n, start: fullText.length, end: fullText.length + n.nodeValue.length }); fullText += n.nodeValue; }
    let idx = fullText.indexOf(text);
    if (idx !== -1) return { start: idx, end: idx + text.length, textNodes };
    
    function norm(s) { return String(s).replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D\u00AD]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[，。！？；：、（）【】《》「」『』""'']/g, '').replace(/[\s\u200b\u200c\u200d\uFEFF]+/g, ''); }
    const normMap = []; let normFull = '';
    for (let i = 0; i < fullText.length; i++) { const c = norm(fullText[i]); if (!c) continue; normMap.push(i); normFull += c; }
    const normText = norm(text);
    idx = normFull.indexOf(normText);
    if (idx !== -1) { const s = normMap[idx]; const e = normMap[idx + normText.length - 1] + 1; return { start: s, end: e, textNodes }; }
    return null;
  }

  function highlightAndScroll(node, posInfo) {
    const { start, end, textNodes } = posInfo;
    function locate(pos) { for (const tn of textNodes) { if (pos >= tn.start && pos < tn.end) return { node: tn.node, offset: pos - tn.start }; } return null; }
    const s = locate(start); const e = locate(end - 1);
    if (!s || !e) { node.scrollIntoView({ block: 'center' }); return true; }

    try {
      const range = document.createRange(); range.setStart(s.node, s.offset); range.setEnd(e.node, e.offset + 1);
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      
      const span = document.createElement('span');
      span.style.cssText = 'background:#ffe066;border-radius:2px;transition:background .5s;';
      try {
        range.surroundContents(span);
        setTimeout(() => { if (span.parentNode) { const p = span.parentNode; while (span.firstChild) p.insertBefore(span.firstChild, span); p.removeChild(span); p.normalize(); } }, 3000);
      } catch (err) {
        const rects = range.getClientRects(); const overlays = [];
        for (const rect of rects) { const overlay = document.createElement('div'); overlay.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:rgba(255,224,102,0.6);z-index:2147483647;pointer-events:none;border-radius:2px;transition:opacity .5s;`; document.body.appendChild(overlay); overlays.push(overlay); }
        setTimeout(() => { overlays.forEach(o => { o.style.opacity = '0'; setTimeout(() => o.remove(), 500); }); }, 3000);
      }
      return true;
    } catch (err) { node.scrollIntoView({ block: 'center' }); return true; }
  }

  // === 扫描与跳转 ===
  async function forceRerender() {
    return new Promise(resolve => {
      const scroller = findScrollContainer(); if (!scroller) { resolve(); return; }
      const orig = scroller.scrollTop; scroller.scrollTop = 0;
      setTimeout(() => { scroller.scrollTop = scroller.scrollHeight; setTimeout(() => { scroller.scrollTop = orig; setTimeout(resolve, 600); }, 500); }, 500);
    });
  }

  async function switchToBranchWith(label) {
    const norm = (s) => normalizeText(s); const target = norm(label.text);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (let round = 0; round < 10; round++) {
      const paginators = findPaginators(); if (!paginators.length) return false;
      let clicked = false;
      for (const pag of paginators) {
        let container = pag.parentElement;
        for (let i = 0; i < 3 && container; i++) { if (container.querySelectorAll('.ds-button').length >= 2) break; container = container.parentElement; }
        if (!container) continue;
        const pagRect = pag.getBoundingClientRect(); if (pagRect.width === 0) continue;
        const allButtons = Array.from(container.querySelectorAll('.ds-button')).filter(b => b.getBoundingClientRect().width > 5);
        let leftBtn = null, minDist = Infinity;
        for (const b of allButtons) { const r = b.getBoundingClientRect(); if (r.right <= pagRect.left + 10) { const dist = pagRect.left - r.right; if (dist < minDist) { minDist = dist; leftBtn = b; } } }
        if (!leftBtn) continue;
        leftBtn.click(); clicked = true; await sleep(500);
        const nodes = findMessageNodes();
        for (const n of nodes) { if (norm(n.innerText).includes(target)) return true; }
        break;
      }
      if (!clicked) return false;
    }
    return false;
  }

  async function fastScanAndJump(label) {
    const scroller = findScrollContainer(); if (!scroller) return false;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const origTop = scroller.scrollTop; scroller.scrollTop = 0; await sleep(150);
    let current = 0; let found = false;
    const tip = document.createElement('div');
    tip.textContent = '⚡ 快速扫描定位中…';
    tip.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.82);color:#fff;padding:8px 16px;border-radius:8px;z-index:2147483647;font-size:13px;';
    document.body.appendChild(tip);
    try {
      while (current < scroller.scrollHeight) {
        if (tryMatchMessageCandidates(label).length > 0) { found = true; break; }
        if (findPaginators().length > 0) { if (await switchToBranchWith(label)) { found = true; break; } }
        current += 1000; scroller.scrollTop = current; await sleep(80);
      }
      if (!found && tryMatchMessageCandidates(label).length > 0) found = true;
      if (!found) scroller.scrollTop = origTop;
      return found;
    } finally { if (tip.parentNode) tip.parentNode.removeChild(tip); }
  }

  async function jumpToLabelWithLog(label) {
    let candidates = tryMatchMessageCandidates(label);
    if (candidates.length === 0) { await forceRerender(); candidates = tryMatchMessageCandidates(label); }
    if (candidates.length === 0) { const switched = await switchToBranchWith(label); if (switched) candidates = tryMatchMessageCandidates(label); }
    if (candidates.length === 0) { const found = await fastScanAndJump(label); if (found) candidates = tryMatchMessageCandidates(label); }

    if (candidates.length === 0) return { ok: false, reason: '未找到' };
    for (const cand of candidates) {
      const pos = findTextPosition(cand.node, label.text, label.contextBefore, label.contextAfter);
      if (pos) { highlightAndScroll(cand.node, pos); return { ok: true }; }
    }
    candidates[0].node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'jump' && msg.label) {
      jumpToLabelWithLog(msg.label).then(res => sendResponse(res)).catch(err => sendResponse({ ok: false, reason: err.message }));
      return true;
    } else if (msg.type === 'ping') {
      sendResponse({ ok: true, msgCount: findMessageNodes().length, url: location.href });
    }
    return true;
  });
  console.log('✅ DeepSeek 标签捕手 (Github Release Version) 已注入');
})();