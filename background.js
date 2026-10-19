// ============ 操作日志（结构化存储） ============
const LOG_KEY = 'dsc_activity_log';
const MAX_LOGS = 5000;

let writeChain = Promise.resolve();
function appendLog(event, meta) {
  const entry = { ts: Date.now(), event, meta: meta || {} };
  writeChain = writeChain
    .then(() => new Promise(r => {
      chrome.storage.local.get([LOG_KEY], res => {
        const logs = res[LOG_KEY] || [];
        logs.push(entry);
        const trimmed = logs.length > MAX_LOGS ? logs.slice(-MAX_LOGS) : logs;
        chrome.storage.local.set({ [LOG_KEY]: trimmed }, () => r());
      });
    }))
    .catch(() => {});
  return writeChain;
}

//const panelSessions = new Set();
//chrome.windows.onRemoved.addListener(winId => panelSessions.delete(winId));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'log_event' && msg.evt) {
    appendLog(msg.evt.event, msg.evt.meta).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'panel_opened') {
     // 无条件记录，用 popup 上报的准确 labelCount
    appendLog('panel_open', { labelCount: msg.labelCount || 0 });
    sendResponse({ ok: true });
    return true;
  }
});

const PANEL_SESSION_KEY = 'dsc_panel_window_id';

chrome.action.onClicked.addListener(async () => {
  const session = await chrome.storage.session.get([PANEL_SESSION_KEY]);
  const existingId = session[PANEL_SESSION_KEY];

  if (existingId) {
    // 检查这个窗口是否还活着、还是不是 popup
    const exists = await new Promise(resolve => {
      chrome.windows.get(existingId, win => {
        resolve(!chrome.runtime.lastError && win && win.type === 'popup');
      });
    });
    if (exists) {
      chrome.windows.update(existingId, { focused: true });
      return;
    }
    // 窗口已经没了（用户关了 / 浏览器重启残留），清掉记录
    await chrome.storage.session.remove([PANEL_SESSION_KEY]);
  }

  createPanelWindow();
});

function createPanelWindow() {
  const popupWidth = 400;
  const popupHeight = 600;

  chrome.windows.getLastFocused({ windowTypes: ['normal'] }, (currentWindow) => {
    let left = 100, top = 100;
    if (currentWindow && currentWindow.width) {
      left = currentWindow.left + currentWindow.width - popupWidth - 20;
      top = currentWindow.top + 80;
    }

    chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: popupWidth,
      height: popupHeight,
      left: Math.round(left),
      top: Math.round(top)
    }, (win) => {
      if (chrome.runtime.lastError) {
        console.error('[标签捕手] 创建面板窗口失败:', chrome.runtime.lastError.message);
        return;
      }
      if (win && win.id) {
        chrome.storage.session.set({ [PANEL_SESSION_KEY]: win.id });
      }
    });
  });
}

// 面板窗口被用户关闭时，清掉 session 记录
chrome.windows.onRemoved.addListener(async (winId) => {
  const session = await chrome.storage.session.get([PANEL_SESSION_KEY]);
  if (session[PANEL_SESSION_KEY] === winId) {
    await chrome.storage.session.remove([PANEL_SESSION_KEY]);
  }
});