(function () {
  'use strict';

  const STORAGE_KEY = 'dsc_labels';

  // ============ 工具 ============
  function genId() {
    return 'lbl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }
  function getConvTitle() {
    // DeepSeek 页面标题一般在 <title>，形如 "对话标题 - DeepSeek"
    const t = document.title || '';
    return t.replace(/\s*[-–—]\s*DeepSeek.*$/i, '').trim() || '未命名对话';
  }
  function getNodeText(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let text = '', n;
    while ((n = walker.nextNode())) text += n.nodeValue;
    return text;
  }

  // ============ 消息节点识别 ============
  // 归一化：去掉空白、零宽字符、中文标点
  function normalizeText(t) {
    return String(t)
      .replace(/[\s\u200b\u200c\u200d\uFEFF]+/g, '')
      .replace(/[，。！？；：、（）【】《》「」『』""'']/g, '');
  }

  function findMessageNodes() {
    const candidates = new Set();

    // 主抓：.ds-message（每条消息最外层容器）
    document.querySelectorAll('.ds-message').forEach(el => candidates.add(el));
    // 兜底：.ds-markdown（结构变化时）
    document.querySelectorAll('.ds-markdown').forEach(el => candidates.add(el));

    const list = Array.from(candidates).filter(el => {
      const len = (el.innerText || '').trim().length;
      return len > 3 && len < 20000;
    });

    // DOM 顺序排序
    list.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    // 去重：保留最外层
    const result = [];
    for (const el of list) {
      if (result.some(r => r.contains(el))) continue;
      for (let i = result.length - 1; i >= 0; i--) {
        if (el.contains(result[i])) result.splice(i, 1);
      }
      result.push(el);
    }

    return result;
  }


  // 极速扫描：大步长、极短延迟，用最快速度把对话翻一遍
  async function fastScanAndJump(label) {
    const scroller = findScrollContainer();
    if (!scroller) return false;
    
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const origTop = scroller.scrollTop;
    const step = 1000; // 步长 1000px
    
    // 从顶部开始
    scroller.scrollTop = 0;
    await sleep(150);

    let current = 0;
    let found = false;

    // 显示提示
    const tip = document.createElement('div');
    tip.textContent = '⚡ 快速扫描定位中…';
    tip.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);' +
      'background:rgba(0,0,0,.82);color:#fff;padding:8px 16px;border-radius:8px;' +
      'z-index:2147483647;font-size:13px;font-family:-apple-system,"PingFang SC",sans-serif;';
    document.body.appendChild(tip);

    try {
      while (current < scroller.scrollHeight) {
        // 检查当前视口
        if (tryMatchMessageCandidates(label).length > 0) {
          found = true;
          break;
        }

        // 检查是否有需要切换的分页器
        if (findPaginators().length > 0) {
          if (await switchToBranchWith(label, 1500)) {
            found = true;
            break;
          }
        }

        // 极短延迟向下滚动
        current += step;
        scroller.scrollTop = current;
        await sleep(60); 
      }

      // 到底部了再查一次
      if (!found && tryMatchMessageCandidates(label).length > 0) {
        found = true;
      }

      if (!found) {
        scroller.scrollTop = origTop;
      }
      return found;
    } finally {
      if (tip.parentNode) tip.parentNode.removeChild(tip);
    }
  }


  // 找所有形如 "N / N" 的分页器
  function findPaginators() {
    const result = [];
    document.querySelectorAll('*').forEach(el => {
      if (el.children.length > 0) return;
      const t = (el.innerText || '').trim().replace(/\s+/g, '');
      if (/^\d+\/\d+$/.test(t)) result.push(el);
    });
    return result;
  }

  // 遍历所有分页器的左箭头，寻找包含目标文字的分支
  async function switchToBranchWith(label) {
    const norm = (s) => normalizeText(s);
    const target = norm(label.text);

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    for (let round = 0; round < 15; round++) {
      const paginators = findPaginators();
      if (!paginators.length) return false;

      let clicked = false;

      for (const pag of paginators) {
        // 往上找 2~3 层，找到包含箭头的容器
        let container = pag.parentElement;
        for (let i = 0; i < 3 && container; i++) {
          if (container.querySelectorAll('.ds-button').length >= 2) break;
          container = container.parentElement;
        }
        if (!container) continue;

        const pagRect = pag.getBoundingClientRect();
        if (pagRect.width === 0) continue;

        const allButtons = Array.from(container.querySelectorAll('.ds-button'))
          .filter(b => {
            const r = b.getBoundingClientRect();
            return r.width > 5 && r.height > 5;
          });

        // 找分页器左侧最近的按钮作为「左箭头」
        let leftBtn = null, minDist = Infinity;
        for (const b of allButtons) {
          const r = b.getBoundingClientRect();
          if (r.right <= pagRect.left + 10) {
            const dist = pagRect.left - r.right;
            if (dist < minDist) { minDist = dist; leftBtn = b; }
          }
        }
        if (!leftBtn) continue;

        const textBefore = (pag.innerText || '').trim();
        leftBtn.click();
        clicked = true;
        await sleep(600);

        // 检查是否命中
        const nodes = findMessageNodes();
        for (const n of nodes) {
          if (norm(n.innerText).includes(target)) return true;
        }

        // 检查分页器文字是否变化，没变说明到头了
        const newPags = findPaginators();
        if (newPags.length && (newPags[0].innerText || '').trim() === textBefore) {
          // 到最左版本了，停止对当前分页器的尝试
          clicked = false;
        }
        break;
      }

      if (!clicked) return false;
    }
    return false;
  }


  


  function guessRole(node) {
    const cls = ((node.className || '') + ' ' + (node.parentElement?.className || '')).toString();
    if (/user|human|question/i.test(cls)) return 'user';
    if (/assistant|ai|bot|response/i.test(cls)) return 'ai';
    return 'ai';
  }

  // ============ 存储 ============
  function getLabels() {
    return new Promise(r => chrome.storage.local.get([STORAGE_KEY], res => r(res[STORAGE_KEY] || [])));
  }
  function setLabels(labels) {
    return new Promise(r => chrome.storage.local.set({ [STORAGE_KEY]: labels }, r));
  }
  
  async function addLabel(label) {
    const labels = await getLabels();
    const dup = labels.find(l =>
      l.url === label.url && l.text === label.text && l.msgFingerprint === label.msgFingerprint
    );
    if (dup) return false;
    // 新标签排在最前：order = 当前最小值 - 1
    const minOrder = labels.reduce((m, l) => Math.min(m, typeof l.order === 'number' ? l.order : 0), 0);
    label.order = minOrder - 1;
    labels.push(label);
    await setLabels(labels);
    return true;
  }

  // ============ 浮层 ============
  let tooltipHost = null;
  let tooltipEl = null;
  let pending = null;

  function ensureTooltip() {
    if (tooltipHost) return;
    tooltipHost = document.createElement('div');
    tooltipHost.id = 'dsc-tooltip-host';
    tooltipHost.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;display:none;';
    document.documentElement.appendChild(tooltipHost);

    const shadow = tooltipHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .tip {
          display:inline-flex; align-items:center; gap:6px;
          background:#fff; border:1px solid #d0d5dd; border-radius:10px;
          box-shadow:0 4px 12px rgba(0,0,0,.12);
          padding:6px 12px; font-size:13px; color:#1c1c1e;
          cursor:pointer; pointer-events:auto; white-space:nowrap;
          font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
          transition:background .15s, color .15s, border-color .15s;
          user-select:none;
        }
        .tip:hover { background:#e7f0ff; color:#1a73e8; border-color:#1a73e8; }
        .tip.saved { background:#e7ffe7; border-color:#4caf50; color:#2e7d32; }
      </style>
      <div class="tip"><span style="font-size:15px;">🔖</span> 添加标签</div>
    `;
    tooltipEl = shadow.querySelector('.tip');
    tooltipEl.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    tooltipEl.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      await onAddClick();
    });
  }

  function showTooltip(cx, cy) {
    ensureTooltip();
    tooltipEl.className = 'tip';
    tooltipEl.innerHTML = '<span style="font-size:15px;">🔖</span> 添加标签';
    const w = 130;
    let left = Math.max(10, Math.min(cx - w / 2, window.innerWidth - w - 10));
    let top = cy - 44;
    if (top < 10) top = cy + 16;
    tooltipHost.style.left = left + 'px';
    tooltipHost.style.top = top + 'px';
    tooltipHost.style.display = 'block';
  }
  function hideTooltip() {
    if (tooltipHost) tooltipHost.style.display = 'none';
    pending = null;
  }

  // ============ 划词检测 ============
  document.addEventListener('mouseup', (e) => {
    if (tooltipHost && tooltipHost.contains(e.target)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return hideTooltip();
      const text = sel.toString().trim();
      if (!text) return hideTooltip();

      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const containerEl = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;

      const nodes = findMessageNodes();
      let hostNode = null;
      for (const n of nodes) if (n.contains(containerEl)) { hostNode = n; break; }
      if (!hostNode) return hideTooltip();

      const rect = range.getBoundingClientRect();
      pending = { text, hostNode, rect };
      showTooltip(rect.left + rect.width / 2, rect.top);
    }, 10);
  });

  document.addEventListener('mousedown', (e) => {
    if (tooltipHost && tooltipHost.contains(e.target)) return;
    hideTooltip();
  });

  // ============ 添加标签 ============
  async function onAddClick() {
    if (!pending) return;
    const { text, hostNode } = pending;

    const nodeText = getNodeText(hostNode);
    const idx = nodeText.indexOf(text);
    const ctxLen = 20;
    const contextBefore = idx !== -1 ? nodeText.slice(Math.max(0, idx - ctxLen), idx) : '';
    const contextAfter = idx !== -1 ? nodeText.slice(idx + text.length, idx + text.length + ctxLen) : '';
    const msgFingerprint = nodeText.replace(/\s+/g, '').slice(0, 50);

    const label = {
      id: genId(),
      url: location.href,
      convTitle: getConvTitle(),
      text,
      displayText: text,
      contextBefore,
      contextAfter,
      msgFingerprint,
      role: guessRole(hostNode),
      createdAt: Date.now()
    };

    const ok = await addLabel(label);
    tooltipEl.className = 'tip saved';
    tooltipEl.innerHTML = ok
      ? '<span style="font-size:15px;">✅</span> 已保存'
      : '<span style="font-size:15px;">ℹ️</span> 已存在';
    setTimeout(hideTooltip, 800);
  }

  // ============ 定位跳转 ============
   function findTextPosition(node, text, before, after) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let fullText = '', n;
    while ((n = walker.nextNode())) {
      textNodes.push({ node: n, start: fullText.length, end: fullText.length + n.nodeValue.length });
      fullText += n.nodeValue;
    }

    // 归一化：把视觉相同、编码不同的字符统一
    function norm(s) {
      return String(s)
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D\u00AD]/g, '-')
        .replace(/[\u2018\u2019\u02BC\u2032]/g, "'")
        .replace(/[\u201C\u201D\u2033]/g, '"')
        .replace(/，/g, ',').replace(/。/g, '.').replace(/！/g, '!')
        .replace(/？/g, '?').replace(/：/g, ':').replace(/；/g, ';')
        .replace(/（/g, '(').replace(/）/g, ')')
        .replace(/[\u200b\u200c\u200d\u2060\uFEFF]/g, '');
    }

    // 策略 1: 原始精确匹配
    let idx = fullText.indexOf(text);
    if (idx !== -1) return { start: idx, end: idx + text.length, textNodes };

    // 策略 2: 归一化匹配，建归一化位置→原始索引映射
    const normMap = [];
    let normFull = '';
    for (let i = 0; i < fullText.length; i++) {
      const c = norm(fullText[i]);
      if (!c) continue;
      normMap.push(i);
      normFull += c;
    }
    const normText = norm(text);
    idx = normFull.indexOf(normText);
    if (idx !== -1) {
      const s = normMap[idx];
      const e = normMap[idx + normText.length - 1] + 1;
      return { start: s, end: e, textNodes };
    }

    // 策略 3: 上下文 + 目标拼接
    if (before || after) {
      const combo = norm(before || '') + normText + norm(after || '');
      const ci = normFull.indexOf(combo);
      if (ci !== -1) {
        const beforeLen = norm(before || '').length;
        const s = normMap[ci + beforeLen];
        const e = normMap[ci + beforeLen + normText.length - 1] + 1;
        return { start: s, end: e, textNodes };
      }
    }

    // 策略 4: 头尾各 8 字定位
    if (normText.length >= 12) {
      const head = normText.slice(0, 8);
      const tail = normText.slice(-8);
      const hi = normFull.indexOf(head);
      const ti = normFull.lastIndexOf(tail);
      if (hi !== -1 && ti !== -1 && ti > hi) {
        const s = normMap[hi];
        const e = normMap[ti + tail.length - 1] + 1;
        return { start: s, end: e, textNodes };
      }
    }

    // 策略 5: 12 字滑窗
    if (normText.length >= 12) {
      for (let i = 0; i + 12 <= normText.length; i += 3) {
        const seg = normText.slice(i, i + 12);
        const si = normFull.indexOf(seg);
        if (si !== -1) {
          const s = normMap[Math.max(0, si - i)];
          const e = normMap[Math.min(normMap.length - 1, si - i + normText.length - 1)] + 1;
          return { start: s, end: e, textNodes };
        }
      }
    }

    // 全失败，打印编码诊断
    console.warn('[DSC] ❌ findTextPosition 全部策略失败');
    console.warn('  划词原文:', JSON.stringify(text));
    console.warn('  划词编码:', Array.from(text).map(c => c.charCodeAt(0).toString(16)).join(' '));
    console.warn('  消息前 100 字:', JSON.stringify(fullText.slice(0, 100)));
    console.warn('  消息前 100 字编码:', Array.from(fullText.slice(0, 100)).map(c => c.charCodeAt(0).toString(16)).join(' '));
    return null;
  }

  function highlightAndScroll(node, posInfo) {
    const { start, end, textNodes } = posInfo;
    function locate(pos) {
      for (const tn of textNodes) {
        if (pos >= tn.start && pos < tn.end) return { node: tn.node, offset: pos - tn.start };
      }
      return null;
    }
    const s = locate(start);
    const e = locate(end - 1);
    if (!s || !e) { node.scrollIntoView({ block: 'center' }); return true; }

    try {
      const range = document.createRange();
      range.setStart(s.node, s.offset);
      range.setEnd(e.node, e.offset + 1);
      const span = document.createElement('span');
      span.style.cssText = 'background:#ffe066;border-radius:2px;transition:background .5s;';
      try {
        range.surroundContents(span);
      } catch {
        s.node.parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return true;
      }
      span.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => {
        if (span.parentNode) {
          const p = span.parentNode;
          while (span.firstChild) p.insertBefore(span.firstChild, span);
          p.removeChild(span);
          p.normalize();
        }
      }, 3000);
      return true;
    } catch (err) {
      console.warn('[DSC] highlight fail', err);
      node.scrollIntoView({ block: 'center' });
      return true;
    }
  }

  function jumpToLabel(label) {
    const nodes = findMessageNodes();
    for (const node of nodes) {
      const clean = getNodeText(node).replace(/\s+/g, '');
      if (clean.includes(label.msgFingerprint)) {
        const pos = findTextPosition(node, label.text, label.contextBefore, label.contextAfter);
        if (pos) { highlightAndScroll(node, pos); return { ok: true }; }
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return { ok: true, fallback: 'message' };
      }
    }
    return { ok: false, reason: '未在当前页面找到对应内容，可能对话已修改或未加载完' };
  }

  // ============ 消息监听 ============
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'jump' && msg.label) {
      // 因为 jumpToLabelWithLog 是 async 函数，必须用 .then 接收它 resolve 后的结果
      jumpToLabelWithLog(msg.label)
        .then(res => {
          sendResponse(res);
        })
        .catch(err => {
          console.error('[DSC] 跳转异常:', err);
          sendResponse({ ok: false, reason: '跳转异常：' + err.message });
        });
      return true; // 必须返回 true 保持消息通道开启，等待异步 resolve
    } else if (msg.type === 'ping') {
      sendResponse({ ok: true, msgCount: findMessageNodes().length, url: location.href });
    }
    return true;
  });

    // 挂到 DOM 上，让主世界也能调试（F12 控制台可直接访问）
  document.documentElement.__dsc_debug = { findMessageNodes, getLabels, jumpToLabel };

  // 延迟统计消息数量，等页面渲染完
  function reportStatus() {
    const count = findMessageNodes().length;
    console.log(`[DSC] 已注入 | 识别到 ${count} 条消息 | URL: ${location.href}`);
    if (count === 0) {
      console.warn('[DSC] ⚠️ 未识别到任何消息，页面结构可能已变化');
    }
  }
  setTimeout(reportStatus, 2500);
  // SPA 路由变化时重新检测
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(reportStatus, 2500);
    }
  }, 2000);

  // 增强跳转日志
  const _origJump = jumpToLabel;
  window.__dsc_jump_log = [];
 
    // 返回所有匹配的候选节点数组，按优先级排序
  function tryMatchMessageCandidates(label) {
    const nodes = findMessageNodes();
    if (!nodes.length) return [];

    const norm = (s) => normalizeText(s);
    const text = (label.text || '').trim();
    const textNorm = norm(text);
    const fpNorm = norm(label.msgFingerprint || '');
    const before = norm(label.contextBefore || '');
    const after = norm(label.contextAfter || '');

    const candidates = [];

    // 策略 1（最高优先）：文本全文命中 —— 这条消息里包含你划的原文
    if (textNorm) {
      for (const node of nodes) {
        if (norm(node.innerText).includes(textNorm)) {
          candidates.push({ node, strategy: 'textFull', score: 100 });
        }
      }
    }

    // 策略 2：文本头 20 字
    if (textNorm.length >= 8) {
      const head = textNorm.slice(0, 20);
      for (const node of nodes) {
        if (candidates.some(c => c.node === node)) continue;
        if (norm(node.innerText).includes(head)) {
          candidates.push({ node, strategy: 'textHead', score: 80 });
        }
      }
    }

    // 策略 3：文本尾 20 字
    if (textNorm.length >= 8) {
      const tail = textNorm.slice(-20);
      for (const node of nodes) {
        if (candidates.some(c => c.node === node)) continue;
        if (norm(node.innerText).includes(tail)) {
          candidates.push({ node, strategy: 'textTail', score: 75 });
        }
      }
    }

    // 策略 4：指纹（低优先，因为 AI 思考过程也会命中）
    if (fpNorm) {
      for (const node of nodes) {
        if (candidates.some(c => c.node === node)) continue;
        if (norm(node.innerText).includes(fpNorm)) {
          candidates.push({ node, strategy: 'fingerprint', score: 40 });
        }
      }
    }

    // 策略 5：上下文
    if (before || after) {
      for (const node of nodes) {
        if (candidates.some(c => c.node === node)) continue;
        const t = norm(node.innerText);
        if (before && before.length >= 6 && t.includes(before.slice(-15))) {
          candidates.push({ node, strategy: 'ctxBefore', score: 20 });
        } else if (after && after.length >= 6 && t.includes(after.slice(0, 15))) {
          candidates.push({ node, strategy: 'ctxAfter', score: 20 });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
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
    // 兜底
    if (!best) best = document.scrollingElement || document.documentElement;
    return best;
  }


  // 滚动到底部再回中间，强制 DeepSeek 重渲染所有消息
  function forceRerender() {
    return new Promise(resolve => {
      const scroller = findScrollContainer();
      if (!scroller) { resolve(); return; }
      const orig = scroller.scrollTop;
      scroller.scrollTop = 0;
      setTimeout(() => {
        scroller.scrollTop = scroller.scrollHeight;
        setTimeout(() => {
          scroller.scrollTop = orig;
          setTimeout(resolve, 600);
        }, 500);
      }, 500);
    });
  }

      async function jumpToLabelWithLog(label) {
    console.group('[DSC] 开始跳转');
    console.log('当前页面 URL:', location.href);
    console.log('标签记录 URL:', label.url);
    console.log('URL 是否匹配:', location.href === label.url ? '✅ 一致' : '❌ 不一致');

    let candidates = tryMatchMessageCandidates(label);
    console.log(`第 1 轮候选数: ${candidates.length}`, candidates.map(c => c.strategy + '/' + c.score));

    if (candidates.length === 0) {
      console.log('触发页面重渲染...');
      await forceRerender();
      candidates = tryMatchMessageCandidates(label);
      console.log(`第 2 轮候选数: ${candidates.length}`, candidates.map(c => c.strategy + '/' + c.score));
    }

            // 当前视口切换分页器
    if (candidates.length === 0) {
      console.log('尝试切换当前视口内的分页器...');
      const switched = await switchToBranchWith(label);
      if (switched) {
        candidates = tryMatchMessageCandidates(label);
      }
    }

    // 如果当前视口还没有，启动极速扫描
    if (candidates.length === 0) {
      console.log('启动极速扫描...');
      const found = await fastScanAndJump(label);
      if (found) {
        candidates = tryMatchMessageCandidates(label);
      }
    }

    console.groupEnd();

    if (candidates.length === 0) {
      return { ok: false, reason: '在整个对话中未找到该标签内容。可能对话已被修改或标签数据丢失。' };
    }

    // 遍历所有候选，找第一个能精确定位的
    const text = (label.text || '').trim();
    const before = (label.contextBefore || '').trim();
    const after = (label.contextAfter || '').trim();

    for (const cand of candidates) {
      const pos = findTextPosition(cand.node, text, before, after);
      if (pos) {
        console.log(`[DSC] ✅ 命中策略 ${cand.strategy}，文本定位成功`);
        highlightAndScroll(cand.node, pos);
        return { ok: true };
      }
    }

    // 所有候选都定位失败 → 滚到分数最高的那条，至少让你看到消息
    const top = candidates[0];
    console.log(`[DSC] ⚠️ 文本定位全失败，回退到消息级定位（策略 ${top.strategy}）`);
    top.node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return { ok: true, fallback: 'message' };
  }

  // 替换消息监听，改用带日志的版本
  chrome.runtime.onMessage.removeListener && chrome.runtime.onMessage.removeListener();
})();